import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activatePackageFromPayment } from "@/domain/packages";
import {
  enqueueBestNotification,
  enqueueNotification,
} from "@/domain/notifications";
import { writeAudit } from "@/domain/audit";
import type { PackagePlanSnapshot } from "@/lib/types/domain";
import {
  registerP24Transaction,
  verifyP24Transaction,
  type P24Notification,
} from "@/integrations/przelewy24";
import { paymentReturnUrl, paymentStatusUrl } from "@/lib/brands";
import { nanoid } from "nanoid";

export async function createPaymentLink(
  db: SupabaseClient,
  params: {
    tenantId: string;
    enrollmentId: string;
    planId: string;
    payerPersonId: string;
    amount: number;
    currency?: string;
    description?: string;
    email?: string;
  },
) {
  const { data: plan, error: planErr } = await db
    .from("package_plans")
    .select("*")
    .eq("id", params.planId)
    .single();
  if (planErr) throw planErr;

  const sessionId = `crm-${nanoid(16)}`;
  const amountGrosze = Math.round(params.amount * 100);

  const { data: payment, error } = await db
    .from("payments")
    .insert({
      tenant_id: params.tenantId,
      provider: "przelewy24",
      payer_person_id: params.payerPersonId,
      enrollment_id: params.enrollmentId,
      amount: params.amount,
      currency: params.currency ?? "PLN",
      status: "pending",
      payment_method: "online",
      description: params.description ?? plan.name,
      provider_session_id: sessionId,
    })
    .select("*")
    .single();
  if (error) throw error;

  const registered = await registerP24Transaction({
    sessionId,
    amount: amountGrosze,
    currency: params.currency ?? "PLN",
    description: params.description ?? plan.name,
    email: params.email ?? "payer@example.com",
    // P24 is bound to populartickets domain
    urlReturn: paymentReturnUrl("/pay/return"),
    urlStatus: paymentStatusUrl(),
  });

  await db
    .from("payments")
    .update({
      provider_token: registered.token,
      payment_url: registered.paymentUrl,
    })
    .eq("id", payment.id);

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.payerPersonId,
    action: "payment.link_created",
    entityType: "payment",
    entityId: payment.id,
    after: { sessionId, amount: params.amount },
  });

  return { ...payment, payment_url: registered.paymentUrl, plan };
}

export async function handleP24Webhook(
  db: SupabaseClient,
  tenantId: string,
  raw: P24Notification,
) {
  const providerEventKey = `${raw.sessionId}:${raw.orderId}:${raw.amount}`;
  const payloadHash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");

  const { data: inserted, error: insErr } = await db
    .from("payment_events")
    .insert({
      tenant_id: tenantId,
      provider_event_key: providerEventKey,
      payload_hash: payloadHash,
      raw_payload: raw,
      is_duplicate: false,
    })
    .select("*")
    .maybeSingle();

  if (insErr) {
    if (insErr.code === "23505") {
      return { duplicate: true };
    }
    throw insErr;
  }

  const { data: payment, error: payErr } = await db
    .from("payments")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("provider_session_id", raw.sessionId)
    .single();
  if (payErr) throw payErr;

  await db
    .from("payment_events")
    .update({ payment_id: payment.id })
    .eq("id", inserted!.id);

  if (payment.status === "paid") {
    await db
      .from("payment_events")
      .update({ is_duplicate: true, processed_at: new Date().toISOString() })
      .eq("id", inserted!.id);
    return { duplicate: true, alreadyPaid: true };
  }

  const verify = await verifyP24Transaction({
    sessionId: raw.sessionId,
    orderId: raw.orderId,
    amount: raw.amount,
    currency: raw.currency,
  });

  await db
    .from("payment_events")
    .update({
      verify_result: verify,
      processed_at: new Date().toISOString(),
    })
    .eq("id", inserted!.id);

  if (!verify.success) {
    await db.from("payments").update({ status: "failed" }).eq("id", payment.id);
    return { verified: false };
  }

  const { data: enrollment } = await db
    .from("enrollments")
    .select("*, package_plans(*)")
    .eq("id", payment.enrollment_id)
    .single();

  const planRow = enrollment?.package_plans;
  const plan: PackagePlanSnapshot = {
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
  };

  await db
    .from("payments")
    .update({
      status: "paid",
      amount_paid: payment.amount,
      provider_order_id: String(raw.orderId),
      paid_at: new Date().toISOString(),
    })
    .eq("id", payment.id);

  await activatePackageFromPayment(db, {
    tenantId,
    paymentId: payment.id,
    enrollmentId: payment.enrollment_id,
    plan,
  });

  if (payment.payer_person_id) {
    await enqueueNotification(db, {
      tenantId,
      recipientPersonId: payment.payer_person_id,
      channel: "telegram",
      templateCode: "payment.paid",
      payload: { paymentId: payment.id },
    });
  }

  return { verified: true, paymentId: payment.id };
}

export async function recordCashOrPartialPayment(
  db: SupabaseClient,
  params: {
    tenantId: string;
    enrollmentId: string;
    payerPersonId: string;
    amount: number;
    amountPaid: number;
    method: "cash" | "transfer" | "invoice";
    description?: string;
    actorPersonId?: string;
  },
) {
  const status =
    params.amountPaid >= params.amount
      ? "paid"
      : params.amountPaid > 0
        ? "partial"
        : "pending";

  const { data: payment, error } = await db
    .from("payments")
    .insert({
      tenant_id: params.tenantId,
      provider: params.method === "cash" ? "cash" : "transfer",
      payer_person_id: params.payerPersonId,
      enrollment_id: params.enrollmentId,
      amount: params.amount,
      amount_paid: params.amountPaid,
      currency: "PLN",
      status,
      payment_method: params.method,
      description: params.description,
      paid_at: status === "paid" ? new Date().toISOString() : null,
    })
    .select("*")
    .single();
  if (error) throw error;

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.actorPersonId ?? null,
    action: status === "paid" ? "payment.paid" : "payment.link_created",
    entityType: "payment",
    entityId: payment.id,
    after: payment,
  });

  return payment;
}

async function activatePackageForPaidCharge(
  db: SupabaseClient,
  payment: {
    id: string;
    enrollment_id?: string | null;
    student_package_id?: string | null;
  },
  tenantId: string,
) {
  if (!payment.enrollment_id || payment.student_package_id) return null;

  const { data: active } = await db
    .from("student_packages")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("enrollment_id", payment.enrollment_id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (active) return active;

  const { data: enrollment } = await db
    .from("enrollments")
    .select("id, package_plans(*)")
    .eq("id", payment.enrollment_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const rawPlan = Array.isArray(enrollment?.package_plans)
    ? enrollment?.package_plans[0]
    : enrollment?.package_plans;
  if (!rawPlan) return null;

  const plan: PackagePlanSnapshot = {
    id: rawPlan.id,
    name: rawPlan.name,
    lessons_count: rawPlan.lessons_count,
    validity_days: rawPlan.validity_days,
    price_gross: Number(rawPlan.price_gross),
    currency: rawPlan.currency,
    start_policy: rawPlan.start_policy,
    makeup_policy: rawPlan.makeup_policy,
    makeup_validity_days: rawPlan.makeup_validity_days,
    booking_cutoff_minutes: rawPlan.booking_cutoff_minutes,
  };
  return activatePackageFromPayment(db, {
    tenantId,
    paymentId: payment.id,
    enrollmentId: payment.enrollment_id,
    plan,
  });
}

export async function upsertManualCharge(
  db: SupabaseClient,
  params: {
    tenantId: string;
    enrollmentId: string;
    payerPersonId: string;
    amount: number;
    amountPaid?: number;
    method?: "cash" | "transfer" | "invoice";
    description?: string;
    actorPersonId?: string;
  },
) {
  const { data: existing, error: findError } = await db
    .from("payments")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("enrollment_id", params.enrollmentId)
    .in("status", ["pending", "partial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;

  if (!existing) {
    const created = await recordCashOrPartialPayment(db, {
      tenantId: params.tenantId,
      enrollmentId: params.enrollmentId,
      payerPersonId: params.payerPersonId,
      amount: params.amount,
      amountPaid: params.amountPaid ?? 0,
      method: params.method ?? "transfer",
      description: params.description,
      actorPersonId: params.actorPersonId,
    });
    if (created.status === "paid") {
      await activatePackageForPaidCharge(db, created, params.tenantId);
    }
    return created;
  }

  const amountPaid = Math.min(
    params.amount,
    params.amountPaid ?? Number(existing.amount_paid),
  );
  const status =
    amountPaid >= params.amount ? "paid" : amountPaid > 0 ? "partial" : "pending";
  const { data: updated, error } = await db
    .from("payments")
    .update({
      payer_person_id: params.payerPersonId,
      amount: params.amount,
      amount_paid: amountPaid,
      status,
      payment_method: params.method ?? existing.payment_method ?? "transfer",
      description: params.description ?? existing.description,
      paid_at: status === "paid" ? new Date().toISOString() : null,
    })
    .eq("id", existing.id)
    .eq("tenant_id", params.tenantId)
    .select("*")
    .single();
  if (error) throw error;

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.actorPersonId ?? null,
    action: "payment.charge_updated",
    entityType: "payment",
    entityId: existing.id,
    before: existing,
    after: updated,
  });
  if (status === "paid") {
    await activatePackageForPaidCharge(db, updated, params.tenantId);
  }
  return updated;
}

export async function addManualPayment(
  db: SupabaseClient,
  params: {
    tenantId: string;
    paymentId: string;
    addAmount: number;
    method?: "cash" | "transfer" | "invoice";
    actorPersonId?: string;
  },
) {
  const { data: payment, error: findError } = await db
    .from("payments")
    .select("*")
    .eq("id", params.paymentId)
    .eq("tenant_id", params.tenantId)
    .single();
  if (findError) throw findError;

  const amountPaid = Math.min(
    Number(payment.amount),
    Number(payment.amount_paid) + params.addAmount,
  );
  const status = amountPaid >= Number(payment.amount) ? "paid" : "partial";
  const { data: updated, error } = await db
    .from("payments")
    .update({
      amount_paid: amountPaid,
      status,
      payment_method: params.method ?? payment.payment_method ?? "transfer",
      paid_at: status === "paid" ? new Date().toISOString() : null,
    })
    .eq("id", payment.id)
    .select("*")
    .single();
  if (error) throw error;

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.actorPersonId ?? null,
    action: status === "paid" ? "payment.paid" : "payment.partial",
    entityType: "payment",
    entityId: payment.id,
    before: payment,
    after: updated,
  });

  if (status === "paid") {
    await activatePackageForPaidCharge(db, updated, params.tenantId);
  }

  return updated;
}

export async function queuePaymentReminders(
  db: SupabaseClient,
  params: {
    tenantId: string;
    paymentId?: string;
    actorPersonId?: string;
  },
) {
  let query = db
    .from("payments")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .in("status", ["pending", "partial"]);
  if (params.paymentId) query = query.eq("id", params.paymentId);
  const { data: payments, error } = await query.limit(200);
  if (error) throw error;

  let reminded = 0;
  const failed: Array<{ paymentId: string; error: string }> = [];
  for (const payment of payments ?? []) {
    if (!payment.payer_person_id) {
      failed.push({ paymentId: payment.id, error: "не указан плательщик" });
      continue;
    }
    try {
      await enqueueBestNotification(db, {
        tenantId: params.tenantId,
        recipientPersonId: payment.payer_person_id,
        templateCode: "payment.reminder",
        payload: {
          paymentId: payment.id,
          amount: Math.max(
            0,
            Number(payment.amount) - Number(payment.amount_paid),
          ),
          paymentUrl: payment.payment_url,
          description: payment.description,
        },
      });
      reminded += 1;
    } catch (e) {
      failed.push({
        paymentId: payment.id,
        error: e instanceof Error ? e.message : "ошибка",
      });
    }
  }

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.actorPersonId ?? null,
    action: "payments.reminders_queued",
    entityType: "payment",
    after: { reminded, failed },
  });
  return { reminded, failed };
}
