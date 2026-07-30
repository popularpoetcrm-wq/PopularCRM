import { createHash } from "crypto";
import { promisify } from "util";
import { gzip as zlibGzip } from "zlib";
import { getEnv } from "@/lib/env";

const gzipAsync = promisify(zlibGzip);

export type SaldeoInvoiceInput = {
  externalId: string;
  buyerName: string;
  nip?: string;
  email?: string;
  amount: number;
  currency: string;
  description: string;
  /** VAT rate code per Saldeo, e.g. 23, 8, 5, 0, ZW */
  vatRate?: string;
  saleDate?: string; // YYYY-MM-DD
  calculatedFromGross?: boolean;
};

export type SaldeoInvoiceResult = {
  saldeoInvoiceId: string;
  invoiceNumber?: string;
  ksefNumber?: string;
  pdfUrl?: string;
  rawXml?: string;
  stub?: boolean;
};

/**
 * SaldeoSMART REST API-XML client (spec 5.0.1 / API ≥ 3.0 for 2026).
 *
 * Auth: username + req_sig = MD5( URL_ENCODING(sorted params) + api_token )
 * Body: command = base64(gzip(xml))
 * Invoice issue: POST /api/xml/3.0/invoice/add + company_program_id
 *
 * @see SaldeoSMART Specyfikacja API — SSK06, Uwierzytelnianie
 */
function saldeoUrlEncoding(input: string): string {
  // Appendix A: space→+, * unescaped, ~→%7E, hex UPPERCASE, UTF-8
  let out = "";
  const utf8 = Buffer.from(input, "utf8");
  for (let i = 0; i < utf8.length; i++) {
    const b = utf8[i]!;
    const ch = String.fromCharCode(b);
    if (
      (b >= 0x30 && b <= 0x39) || // 0-9
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      ch === "-" ||
      ch === "_" ||
      ch === "." ||
      ch === "*"
    ) {
      out += ch;
    } else if (ch === " ") {
      out += "+";
    } else {
      out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export function buildSaldeoReqSig(
  params: Record<string, string>,
  apiToken: string,
): string {
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== "" && params[k] != null)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("");
  const encoded = saldeoUrlEncoding(sorted) + apiToken;
  return createHash("md5").update(encoded, "utf8").digest("hex");
}

async function encodeCommand(xml: string): Promise<string> {
  const gz = await gzipAsync(Buffer.from(xml, "utf8"));
  return gz.toString("base64");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildInvoiceAddXml(input: SaldeoInvoiceInput): string {
  const saleDate = input.saleDate ?? new Date().toISOString().slice(0, 10);
  const fromGross = input.calculatedFromGross !== false;
  const rate = input.vatRate ?? "23";
  const unit = input.amount.toFixed(2);

  // Minimal invoice.add payload aligned with SSK06 / XSD intent
  return `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <INVOICE>
    <EXTERNAL_ID>${escapeXml(input.externalId)}</EXTERNAL_ID>
    <SALE_DATE>${saleDate}</SALE_DATE>
    <CALCULATED_FROM_GROSS>${fromGross ? "true" : "false"}</CALCULATED_FROM_GROSS>
    <CURRENCY>${escapeXml(input.currency || "PLN")}</CURRENCY>
    <CONTRACTOR>
      <NAME>${escapeXml(input.buyerName)}</NAME>
      ${input.nip ? `<NIP>${escapeXml(input.nip)}</NIP>` : ""}
      ${input.email ? `<EMAIL>${escapeXml(input.email)}</EMAIL>` : ""}
    </CONTRACTOR>
    <INVOICE_ITEMS>
      <INVOICE_ITEM>
        <NAME>${escapeXml(input.description)}</NAME>
        <QUANTITY>1</QUANTITY>
        <UNIT>szt.</UNIT>
        <UNIT_VALUE>${unit}</UNIT_VALUE>
        <RATE>${escapeXml(rate)}</RATE>
      </INVOICE_ITEM>
    </INVOICE_ITEMS>
  </INVOICE>
</ROOT>`;
}

function getSaldeoBaseUrl(): string {
  const env = getEnv();
  if (env.SALDEO_API_URL) return env.SALDEO_API_URL.replace(/\/$/, "");
  // prod default from spec; test: https://saldeo-test.brainshare.pl
  return "https://saldeo.brainshare.pl";
}

async function saldeoPost(path: string, extraParams: Record<string, string>, xml: string) {
  const env = getEnv();
  if (!env.SALDEO_USERNAME || !env.SALDEO_API_TOKEN) {
    throw new Error("Saldeo credentials missing (SALDEO_USERNAME / SALDEO_API_TOKEN)");
  }

  const reqId = `crm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const command = await encodeCommand(xml);
  const params: Record<string, string> = {
    username: env.SALDEO_USERNAME,
    req_id: reqId,
    command,
    ...extraParams,
  };
  if (env.SALDEO_COMPANY_PROGRAM_ID) {
    params.company_program_id = env.SALDEO_COMPANY_PROGRAM_ID;
  }

  const reqSig = buildSaldeoReqSig(params, env.SALDEO_API_TOKEN);
  params.req_sig = reqSig;

  const body = new URLSearchParams(params);
  const res = await fetch(`${getSaldeoBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/xml",
    },
    body,
  });

  const rawXml = await res.text();
  if (!res.ok) {
    throw new Error(`Saldeo HTTP ${res.status}: ${rawXml.slice(0, 500)}`);
  }

  const status = rawXml.match(/<STATUS>([^<]+)<\/STATUS>/i)?.[1];
  if (status && status.toUpperCase() === "ERROR") {
    const code = rawXml.match(/<ERROR_CODE>([^<]+)<\/ERROR_CODE>/i)?.[1];
    const msg = rawXml.match(/<ERROR_MESSAGE>([^<]+)<\/ERROR_MESSAGE>/i)?.[1];
    throw new Error(`Saldeo ${code ?? "?"}: ${msg ?? rawXml.slice(0, 300)}`);
  }

  return rawXml;
}

function pickXml(tag: string, xml: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "i"));
  return m?.[1];
}

/**
 * SSK06 — POST /api/xml/3.0/invoice/add
 * Then metadata/PDF via invoice.listbyid after ~30s (caller/cron).
 */
export async function createSaldeoInvoice(
  input: SaldeoInvoiceInput,
): Promise<SaldeoInvoiceResult> {
  const env = getEnv();
  if (!env.SALDEO_USERNAME || !env.SALDEO_API_TOKEN) {
    throw new Error(
      "Saldeo не настроен: нужны SALDEO_USERNAME и SALDEO_API_TOKEN",
    );
  }

  const xml = buildInvoiceAddXml(input);
  const rawXml = await saldeoPost("/api/xml/3.0/invoice/add", {}, xml);

  const id =
    pickXml("INVOICE_ID", rawXml) ||
    pickXml("ID", rawXml) ||
    input.externalId;

  return {
    saldeoInvoiceId: id,
    invoiceNumber: pickXml("NUMBER", rawXml),
    ksefNumber: (() => {
      const block = rawXml.match(/<KSEF>[\s\S]*?<\/KSEF>/i)?.[0];
      return block ? pickXml("NUMBER", block) : undefined;
    })(),
    rawXml,
  };
}

/** SSK08 — fetch invoice meta / PDF after add (wait ~30s recommended by Saldeo). */
export async function fetchSaldeoInvoiceById(invoiceId: string): Promise<{
  pdfUrl?: string;
  number?: string;
  ksefNumber?: string;
  rawXml: string;
}> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ROOT>
  <INVOICES>
    <INVOICE_ID>${escapeXml(invoiceId)}</INVOICE_ID>
  </INVOICES>
</ROOT>`;
  const rawXml = await saldeoPost("/api/xml/3.0/invoice/listbyid", {}, xml);
  return {
    pdfUrl: pickXml("PREVIEW_URL", rawXml) || pickXml("SOURCE", rawXml),
    number: pickXml("NUMBER", rawXml),
    ksefNumber: (() => {
      const block = rawXml.match(/<KSEF>[\s\S]*?<\/KSEF>/i)?.[0];
      return block ? pickXml("NUMBER", block) : undefined;
    })(),
    rawXml,
  };
}
