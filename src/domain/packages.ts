import { addDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackagePlanSnapshot } from "@/lib/types/domain";
import { writeAudit } from "@/domain/audit";

export async function activatePackageFromPayment(
  db: SupabaseClient,
  params: {
    tenantId: string;
    paymentId: string;
    enrollmentId: string;
    plan: PackagePlanSnapshot;
    actorPersonId?: string | null;
    requestId?: string;
  },
) {
  const activatedAt = new Date();
  const expiresAt =
    params.plan.start_policy === "on_payment"
      ? addDays(activatedAt, params.plan.validity_days)
      : null;

  const { data: pkg, error: pkgErr } = await db
    .from("student_packages")
    .insert({
      tenant_id: params.tenantId,
      enrollment_id: params.enrollmentId,
      plan_snapshot: params.plan,
      payment_id: params.paymentId,
      activated_at: activatedAt.toISOString(),
      expires_at: expiresAt?.toISOString() ?? null,
      status: "active",
    })
    .select("*")
    .single();

  if (pkgErr) throw pkgErr;

  const credits = Array.from({ length: params.plan.lessons_count }, (_, i) => ({
    tenant_id: params.tenantId,
    student_package_id: pkg.id,
    credit_index: i + 1,
    status: "available",
    expires_at: expiresAt?.toISOString() ?? null,
  }));

  const { error: creditsErr } = await db.from("lesson_credits").insert(credits);
  if (creditsErr) throw creditsErr;

  await db
    .from("payments")
    .update({ student_package_id: pkg.id, status: "paid", paid_at: activatedAt.toISOString() })
    .eq("id", params.paymentId);

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.actorPersonId ?? null,
    action: "payment.paid",
    entityType: "student_package",
    entityId: pkg.id,
    after: { paymentId: params.paymentId, credits: params.plan.lessons_count },
    requestId: params.requestId,
  });

  return pkg;
}

export async function getAvailableCreditsCount(
  db: SupabaseClient,
  studentPackageId: string,
): Promise<number> {
  const { count, error } = await db
    .from("lesson_credits")
    .select("*", { count: "exact", head: true })
    .eq("student_package_id", studentPackageId)
    .eq("status", "available");
  if (error) throw error;
  return count ?? 0;
}
