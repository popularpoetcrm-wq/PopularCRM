import { createHash } from "crypto";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { verifyTicketsWebhook } from "@/lib/crm-tickets-auth";
import { getEnv, hasSupabase } from "@/lib/env";
import { DEMO_TENANT_ID, getDemoState } from "@/lib/demo-store";

export const runtime = "nodejs";

const bodySchema = z.object({
  crm_payment_id: z.string().min(1),
  status: z.enum(["paid", "failed", "cancelled"]).or(z.string()),
  amount: z.number().optional(),
  currency: z.string().optional(),
  tickets_order_id: z.string().optional().nullable(),
  p24_order_id: z.union([z.string(), z.number()]).optional().nullable(),
  paid_at: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifyTicketsWebhook(req, rawBody)) {
    return jsonError("Unauthorized", 401);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = bodySchema.safeParse(parsedJson);
  if (!parsed.success) return jsonError("Invalid payload", 400);

  const payload = parsed.data;
  if (payload.status !== "paid") {
    return jsonOk({
      ignored: true,
      reason: `status=${payload.status}`,
      crm_payment_id: payload.crm_payment_id,
    });
  }

  if (!hasSupabase()) {
    const state = getDemoState();
    const payment = state.payments.find((p) => p.id === payload.crm_payment_id);
    if (!payment) {
      return jsonOk({ skipped: true, reason: "payment_not_found", demo: true });
    }
    payment.status = "paid";
    payment.amount_paid = payment.amount;
    return jsonOk({ demo: true, paymentId: payment.id, alreadyPaid: false });
  }

  try {
    const { getAdminClient } = await import("@/lib/supabase/admin");
    const { activatePackageFromPayment } = await import("@/domain/packages");
    const { enqueueNotification } = await import("@/domain/notifications");
    const db = getAdminClient();
    const tenantId = getEnv().DEFAULT_TENANT_ID ?? DEMO_TENANT_ID;
    const paymentId = payload.crm_payment_id;

    // payments.id is uuid — non-uuid smoke ids must not hit Postgres
    const looksUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        paymentId,
      );
    if (!looksUuid) {
      return jsonOk({
        skipped: true,
        reason: "payment_id_not_uuid",
        crm_payment_id: paymentId,
      });
    }

    const { data: payment, error } = await db
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;

    if (!payment) {
      // Tickets may smoke-test with synthetic ids; ack so they don't retry forever.
      return jsonOk({
        skipped: true,
        reason: "payment_not_found",
        crm_payment_id: paymentId,
      });
    }

    if (payment.status === "paid") {
      return jsonOk({
        alreadyPaid: true,
        paymentId: payment.id,
        crm_payment_id: paymentId,
      });
    }

    const paidAt = payload.paid_at ?? new Date().toISOString();
    const amountPaid =
      payload.amount != null && payload.amount > 0
        ? payload.amount
        : Number(payment.amount);

    const eventKey = `tickets:${payload.tickets_order_id ?? paymentId}:${payload.p24_order_id ?? "paid"}`;
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    await db.from("payment_events").upsert(
      {
        tenant_id: tenantId,
        payment_id: payment.id,
        provider_event_key: eventKey,
        payload_hash: payloadHash,
        raw_payload: parsedJson,
        is_duplicate: false,
        processed_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,provider_event_key", ignoreDuplicates: true },
    );

    const { error: updErr } = await db
      .from("payments")
      .update({
        status: "paid",
        amount_paid: amountPaid,
        provider: "przelewy24",
        provider_order_id: payload.p24_order_id
          ? String(payload.p24_order_id)
          : payment.provider_order_id,
        provider_session_id:
          payload.tickets_order_id ?? payment.provider_session_id,
        paid_at: paidAt,
      })
      .eq("id", payment.id);
    if (updErr) throw updErr;

    if (payment.enrollment_id) {
      const { data: enrollment } = await db
        .from("enrollments")
        .select("*, package_plans(*)")
        .eq("id", payment.enrollment_id)
        .maybeSingle();
      const planRow = enrollment?.package_plans as
        | {
            id: string;
            name: string;
            lessons_count: number;
            validity_days: number;
            price_gross: number;
            currency: string;
            start_policy: string;
            makeup_policy: string;
            makeup_validity_days: number;
            booking_cutoff_minutes: number;
          }
        | null
        | undefined;
      if (planRow) {
        try {
          await activatePackageFromPayment(db, {
            tenantId,
            paymentId: payment.id,
            enrollmentId: payment.enrollment_id,
            plan: {
              id: planRow.id,
              name: planRow.name,
              lessons_count: planRow.lessons_count,
              validity_days: planRow.validity_days,
              price_gross: Number(planRow.price_gross),
              currency: planRow.currency,
              start_policy: planRow.start_policy,
              makeup_policy: planRow.makeup_policy,
              makeup_validity_days: planRow.makeup_validity_days,
              booking_cutoff_minutes: planRow.booking_cutoff_minutes,
            } as import("@/lib/types/domain").PackagePlanSnapshot,
          });
        } catch (e) {
          // Package may already exist from a prior attempt
          console.warn("[tickets webhook] activate package", e);
        }
      }
    }

    if (payment.payer_person_id) {
      try {
        await enqueueNotification(db, {
          tenantId,
          recipientPersonId: payment.payer_person_id,
          channel: "telegram",
          templateCode: "payment.paid",
          payload: { paymentId: payment.id },
        });
      } catch {
        /* non-fatal */
      }
    }

    return jsonOk({
      paid: true,
      paymentId: payment.id,
      crm_payment_id: paymentId,
    });
  } catch (e) {
    console.error("[tickets webhook]", e);
    return jsonError(e instanceof Error ? e.message : "webhook fail", 500);
  }
}

export async function GET() {
  return jsonError("Use POST", 405);
}
