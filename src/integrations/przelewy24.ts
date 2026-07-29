import { createHash } from "crypto";
import { getEnv } from "@/lib/env";

export type P24Notification = {
  merchantId: number;
  posId: number;
  sessionId: string;
  amount: number;
  originAmount?: number;
  currency: string;
  orderId: number;
  methodId?: number;
  statement?: string;
  sign?: string;
};

function p24BaseUrl() {
  const env = getEnv();
  return env.P24_SANDBOX === "false"
    ? "https://secure.przelewy24.pl"
    : "https://sandbox.przelewy24.pl";
}

function signRegister(payload: {
  sessionId: string;
  merchantId: number;
  amount: number;
  currency: string;
  crc: string;
}) {
  const json = JSON.stringify({
    sessionId: payload.sessionId,
    merchantId: payload.merchantId,
    amount: payload.amount,
    currency: payload.currency,
    crc: payload.crc,
  });
  return createHash("sha384").update(json).digest("hex");
}

function signVerify(payload: {
  sessionId: string;
  orderId: number;
  amount: number;
  currency: string;
  crc: string;
}) {
  const json = JSON.stringify({
    sessionId: payload.sessionId,
    orderId: payload.orderId,
    amount: payload.amount,
    currency: payload.currency,
    crc: payload.crc,
  });
  return createHash("sha384").update(json).digest("hex");
}

function authHeader() {
  const env = getEnv();
  const user = env.P24_POS_ID || env.P24_MERCHANT_ID || "";
  const pass = env.P24_API_KEY || "";
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export async function registerP24Transaction(input: {
  sessionId: string;
  amount: number;
  currency: string;
  description: string;
  email: string;
  urlReturn: string;
  urlStatus: string;
}): Promise<{ token: string; paymentUrl: string }> {
  const env = getEnv();
  if (!env.P24_MERCHANT_ID || !env.P24_CRC) {
    // Dev fallback: fake hosted link on tickets domain (P24-bound)
    const tickets =
      process.env.TICKETS_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_TICKETS_URL ||
      env.NEXT_PUBLIC_APP_URL;
    return {
      token: `dev-${input.sessionId}`,
      paymentUrl: `${tickets}/pay/package/${input.sessionId}`,
    };
  }

  const merchantId = Number(env.P24_MERCHANT_ID);
  const posId = Number(env.P24_POS_ID || env.P24_MERCHANT_ID);
  const sign = signRegister({
    sessionId: input.sessionId,
    merchantId,
    amount: input.amount,
    currency: input.currency,
    crc: env.P24_CRC,
  });

  const res = await fetch(`${p24BaseUrl()}/api/v1/transaction/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      merchantId,
      posId,
      sessionId: input.sessionId,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      email: input.email,
      country: "PL",
      language: "pl",
      urlReturn: input.urlReturn,
      urlStatus: input.urlStatus,
      sign,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`P24 register failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as { data?: { token?: string } };
  const token = json.data?.token;
  if (!token) throw new Error("P24 register: missing token");

  return {
    token,
    paymentUrl: `${p24BaseUrl()}/trnRequest/${token}`,
  };
}

export async function verifyP24Transaction(input: {
  sessionId: string;
  orderId: number;
  amount: number;
  currency: string;
}): Promise<{ success: boolean; raw?: unknown }> {
  const env = getEnv();
  if (!env.P24_MERCHANT_ID || !env.P24_CRC) {
    return { success: true, raw: { dev: true } };
  }

  const merchantId = Number(env.P24_MERCHANT_ID);
  const posId = Number(env.P24_POS_ID || env.P24_MERCHANT_ID);
  const sign = signVerify({
    sessionId: input.sessionId,
    orderId: input.orderId,
    amount: input.amount,
    currency: input.currency,
    crc: env.P24_CRC,
  });

  const res = await fetch(`${p24BaseUrl()}/api/v1/transaction/verify`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      merchantId,
      posId,
      sessionId: input.sessionId,
      amount: input.amount,
      currency: input.currency,
      orderId: input.orderId,
      sign,
    }),
  });

  const raw = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, raw };
  const status = (raw as { data?: { status?: string } })?.data?.status;
  return { success: status === "success", raw };
}

export function parseP24Notification(body: Record<string, unknown>): P24Notification {
  return {
    merchantId: Number(body.merchantId ?? body.p24_merchant_id),
    posId: Number(body.posId ?? body.p24_pos_id),
    sessionId: String(body.sessionId ?? body.p24_session_id),
    amount: Number(body.amount ?? body.p24_amount),
    currency: String(body.currency ?? body.p24_currency ?? "PLN"),
    orderId: Number(body.orderId ?? body.p24_order_id),
    methodId: body.methodId ? Number(body.methodId) : undefined,
    sign: body.sign ? String(body.sign) : undefined,
  };
}
