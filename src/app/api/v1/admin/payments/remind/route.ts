import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDemoState } from "@/lib/demo-store";
import { notify, remindAllDebtors } from "@/lib/demo-ops";
import { getEnv } from "@/lib/env";
import { hasSupabase } from "@/lib/env";

const bodySchema = z.object({
  paymentId: z.string().optional(),
  all: z.boolean().optional(),
});

/** Reminder → inbox (+ telegram stub). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid payload");

  if (hasSupabase() && user.mode === "supabase") {
    try {
      const { getAdminClient } = await import("@/lib/supabase/admin");
      const { queuePaymentReminders } = await import("@/domain/payments");
      return jsonOk(
        await queuePaymentReminders(getAdminClient(), {
          tenantId: user.tenantId,
          paymentId: parsed.data.all ? undefined : parsed.data.paymentId,
          actorPersonId: user.personId,
        }),
      );
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  if (parsed.data.all) {
    return jsonOk(remindAllDebtors(user.fullName));
  }

  if (!parsed.data.paymentId) return jsonError("paymentId or all required");

  const state = getDemoState();
  const payment = state.payments.find((p) => p.id === parsed.data.paymentId);
  if (!payment) return jsonError("Not found", 404);
  const due = payment.amount - payment.amount_paid;
  const appUrl = getEnv().NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const text = `Напоминание об оплате: ${due} PLN. ${payment.description}. ${appUrl}/cabinet/payments`;
  notify(payment.payer_person_id, "payment.reminder", text, "inbox");
  return jsonOk({ queued: true, preview: text });
}
