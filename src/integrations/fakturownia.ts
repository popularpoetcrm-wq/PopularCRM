import { getEnv } from "@/lib/env";

export type FakturowniaInvoiceInput = {
  externalId: string;
  buyerName: string;
  nip?: string;
  email?: string;
  street?: string;
  postCode?: string;
  city?: string;
  country?: string;
  clientId?: number;
  amount: number;
  currency: string;
  description: string;
  /** VAT rate: 23 | 8 | 5 | 0 | "zw" — default 0% for studio packages */
  tax?: number | string;
  sellDate?: string; // YYYY-MM-DD
  paid?: boolean;
};

export type FakturowniaInvoiceResult = {
  fakturowniaInvoiceId: string;
  invoiceNumber?: string;
  pdfUrl?: string;
  viewUrl?: string;
  token?: string;
};

export type FakturowniaSetup = {
  configured: boolean;
  missing: string[];
  domain: string | null;
  baseUrl: string | null;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getFakturowniaSetup(): FakturowniaSetup {
  const env = getEnv();
  const rawDomain = env.FAKTUROWNIA_DOMAIN?.trim() ?? "";
  const token = env.FAKTUROWNIA_API_TOKEN?.trim() ?? "";
  const domain = rawDomain
    .replace(/^https?:\/\//, "")
    .replace(/\.fakturownia\.pl\/?$/i, "")
    .replace(/\/$/, "")
    .split(".")[0];
  const missing = [
    !domain ? "FAKTUROWNIA_DOMAIN" : null,
    !token ? "FAKTUROWNIA_API_TOKEN" : null,
  ].filter(Boolean) as string[];
  return {
    configured: missing.length === 0,
    missing,
    domain: domain || null,
    baseUrl: domain ? `https://${domain}.fakturownia.pl` : null,
  };
}

async function fakturowniaFetch<T>(
  path: string,
  init?: { method?: string; body?: Record<string, unknown>; query?: Record<string, string> },
): Promise<T> {
  const setup = getFakturowniaSetup();
  const env = getEnv();
  if (!setup.configured || !setup.baseUrl) {
    throw new Error(`Fakturownia не настроена: ${setup.missing.join(", ")}`);
  }
  const token = env.FAKTUROWNIA_API_TOKEN!;
  const url = new URL(`${setup.baseUrl}${path}`);
  url.searchParams.set("api_token", token);
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    url.searchParams.set(k, v);
  }

  const method = init?.method ?? (init?.body ? "POST" : "GET");
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: init?.body
      ? JSON.stringify({ api_token: token, ...init.body })
      : undefined,
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!res.ok) {
    const msg =
      typeof json === "object" && json && "message" in json
        ? String((json as { message: unknown }).message)
        : text.slice(0, 400);
    throw new Error(`Fakturownia HTTP ${res.status}: ${msg}`);
  }
  return json as T;
}

export async function findFakturowniaClientId(params: {
  email?: string;
  nip?: string;
  name?: string;
}): Promise<number | undefined> {
  type ClientRow = {
    id?: number;
    email?: string | null;
    tax_no?: string | null;
    name?: string | null;
  };

  const attempts: Record<string, string>[] = [];
  if (params.email?.trim()) attempts.push({ email: params.email.trim() });
  if (params.nip?.trim()) {
    attempts.push({ tax_no: params.nip.replace(/\s|-/g, "") });
  }
  if (params.name?.trim()) attempts.push({ name: params.name.trim() });

  for (const query of attempts) {
    const rows = await fakturowniaFetch<ClientRow[]>("/clients.json", {
      query: { page: "1", per_page: "25", ...query },
    });
    if (!Array.isArray(rows) || !rows.length) continue;

    const email = params.email?.trim().toLowerCase();
    const nip = params.nip?.replace(/\s|-/g, "");
    if (email) {
      const byEmail = rows.find((r) => (r.email || "").toLowerCase() === email);
      if (byEmail?.id) return byEmail.id;
    }
    if (nip) {
      const byNip = rows.find(
        (r) => (r.tax_no || "").replace(/\s|-/g, "") === nip,
      );
      if (byNip?.id) return byNip.id;
    }
    if (rows[0]?.id) return rows[0].id;
  }
  return undefined;
}

/**
 * Create a VAT invoice (gross). Returns public PDF URL via invoice token.
 */
export async function createFakturowniaInvoice(
  input: FakturowniaInvoiceInput,
): Promise<FakturowniaInvoiceResult> {
  const setup = getFakturowniaSetup();
  if (!setup.configured || !setup.baseUrl) {
    throw new Error(`Fakturownia не настроена: ${setup.missing.join(", ")}`);
  }

  const sellDate = input.sellDate ?? todayIsoDate();
  const tax = input.tax ?? 0;
  const clientId =
    input.clientId ??
    (await findFakturowniaClientId({
      email: input.email,
      nip: input.nip,
      name: input.buyerName,
    }));

  const invoice: Record<string, unknown> = {
    kind: "vat",
    number: null,
    sell_date: sellDate,
    issue_date: sellDate,
    payment_to: sellDate,
    currency: input.currency || "PLN",
    oid: input.externalId,
    buyer_name: input.buyerName,
    positions: [
      {
        name: input.description || "Pakiet zajęć",
        tax,
        total_price_gross: Number(input.amount),
        quantity: 1,
      },
    ],
  };

  if (clientId) invoice.client_id = clientId;
  if (input.nip) invoice.buyer_tax_no = input.nip;
  if (input.email) invoice.buyer_email = input.email;
  if (input.street) invoice.buyer_street = input.street;
  if (input.postCode) invoice.buyer_post_code = input.postCode;
  if (input.city) invoice.buyer_city = input.city;
  if (input.country) invoice.buyer_country = input.country;
  if (input.paid) {
    invoice.status = "paid";
    invoice.paid_date = sellDate;
    invoice.payment_type = "transfer";
  }

  type Created = {
    id?: number | string;
    number?: string | null;
    token?: string | null;
    view_url?: string | null;
  };

  const created = await fakturowniaFetch<Created>("/invoices.json", {
    method: "POST",
    body: { invoice },
  });

  if (!created?.id) {
    throw new Error("Fakturownia не вернула id фактуры");
  }

  const token = created.token ?? undefined;
  const pdfUrl = token
    ? `${setup.baseUrl}/invoice/${token}.pdf`
    : undefined;
  const viewUrl = token
    ? `${setup.baseUrl}/invoice/${token}`
    : created.view_url ?? undefined;

  return {
    fakturowniaInvoiceId: String(created.id),
    invoiceNumber: created.number ?? undefined,
    pdfUrl,
    viewUrl,
    token,
  };
}
