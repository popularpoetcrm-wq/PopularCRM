import { jsonOk, jsonError } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { hasSupabase } from "@/lib/env";
import { DEMO_TENANT_ID, getDemoState } from "@/lib/demo-store";
import { parseP24Notification } from "@/integrations/przelewy24";

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let body: Record<string, unknown>;

  if (contentType.includes("application/json")) {
    body = await req.json();
  } else {
    const form = await req.formData();
    body = Object.fromEntries(form.entries());
  }

  const notification = parseP24Notification(body);

  if (!hasSupabase()) {
    const state = getDemoState();
    const payment = state.payments.find(
      (p) => p.id === notification.sessionId || p.payment_url?.includes(notification.sessionId),
    );
    if (payment) {
      payment.status = "paid";
      payment.amount_paid = payment.amount;
    }
    return jsonOk({ duplicate: false, demo: true });
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const { handleP24Webhook } = await import("@/domain/payments");
  const db = getAdminClient();
  const tenantId = getEnv().DEFAULT_TENANT_ID ?? DEMO_TENANT_ID;

  try {
    const result = await handleP24Webhook(db, tenantId, notification);
    // Always 200 for P24 retries
    return jsonOk(result);
  } catch (e) {
    console.error("P24 webhook error", e);
    // Still 200 after logging to avoid infinite aggressive retries on poison payloads;
    // dead-letter job will scan failed events.
    return jsonOk({ accepted: true, error: e instanceof Error ? e.message : "error" });
  }
}

export async function GET() {
  return jsonError("Use POST", 405);
}
