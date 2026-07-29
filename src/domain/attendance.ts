import { addDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BulkAttendanceItem, PackagePlanSnapshot } from "@/lib/types/domain";
import { writeAudit } from "@/domain/audit";
import { enqueueNotification } from "@/domain/notifications";

async function findActivePackageForEnrollment(
  db: SupabaseClient,
  enrollmentId: string,
) {
  const { data, error } = await db
    .from("student_packages")
    .select("*")
    .eq("enrollment_id", enrollmentId)
    .eq("status", "active")
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function consumeRegularCredit(
  db: SupabaseClient,
  params: {
    tenantId: string;
    packageId: string;
    sessionId: string;
    attendanceId: string;
  },
) {
  const { data: credit, error } = await db
    .from("lesson_credits")
    .select("*")
    .eq("student_package_id", params.packageId)
    .eq("status", "available")
    .order("credit_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!credit) return null;

  const { error: updErr } = await db
    .from("lesson_credits")
    .update({
      status: "consumed",
      consumed_session_id: params.sessionId,
      consumed_attendance_id: params.attendanceId,
    })
    .eq("id", credit.id)
    .eq("status", "available");
  if (updErr) throw updErr;
  return credit;
}

async function maybeCreateMakeup(
  db: SupabaseClient,
  params: {
    tenantId: string;
    studentPersonId: string;
    attendanceId: string;
    packageId: string;
    plan: PackagePlanSnapshot;
    attendanceStatus: string;
  },
) {
  const policy = params.plan.makeup_policy;
  if (policy === "NEVER") return null;
  if (
    policy === "ONLY_IF_NOTIFIED" &&
    params.attendanceStatus !== "absent_notified"
  ) {
    return null;
  }
  if (
    policy === "ALWAYS_CREATE_ON_ABSENCE" &&
    !["absent", "absent_notified"].includes(params.attendanceStatus)
  ) {
    return null;
  }

  const validUntil = addDays(new Date(), params.plan.makeup_validity_days);
  const { data, error } = await db
    .from("makeup_credits")
    .insert({
      tenant_id: params.tenantId,
      student_person_id: params.studentPersonId,
      source_attendance_id: params.attendanceId,
      source_package_id: params.packageId,
      status: "available",
      valid_until: validUntil.toISOString(),
      rules_snapshot: {
        policy,
        makeup_validity_days: params.plan.makeup_validity_days,
      },
    })
    .select("*")
    .single();
  if (error) throw error;

  await enqueueNotification(db, {
    tenantId: params.tenantId,
    recipientPersonId: params.studentPersonId,
    channel: "telegram",
    templateCode: "makeup.created",
    payload: { makeupCreditId: data.id, validUntil: validUntil.toISOString() },
  });

  return data;
}

export async function bulkUpsertAttendance(
  db: SupabaseClient,
  params: {
    tenantId: string;
    sessionId: string;
    items: BulkAttendanceItem[];
    markedBy?: string | null;
    requestId?: string;
  },
) {
  const results = [];

  for (const item of params.items) {
    const { data: row, error } = await db
      .from("attendance")
      .upsert(
        {
          tenant_id: params.tenantId,
          session_id: params.sessionId,
          enrollment_id: item.enrollmentId,
          student_person_id: item.studentPersonId,
          attendance_type: item.attendanceType,
          status: item.status,
          marked_by: params.markedBy ?? null,
          marked_at: new Date().toISOString(),
          comment: item.comment ?? null,
        },
        { onConflict: "session_id,enrollment_id" },
      )
      .select("*")
      .single();
    if (error) throw error;

    const pkg = await findActivePackageForEnrollment(db, item.enrollmentId);
    if (pkg && item.attendanceType === "regular") {
      const plan = pkg.plan_snapshot as PackagePlanSnapshot;
      await consumeRegularCredit(db, {
        tenantId: params.tenantId,
        packageId: pkg.id,
        sessionId: params.sessionId,
        attendanceId: row.id,
      });

      if (["absent", "absent_notified"].includes(item.status)) {
        await maybeCreateMakeup(db, {
          tenantId: params.tenantId,
          studentPersonId: item.studentPersonId,
          attendanceId: row.id,
          packageId: pkg.id,
          plan,
          attendanceStatus: item.status,
        });
      }

      const remaining = await db
        .from("lesson_credits")
        .select("*", { count: "exact", head: true })
        .eq("student_package_id", pkg.id)
        .eq("status", "available");

      if ((remaining.count ?? 0) === 1) {
        await enqueueNotification(db, {
          tenantId: params.tenantId,
          recipientPersonId: item.studentPersonId,
          channel: "telegram",
          templateCode: "credits.low_balance",
          payload: { remaining: 1, packageId: pkg.id },
        });
      }
    }

    await writeAudit(db, {
      tenantId: params.tenantId,
      actorPersonId: params.markedBy ?? null,
      action: "attendance.marked",
      entityType: "attendance",
      entityId: row.id,
      after: item,
      requestId: params.requestId,
    });

    results.push(row);
  }

  return results;
}
