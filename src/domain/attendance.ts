import { addDays, differenceInMinutes } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BulkAttendanceItem, PackagePlanSnapshot } from "@/lib/types/domain";
import { writeAudit } from "@/domain/audit";
import {
  enqueueBestNotification,
} from "@/domain/notifications";
import { warsawDayRange } from "@/lib/format-date";
import { STUDIO_POLICY, cutoffMinutes } from "@/lib/studio-policy";

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

async function findActivePackageForStudent(
  db: SupabaseClient,
  studentPersonId: string,
) {
  const { data: enrollments, error: eErr } = await db
    .from("enrollments")
    .select("id")
    .eq("student_person_id", studentPersonId)
    .eq("status", "active");
  if (eErr) throw eErr;
  const ids = (enrollments ?? []).map((e) => e.id);
  if (!ids.length) return null;
  const { data, error } = await db
    .from("student_packages")
    .select("*")
    .in("enrollment_id", ids)
    .eq("status", "active")
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function defaultMakeupPlan(
  pkgPlan?: PackagePlanSnapshot | null,
): PackagePlanSnapshot {
  return {
    id: pkgPlan?.id ?? "studio-default",
    name: pkgPlan?.name ?? "Studio",
    lessons_count: pkgPlan?.lessons_count ?? 4,
    validity_days: pkgPlan?.validity_days ?? 60,
    price_gross: pkgPlan?.price_gross ?? 0,
    currency: pkgPlan?.currency ?? "PLN",
    start_policy: pkgPlan?.start_policy ?? "on_payment",
    // Studio rule: отработка только если предупредил
    makeup_policy: "ONLY_IF_NOTIFIED",
    makeup_validity_days:
      pkgPlan?.makeup_validity_days ?? STUDIO_POLICY.makeupValidityDays,
    booking_cutoff_minutes: pkgPlan?.booking_cutoff_minutes ?? 120,
  };
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

  const { data: consumed, error: updErr } = await db
    .from("lesson_credits")
    .update({
      status: "consumed",
      consumed_session_id: params.sessionId,
      consumed_attendance_id: params.attendanceId,
    })
    .eq("id", credit.id)
    .eq("status", "available")
    .select("*")
    .maybeSingle();
  if (updErr) throw updErr;
  return consumed;
}

async function notificationRecipient(
  db: SupabaseClient,
  studentPersonId: string,
) {
  const { data: contact } = await db
    .from("student_contacts")
    .select("contact_person_id")
    .eq("student_person_id", studentPersonId)
    .eq("can_receive_notifications", true)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  return contact?.contact_person_id ?? studentPersonId;
}

async function maybeCreateMakeup(
  db: SupabaseClient,
  params: {
    tenantId: string;
    studentPersonId: string;
    attendanceId: string;
    packageId?: string | null;
    plan: PackagePlanSnapshot;
    attendanceStatus: string;
    notify?: boolean;
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
      source_package_id: params.packageId ?? null,
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

  if (params.notify !== false) {
    try {
      await enqueueBestNotification(db, {
        tenantId: params.tenantId,
        recipientPersonId: await notificationRecipient(db, params.studentPersonId),
        templateCode: "makeup.created",
        payload: {
          makeupCreditId: data.id,
          validUntil: validUntil.toISOString(),
          cabinetUrl: `${(process.env.NEXT_PUBLIC_APP_URL || "https://popularcrm.vercel.app").replace(/\/$/, "")}/cabinet/makeups`,
        },
        dedupeKey: `makeup:${data.id}:created`,
      });
    } catch (notificationError) {
      // The credit exists already; a delivery outage must not break attendance.
      console.error("[makeup] notification", notificationError);
    }
  }

  return data;
}

function shouldCreateMakeup(plan: PackagePlanSnapshot, status: string) {
  if (plan.makeup_policy === "NEVER") return false;
  if (plan.makeup_policy === "ONLY_IF_NOTIFIED") {
    return status === "absent_notified";
  }
  return ["absent", "absent_notified"].includes(status);
}

export async function bulkUpsertAttendance(
  db: SupabaseClient,
  params: {
    tenantId: string;
    sessionId: string;
    items: BulkAttendanceItem[];
    markedBy?: string | null;
    requestId?: string;
    /** A range absence sends one summary instead of one Telegram message per class. */
    notifyMakeup?: boolean;
  },
) {
  const results = [];
  const createdMakeups: string[] = [];

  const { data: session, error: sessionError } = await db
    .from("sessions")
    .select("id, group_id, status")
    .eq("id", params.sessionId)
    .eq("tenant_id", params.tenantId)
    .single();
  if (sessionError) throw sessionError;

  for (const item of params.items) {
    const { data: enrollment, error: enrollmentError } = await db
      .from("enrollments")
      .select("id, group_id, student_person_id")
      .eq("id", item.enrollmentId)
      .eq("tenant_id", params.tenantId)
      .single();
    if (enrollmentError) throw enrollmentError;
    if (
      enrollment.group_id !== session.group_id ||
      enrollment.student_person_id !== item.studentPersonId
    ) {
      throw new Error("Ученик не относится к выбранному занятию");
    }

    const { data: before } = await db
      .from("attendance")
      .select("*")
      .eq("session_id", params.sessionId)
      .eq("enrollment_id", item.enrollmentId)
      .maybeSingle();

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

    const pkgOnEnrollment = await findActivePackageForEnrollment(
      db,
      item.enrollmentId,
    );
    // Credit burn only against package of THIS group/enrollment.
    if (pkgOnEnrollment && item.attendanceType === "regular") {
      const { data: linkedCredit } = await db
        .from("lesson_credits")
        .select("*")
        .eq("student_package_id", pkgOnEnrollment.id)
        .eq("consumed_attendance_id", row.id)
        .maybeSingle();

      let consumedNow = false;
      if (item.status === "cancelled_by_studio") {
        if (linkedCredit) {
          const { error: restoreError } = await db
            .from("lesson_credits")
            .update({
              status: "available",
              consumed_session_id: null,
              consumed_attendance_id: null,
            })
            .eq("id", linkedCredit.id);
          if (restoreError) throw restoreError;
        }
      } else if (!linkedCredit) {
        consumedNow = Boolean(
          await consumeRegularCredit(db, {
            tenantId: params.tenantId,
            packageId: pkgOnEnrollment.id,
            sessionId: params.sessionId,
            attendanceId: row.id,
          }),
        );
      }

      if (consumedNow) {
        const remaining = await db
          .from("lesson_credits")
          .select("*", { count: "exact", head: true })
          .eq("student_package_id", pkgOnEnrollment.id)
          .eq("status", "available");

        if ((remaining.count ?? 0) === 1) {
          try {
            await enqueueBestNotification(db, {
              tenantId: params.tenantId,
              recipientPersonId: await notificationRecipient(
                db,
                item.studentPersonId,
              ),
              templateCode: "credits.low_balance",
              payload: { remaining: 1, packageId: pkgOnEnrollment.id },
              dedupeKey: `package:${pkgOnEnrollment.id}:low-balance`,
            });
          } catch (notificationError) {
            console.error("[credits] low balance notification", notificationError);
          }
        }
      }
    }

    // Makeup: предупредил → отработка, даже если пакет на другой группе.
    if (item.attendanceType === "regular") {
      const pkgForMakeup =
        pkgOnEnrollment ??
        (await findActivePackageForStudent(db, item.studentPersonId));
      const plan = defaultMakeupPlan(
        (pkgForMakeup?.plan_snapshot as PackagePlanSnapshot | null) ?? null,
      );
      const { data: existingMakeup } = await db
        .from("makeup_credits")
        .select("id, status")
        .eq("source_attendance_id", row.id)
        .maybeSingle();
      const needsMakeup = shouldCreateMakeup(plan, item.status);

      if (needsMakeup && !existingMakeup) {
        const makeup = await maybeCreateMakeup(db, {
          tenantId: params.tenantId,
          studentPersonId: item.studentPersonId,
          attendanceId: row.id,
          packageId: pkgForMakeup?.id ?? null,
          plan,
          attendanceStatus: item.status,
          notify: params.notifyMakeup,
        });
        if (makeup) createdMakeups.push(makeup.id);
      } else if (!needsMakeup && existingMakeup?.status === "available") {
        const { error: deleteError } = await db
          .from("makeup_credits")
          .delete()
          .eq("id", existingMakeup.id);
        if (deleteError) throw deleteError;
      }
    }

    await writeAudit(db, {
      tenantId: params.tenantId,
      actorPersonId: params.markedBy ?? null,
      action: "attendance.marked",
      entityType: "attendance",
      entityId: row.id,
      before,
      after: item,
      requestId: params.requestId,
    });

    results.push(row);
  }

  return { marked: results.length, rows: results, createdMakeups };
}

export async function reportCantAttendDb(
  db: SupabaseClient,
  params: {
    tenantId: string;
    sessionId: string;
    actorPersonId: string;
    studentPersonId?: string;
    requestId?: string;
    notifyMakeup?: boolean;
  },
) {
  const { data: session, error: sessionError } = await db
    .from("sessions")
    .select("id, group_id, starts_at, status")
    .eq("id", params.sessionId)
    .eq("tenant_id", params.tenantId)
    .single();
  if (sessionError) throw sessionError;
  if (session.status !== "scheduled") {
    throw new Error("На это занятие уже нельзя сообщить об отсутствии");
  }
  if (
    differenceInMinutes(new Date(session.starts_at), new Date()) <
    cutoffMinutes()
  ) {
    throw new Error(
      `Сообщить об отсутствии нужно минимум за ${STUDIO_POLICY.absentNotifyCutoffHours} ч`,
    );
  }

  const studentPersonId = params.studentPersonId ?? params.actorPersonId;
  if (studentPersonId !== params.actorPersonId) {
    const { data: relation } = await db
      .from("student_contacts")
      .select("id")
      .eq("student_person_id", studentPersonId)
      .eq("contact_person_id", params.actorPersonId)
      .in("relation_type", ["parent", "guardian"])
      .maybeSingle();
    if (!relation) {
      throw new Error("Нет прав отметить отсутствие за этого ребёнка");
    }
  }

  const { data: enrollment, error: enrollmentError } = await db
    .from("enrollments")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("group_id", session.group_id)
    .eq("student_person_id", studentPersonId)
    .eq("status", "active")
    .single();
  if (enrollmentError) throw enrollmentError;

  const result = await bulkUpsertAttendance(db, {
    tenantId: params.tenantId,
    sessionId: params.sessionId,
    items: [
      {
        enrollmentId: enrollment.id,
        studentPersonId,
        attendanceType: "regular",
        status: "absent_notified",
        comment:
          studentPersonId === params.actorPersonId
            ? "self-service absence"
            : "parent reported child absence",
      },
    ],
    markedBy: params.actorPersonId,
    requestId: params.requestId,
    notifyMakeup: params.notifyMakeup,
  });

  return {
    ...result,
    studentPersonId,
    message: result.createdMakeups?.length
      ? studentPersonId === params.actorPersonId
        ? "Готово: тебя не ждут. Отработка уже в разделе «Отработки»."
        : "Готово: ребёнка не ждут. Отработка уже в разделе «Отработки»."
      : studentPersonId === params.actorPersonId
        ? "Готово: студия знает, что тебя не будет."
        : "Готово: студия знает, что ребёнка не будет.",
  };
}

export type PlannedAbsenceItem = {
  sessionId: string;
  title: string;
  startsAt: string;
  studentPersonId: string;
};

export type PlannedAbsenceSkipped = PlannedAbsenceItem & {
  reason: string;
};

type PlannedAbsenceCandidates = {
  eligible: PlannedAbsenceItem[];
  skipped: PlannedAbsenceSkipped[];
};

async function assertCanReportForStudent(
  db: SupabaseClient,
  actorPersonId: string,
  studentPersonId: string,
) {
  if (studentPersonId === actorPersonId) return;
  const { data: relation, error } = await db
    .from("student_contacts")
    .select("id")
    .eq("student_person_id", studentPersonId)
    .eq("contact_person_id", actorPersonId)
    .in("relation_type", ["parent", "guardian"])
    .maybeSingle();
  if (error) throw error;
  if (!relation) throw new Error("Нет прав отметить отсутствие за этого ребёнка");
}

async function findPlannedAbsenceCandidatesDb(
  db: SupabaseClient,
  params: {
    tenantId: string;
    actorPersonId: string;
    studentPersonId: string;
    startsOn: string;
    endsOn: string;
  },
): Promise<PlannedAbsenceCandidates> {
  await assertCanReportForStudent(
    db,
    params.actorPersonId,
    params.studentPersonId,
  );

  const { data: enrollments, error: enrollmentError } = await db
    .from("enrollments")
    .select("id, group_id")
    .eq("tenant_id", params.tenantId)
    .eq("student_person_id", params.studentPersonId)
    .eq("status", "active");
  if (enrollmentError) throw enrollmentError;

  const activeEnrollments = enrollments ?? [];
  const groupIds = [...new Set(activeEnrollments.map((item) => item.group_id))];
  if (!groupIds.length) return { eligible: [], skipped: [] };

  const start = warsawDayRange(params.startsOn).start;
  const end = warsawDayRange(params.endsOn).end;
  const [{ data: sessions, error: sessionError }, { data: groups, error: groupError }] =
    await Promise.all([
      db
        .from("sessions")
        .select("id, group_id, starts_at, status")
        .eq("tenant_id", params.tenantId)
        .in("group_id", groupIds)
        .gte("starts_at", start)
        .lt("starts_at", end)
        .order("starts_at", { ascending: true }),
      db
        .from("groups")
        .select("id, title")
        .eq("tenant_id", params.tenantId)
        .in("id", groupIds),
    ]);
  if (sessionError) throw sessionError;
  if (groupError) throw groupError;

  const sessionRows = sessions ?? [];
  const sessionIds = sessionRows.map((session) => session.id);
  const enrollmentIds = activeEnrollments.map((enrollment) => enrollment.id);
  const { data: attendance, error: attendanceError } = sessionIds.length
    ? await db
        .from("attendance")
        .select("session_id, enrollment_id, status")
        .in("session_id", sessionIds)
        .in("enrollment_id", enrollmentIds)
    : { data: [], error: null };
  if (attendanceError) throw attendanceError;

  const enrollmentByGroup = new Map(
    activeEnrollments.map((enrollment) => [enrollment.group_id, enrollment]),
  );
  const groupTitleById = new Map((groups ?? []).map((group) => [group.id, group.title]));
  const attendanceBySession = new Map(
    (attendance ?? []).map((row) => [`${row.session_id}:${row.enrollment_id}`, row]),
  );
  const eligible: PlannedAbsenceItem[] = [];
  const skipped: PlannedAbsenceSkipped[] = [];

  for (const session of sessionRows) {
    const enrollment = enrollmentByGroup.get(session.group_id);
    if (!enrollment) continue;
    const item: PlannedAbsenceItem = {
      sessionId: session.id,
      title: groupTitleById.get(session.group_id) ?? "Занятие",
      startsAt: session.starts_at,
      studentPersonId: params.studentPersonId,
    };
    if (session.status !== "scheduled") {
      skipped.push({ ...item, reason: "занятие уже отменено или завершено" });
      continue;
    }
    if (
      differenceInMinutes(new Date(session.starts_at), new Date()) <
      cutoffMinutes()
    ) {
      skipped.push({
        ...item,
        reason: `предупреждать нужно минимум за ${STUDIO_POLICY.absentNotifyCutoffHours} ч`,
      });
      continue;
    }
    const existing = attendanceBySession.get(`${session.id}:${enrollment.id}`);
    if (existing?.status === "absent" || existing?.status === "absent_notified") {
      skipped.push({ ...item, reason: "отсутствие уже отмечено" });
      continue;
    }
    if (existing) {
      skipped.push({ ...item, reason: "посещаемость уже отмечена" });
      continue;
    }
    eligible.push(item);
  }

  return { eligible, skipped };
}

/** Preview or apply one planned absence (holiday/trip) for a student. */
export async function plannedAbsenceDb(
  db: SupabaseClient,
  params: {
    tenantId: string;
    actorPersonId: string;
    studentPersonId?: string;
    startsOn: string;
    endsOn: string;
    action: "preview" | "apply";
    requestId?: string;
  },
) {
  const studentPersonId = params.studentPersonId ?? params.actorPersonId;
  const candidates = await findPlannedAbsenceCandidatesDb(db, {
    ...params,
    studentPersonId,
  });
  if (params.action === "preview") {
    return { ...candidates, studentPersonId };
  }

  let moved = 0;
  let createdMakeups = 0;
  const skipped = [...candidates.skipped];
  for (const item of candidates.eligible) {
    try {
      const result = await reportCantAttendDb(db, {
        tenantId: params.tenantId,
        sessionId: item.sessionId,
        actorPersonId: params.actorPersonId,
        studentPersonId,
        requestId: params.requestId,
        notifyMakeup: false,
      });
      moved += 1;
      createdMakeups += result.createdMakeups?.length ?? 0;
    } catch (error) {
      skipped.push({
        ...item,
        reason: error instanceof Error ? error.message : "не удалось перенести",
      });
    }
  }

  if (moved > 0 && createdMakeups > 0) {
    try {
      await enqueueBestNotification(db, {
        tenantId: params.tenantId,
        recipientPersonId: studentPersonId,
        templateCode: "makeup.planned_absence",
        payload: {
          count: createdMakeups,
          cabinetUrl: `${(process.env.NEXT_PUBLIC_APP_URL || "https://popularcrm.vercel.app").replace(/\/$/, "")}/cabinet/makeups`,
        },
      });
    } catch (error) {
      // The absence is already saved; a notification outage must not roll it back.
      console.error("[planned-absence] notification", error);
    }
  }

  return {
    eligible: candidates.eligible,
    skipped,
    studentPersonId,
    moved,
    createdMakeups,
    message:
      moved > 0
        ? `Перенесли занятий: ${moved}. Отработок создано: ${createdMakeups}.`
        : "Нет занятий, которые можно перенести на выбранные даты.",
  };
}

export async function finalizeSessionDb(
  db: SupabaseClient,
  params: {
    tenantId: string;
    sessionId: string;
    actorPersonId: string;
    requestId?: string;
  },
) {
  const { data: session, error: sessionError } = await db
    .from("sessions")
    .select("id, group_id, status")
    .eq("id", params.sessionId)
    .eq("tenant_id", params.tenantId)
    .single();
  if (sessionError) throw sessionError;
  if (session.status === "cancelled_by_studio") {
    throw new Error("Отменённое занятие нельзя закрыть как проведённое");
  }

  const { data: roster, error: rosterError } = await db
    .from("enrollments")
    .select("id, student_person_id")
    .eq("tenant_id", params.tenantId)
    .eq("group_id", session.group_id)
    .eq("status", "active");
  if (rosterError) throw rosterError;

  const enrollmentIds = (roster ?? []).map((item) => item.id);
  const { data: existing } = enrollmentIds.length
    ? await db
        .from("attendance")
        .select("enrollment_id, status")
        .eq("session_id", params.sessionId)
        .in("enrollment_id", enrollmentIds)
    : { data: [] as Array<{ enrollment_id: string; status: string }> };
  const statusByEnrollment = new Map(
    (existing ?? []).map((item) => [item.enrollment_id, item.status]),
  );

  const result = await bulkUpsertAttendance(db, {
    tenantId: params.tenantId,
    sessionId: params.sessionId,
    items: (roster ?? []).map((item) => {
      const saved = statusByEnrollment.get(item.id);
      return {
        enrollmentId: item.id,
        studentPersonId: item.student_person_id,
        attendanceType: "regular" as const,
        status:
          saved === "absent" || saved === "absent_notified"
            ? saved
            : ("present" as const),
      };
    }),
    markedBy: params.actorPersonId,
    requestId: params.requestId,
  });

  const { error: updateError } = await db
    .from("sessions")
    .update({ status: "completed" })
    .eq("id", params.sessionId)
    .eq("tenant_id", params.tenantId);
  if (updateError) throw updateError;

  return result;
}
