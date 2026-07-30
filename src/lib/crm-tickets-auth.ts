import { createHmac, timingSafeEqual } from "crypto";
import { getEnv } from "@/lib/env";

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Secrets accepted for Tickets→CRM callbacks (either works). */
export function crmWebhookSecrets(): string[] {
  const env = getEnv();
  return [env.CRM_WEBHOOK_SECRET, env.CRM_CHECKOUT_SECRET]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
}

/**
 * Tickets sends:
 * - Authorization: Bearer <CRM_WEBHOOK_SECRET|CRM_CHECKOUT_SECRET>
 * - X-CRM-Webhook-Signature: sha256=<HMAC-SHA256(rawBody, secret)>
 * Accept if either check passes against either secret.
 */
export function verifyTicketsWebhook(req: Request, rawBody: string): boolean {
  const secrets = crmWebhookSecrets();
  if (!secrets.length) return false;

  const auth = req.headers.get("authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (secrets.some((s) => safeEqual(token, s))) return true;
  }

  const sigHeader = req.headers.get("x-crm-webhook-signature")?.trim() ?? "";
  const hex = sigHeader.toLowerCase().startsWith("sha256=")
    ? sigHeader.slice(7).trim()
    : "";
  if (hex) {
    for (const secret of secrets) {
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      if (safeEqual(hex, expected)) return true;
    }
  }

  return false;
}
