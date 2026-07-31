import { getAdminClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { DEMO_TENANT_ID } from "@/lib/demo-store";
import { warsawDayRange, warsawYmd } from "@/lib/format-date";
import type { BrandId } from "@/lib/brands";

export function tenantIdOrDefault(tenantId?: string | null) {
  return tenantId || getEnv().DEFAULT_TENANT_ID || DEMO_TENANT_ID;
}

export async function findPersonByEmail(email: string, tenantId?: string) {
  const db = getAdminClient();
  const tid = tenantIdOrDefault(tenantId);
  // Prefer the oldest account if duplicates exist (import vs accidental re-create).
  const { data, error } = await db
    .from("persons")
    .select("id, tenant_id, full_name, email, onboarding_status, is_minor, status")
    .eq("tenant_id", tid)
    .ilike("email", email.trim())
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getPersonRoles(personId: string) {
  const db = getAdminClient();
  const { data, error } = await db
    .from("person_roles")
    .select("role")
    .eq("person_id", personId)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.role as string);
}

export async function issueMagicCode(email: string, tenantId: string) {
  const db = getAdminClient();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const { error } = await db.from("magic_login_codes").insert({
    tenant_id: tenantId,
    email: email.toLowerCase(),
    code,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

export async function consumeMagicCode(email: string, code: string) {
  const db = getAdminClient();
  const { data: row, error } = await db
    .from("magic_login_codes")
    .select("*")
    .eq("email", email.toLowerCase())
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.code !== code) return null;

  await db
    .from("magic_login_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);

  return row as { id: string; tenant_id: string; email: string };
}

export async function markPersonActivated(personId: string) {
  const db = getAdminClient();
  const { data: person } = await db
    .from("persons")
    .select("onboarding_status")
    .eq("id", personId)
    .maybeSingle();
  const status = person?.onboarding_status ?? "complete";
  if (status === "draft" || status === "invited") {
    await db
      .from("persons")
      .update({
        onboarding_status: "activated",
        activated_at: new Date().toISOString(),
      })
      .eq("id", personId);
  }
}

export async function getChildrenForParentDb(parentId: string) {
  const db = getAdminClient();
  const { data: links } = await db
    .from("student_contacts")
    .select("student_person_id")
    .eq("contact_person_id", parentId)
    .in("relation_type", ["parent", "guardian"]);
  const ids = (links ?? []).map((l) => l.student_person_id);
  if (!ids.length) return [];
  const { data: kids } = await db
    .from("persons")
    .select("id, full_name, email, is_minor, birth_date, tshirt_size, phone")
    .in("id", ids);
  return kids ?? [];
}

function packageFromRow(
  pkg: {
    id: string;
    enrollment_id: string;
    status: string;
    activated_at?: string | null;
    expires_at: string | null;
    plan_snapshot: { lessons_count?: number } | null;
  },
  credits: Array<{ student_package_id: string; status: string }>,
) {
  const mine = credits.filter((c) => c.student_package_id === pkg.id);
  const available = mine.filter((c) => c.status === "available").length;
  const total =
    mine.length ||
    Number(pkg.plan_snapshot?.lessons_count ?? 0) ||
    0;
  return {
    id: pkg.id,
    enrollment_id: pkg.enrollment_id,
    status: pkg.status,
    credits_available: available,
    credits_total: total,
    activated_at: pkg.activated_at ?? null,
    expires_at: pkg.expires_at ?? null,
    plan: pkg.plan_snapshot,
  };
}

export async function getCabinetDashboardDb(personId: string, tenantId: string) {
  const db = getAdminClient();
  const children = await getChildrenForParentDb(personId);
  const scopeIds = [personId, ...children.map((c) => c.id)];

  const { data: enrollments } = await db
    .from("enrollments")
    .select("id, student_person_id, group_id, status, brand_id")
    .in("student_person_id", scopeIds)
    .eq("status", "active")
    .eq("tenant_id", tenantId);

  const enrollList = enrollments ?? [];
  const groupIds = [...new Set(enrollList.map((e) => e.group_id))];
  const enrollmentIds = enrollList.map((e) => e.id);

  const [
    { data: groups },
    { data: sessions },
    { data: packages },
    { data: payments },
    { data: makeups },
    { data: scheduleRules },
  ] = await Promise.all([
      groupIds.length
        ? db
            .from("groups")
            .select("id, title, brand_id, capacity, direction")
            .in("id", groupIds)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              title: string;
              brand_id?: string;
              capacity?: number;
              direction?: string | null;
            }>,
          }),
      groupIds.length
        ? db
            .from("sessions")
            .select("id, group_id, starts_at, ends_at, status")
            .in("group_id", groupIds)
            .eq("tenant_id", tenantId)
            .gte("starts_at", new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString())
            .order("starts_at", { ascending: true })
            .limit(40)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      enrollmentIds.length
        ? db
            .from("student_packages")
            .select("id, enrollment_id, status, activated_at, expires_at, plan_snapshot")
            .in("enrollment_id", enrollmentIds)
            .eq("tenant_id", tenantId)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      db
        .from("payments")
        .select("*")
        .eq("payer_person_id", personId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(40),
      db
        .from("makeup_credits")
        .select(
          "id, student_person_id, status, valid_until, makeup_bookings(target_kind, target_session_id, tickets_event_id, status, booked_at)",
        )
        .in("student_person_id", scopeIds)
        .eq("tenant_id", tenantId),
      groupIds.length
        ? db
            .from("group_schedule_rules")
            .select("group_id, weekday, start_time, duration_minutes, room")
            .in("group_id", groupIds)
        : Promise.resolve({
            data: [] as Array<{
              group_id: string;
              weekday: number;
              start_time: string;
              duration_minutes: number | null;
              room: string | null;
            }>,
          }),
    ]);

  // Also payments linked via enrollment (import) when payer differs
  let payExtra: Array<Record<string, unknown>> = [];
  if (enrollmentIds.length) {
    const { data } = await db
      .from("payments")
      .select("*")
      .in("enrollment_id", enrollmentIds)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(40);
    payExtra = data ?? [];
  }
  const paySeen = new Set<string>();
  const paymentsMerged = [...(payments ?? []), ...payExtra].filter((p) => {
    const id = String((p as { id: string }).id);
    if (paySeen.has(id)) return false;
    paySeen.add(id);
    return true;
  });
  // rebind for rest of function
  const paymentsFinal = paymentsMerged;

  // sessions table has no title column — use group title
  const groupMap = new Map((groups ?? []).map((g) => [g.id, g]));
  const sessionRows = (sessions ?? []).map((s) => {
    const g = groupMap.get(s.group_id as string);
    return {
      id: s.id as string,
      group_id: s.group_id as string,
      title: g?.title ?? "Занятие",
      starts_at: s.starts_at as string,
      status: s.status as string,
    };
  });

  const sessionIds = sessionRows.map((s) => s.id);
  const { data: attendance } = sessionIds.length
    ? await db
        .from("attendance")
        .select("session_id, student_person_id, status")
        .in("session_id", sessionIds)
        .in("student_person_id", scopeIds)
    : { data: [] as Array<{ session_id: string; student_person_id: string; status: string }> };

  const schedule = enrollList.flatMap((e) =>
    sessionRows
      .filter((s) => s.group_id === e.group_id)
      .map((s) => {
        const att = (attendance ?? []).find(
          (a) => a.session_id === s.id && a.student_person_id === e.student_person_id,
        );
        return {
          ...s,
          myStatus: att?.status ?? null,
          forStudentId: e.student_person_id,
        };
      }),
  );
  const seen = new Set<string>();
  const scheduleUnique = schedule.filter((s) => {
    const key = `${s.id}:${s.forStudentId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const pkgRows = (packages ?? []) as Array<{
    id: string;
    enrollment_id: string;
    status: string;
    activated_at?: string | null;
    expires_at: string | null;
    plan_snapshot: { lessons_count?: number } | null;
  }>;
  const pkgIds = pkgRows.map((p) => p.id);
  const { data: credits } = pkgIds.length
    ? await db
        .from("lesson_credits")
        .select("student_package_id, status")
        .in("student_package_id", pkgIds)
    : { data: [] as Array<{ student_package_id: string; status: string }> };

  const mappedPackages = pkgRows
    .filter((p) => p.status === "active")
    .map((p) => packageFromRow(p, credits ?? []));

  const paymentIds = paymentsFinal.map((p) => (p as { id: string }).id);
  const { data: invoices } = paymentIds.length
    ? await db.from("invoices").select("*").in("payment_id", paymentIds).limit(20)
    : { data: [] as Array<Record<string, unknown>> };

  const { formatGroupCard, moneyStatusLabel } = await import("@/lib/group-display");
  const rulesByGroup = new Map<
    string,
    Array<{
      weekday: number;
      start_time: string;
      duration_minutes?: number | null;
      room?: string | null;
    }>
  >();
  for (const r of scheduleRules ?? []) {
    const list = rulesByGroup.get(r.group_id) ?? [];
    list.push({
      weekday: r.weekday,
      start_time: r.start_time,
      duration_minutes: r.duration_minutes,
      room: r.room,
    });
    rulesByGroup.set(r.group_id, list);
  }

  const enrichedGroups = (groups ?? []).map((g) => {
    const card = formatGroupCard({
      title: g.title,
      direction: (g as { direction?: string | null }).direction,
      rules: rulesByGroup.get(g.id) ?? [],
    });
    return {
      ...g,
      direction: (g as { direction?: string | null }).direction ?? null,
      rules: rulesByGroup.get(g.id) ?? [],
      direction_label: card.direction_label,
      schedule_label: card.schedule_label,
      subtitle: card.subtitle,
    };
  });

  const payRows = paymentsFinal as Array<{
    amount: number | string;
    amount_paid: number | string;
    status: string;
    paid_at?: string | null;
    created_at?: string;
  }>;
  let debtOpen = 0;
  for (const p of payRows) {
    if (["pending", "partial"].includes(p.status)) {
      debtOpen += Math.max(0, Number(p.amount) - Number(p.amount_paid));
    }
  }
  const lastPaid = payRows.find((p) => p.status === "paid" || Number(p.amount_paid) > 0);
  const creditsLeft = mappedPackages.reduce((s, p) => s + p.credits_available, 0);
  const money = {
    debt_open: Math.round(debtOpen),
    debt_count: payRows.filter((p) => ["pending", "partial"].includes(p.status)).length,
    credits_left: mappedPackages.length ? creditsLeft : null,
    has_package: mappedPackages.length > 0,
    last_paid_at: lastPaid?.paid_at ?? lastPaid?.created_at ?? null,
    last_paid_amount: lastPaid ? Math.round(Number(lastPaid.amount_paid)) : null,
    label: moneyStatusLabel({
      debtOpen,
      creditsLeft: mappedPackages.length ? creditsLeft : null,
      hasPackage: mappedPackages.length > 0,
    }),
  };

  // Soft attendance note for the client — no heavy analytics
  const { data: attHist } = await db
    .from("attendance")
    .select("status")
    .eq("student_person_id", personId)
    .in("status", ["present", "absent", "absent_notified"])
    .limit(80);
  const attRows = attHist ?? [];
  const presentCount = attRows.filter((a) => a.status === "present").length;
  const markedCount = attRows.length;
  const rate =
    markedCount > 0 ? Math.round((presentCount / markedCount) * 100) : null;
  let attendance_note: { message: string; present: number; total: number; rate: number } | null =
    null;
  if (markedCount >= 5 && rate != null && rate >= 70) {
    attendance_note = {
      message: `Спасибо, что регулярно ходишь — ${presentCount} из ${markedCount} занятий. Это заметно и ценно.`,
      present: presentCount,
      total: markedCount,
      rate,
    };
  } else if (markedCount >= 3 && rate != null && rate >= 50) {
    attendance_note = {
      message: `Рады видеть тебя на занятиях — уже ${presentCount} из ${markedCount}.`,
      present: presentCount,
      total: markedCount,
      rate,
    };
  }

  const makeupsNormalized = (makeups ?? []).map((m) => {
    const bookings = Array.isArray(
      (m as { makeup_bookings?: unknown }).makeup_bookings,
    )
      ? (
          m as {
            makeup_bookings: Array<{
              status: string;
              target_kind?: string;
              target_session_id?: string;
              tickets_event_id?: string;
            }>;
          }
        ).makeup_bookings
      : [];
    const active = bookings.find((b) => b.status === "booked");
    return {
      id: m.id,
      student_person_id: m.student_person_id,
      status: m.status,
      valid_until: m.valid_until,
      target_kind: active?.target_kind ?? null,
      target_session_id: active?.target_session_id ?? null,
      tickets_event_id: active?.tickets_event_id ?? null,
    };
  });

  return {
    children,
    schedule: scheduleUnique,
    packages: mappedPackages,
    makeups: makeupsNormalized,
    payments: paymentsFinal,
    invoices: invoices ?? [],
    groups: enrichedGroups,
    money,
    attendance_note,
  };
}

export async function listGroupsDb(
  tenantId: string,
  brandId: BrandId,
  opts?: { includeInactive?: boolean },
) {
  const db = getAdminClient();
  let q = db
    .from("groups")
    .select("id, title, capacity, brand_id, status, direction, teacher_person_id")
    .eq("tenant_id", tenantId)
    .eq("brand_id", brandId)
    .order("title");
  if (!opts?.includeInactive) {
    q = q.eq("status", "active");
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const teacherIds = [
    ...new Set(
      (data ?? [])
        .map((g) => g.teacher_person_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const teacherMap = new Map<string, string>();
  if (teacherIds.length) {
    const { data: teachers } = await db
      .from("persons")
      .select("id, full_name")
      .in("id", teacherIds);
    for (const t of teachers ?? []) teacherMap.set(t.id, t.full_name);
  }

  const groupIds = (data ?? []).map((g) => g.id);
  const rulesByGroup = new Map<
    string,
    Array<{ weekday: number; start_time: string; room: string | null }>
  >();
  if (groupIds.length) {
    const { data: rules } = await db
      .from("group_schedule_rules")
      .select("group_id, weekday, start_time, room")
      .in("group_id", groupIds);
    for (const r of rules ?? []) {
      const list = rulesByGroup.get(r.group_id) ?? [];
      list.push({
        weekday: r.weekday,
        start_time: r.start_time,
        room: r.room,
      });
      rulesByGroup.set(r.group_id, list);
    }
  }

  const { formatGroupCard } = await import("@/lib/group-display");
  return (data ?? []).map((g) => {
    const card = formatGroupCard({
      title: g.title,
      direction: g.direction,
      status: g.status,
      rules: rulesByGroup.get(g.id) ?? [],
    });
    return {
      id: g.id,
      brand_id: g.brand_id ?? brandId,
      title: g.title,
      capacity: g.capacity ?? 12,
      status: (g.status as "active" | "archived") || "active",
      direction: g.direction ?? null,
      direction_label: card.direction_label,
      schedule_label: card.schedule_label,
      status_label: card.status_label,
      subtitle: card.subtitle,
      teacher_name: (g.teacher_person_id && teacherMap.get(g.teacher_person_id)) || "—",
    };
  });
}

export async function getGroupDetailDb(groupId: string, tenantId: string) {
  const db = getAdminClient();
  let group: Record<string, unknown> | null = null;
  const full = await db
    .from("groups")
    .select(
      "id, title, capacity, brand_id, status, direction, teacher_person_id, telegram_chat_id, telegram_bind_token, telegram_bind_expires_at",
    )
    .eq("id", groupId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (
    full.error &&
    /telegram_bind_token|schema cache|does not exist/i.test(full.error.message)
  ) {
    const basic = await db
      .from("groups")
      .select(
        "id, title, capacity, brand_id, status, direction, teacher_person_id, telegram_chat_id",
      )
      .eq("id", groupId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (basic.error) throw new Error(basic.error.message);
    group = basic.data;
  } else if (full.error) {
    throw new Error(full.error.message);
  } else {
    group = full.data;
  }
  if (!group) throw new Error("Группа не найдена");

  const { data: rules } = await db
    .from("group_schedule_rules")
    .select("weekday, start_time, duration_minutes, room")
    .eq("group_id", groupId);

  const { data: enrollments } = await db
    .from("enrollments")
    .select("id, student_person_id, status, started_at, ended_at")
    .eq("group_id", groupId)
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false });

  const personIds = [...new Set((enrollments ?? []).map((e) => e.student_person_id))];
  const { data: persons } = personIds.length
    ? await db
        .from("persons")
        .select("id, full_name, email, phone, telegram_username, birth_date, tshirt_size")
        .in("id", personIds)
    : { data: [] as Array<Record<string, unknown>> };
  const personMap = new Map((persons ?? []).map((p) => [p.id as string, p]));

  const { formatGroupCard, enrollmentStatusLabel } = await import(
    "@/lib/group-display"
  );
  const card = formatGroupCard({
    title: group.title as string,
    direction: (group.direction as string | null) ?? null,
    status: group.status as string,
    rules: rules ?? [],
  });

  const members = (enrollments ?? []).map((e) => {
    const p = personMap.get(e.student_person_id);
    return {
      enrollment_id: e.id,
      student_person_id: e.student_person_id,
      status: e.status as string,
      status_label: enrollmentStatusLabel(e.status as string),
      started_at: e.started_at,
      ended_at: e.ended_at,
      full_name: (p?.full_name as string) ?? "—",
      email: (p?.email as string | null) ?? null,
      phone: (p?.phone as string | null) ?? null,
      telegram_username: (p?.telegram_username as string | null) ?? null,
      birth_date: (p?.birth_date as string | null) ?? null,
      tshirt_size: (p?.tshirt_size as string | null) ?? null,
    };
  });
  members.sort((a, b) => {
    const rank = (s: string) =>
      s === "active" ? 0 : s === "paused" ? 1 : 2;
    return rank(a.status) - rank(b.status) || a.full_name.localeCompare(b.full_name, "ru");
  });

  const tgChat = (group.telegram_chat_id as number | null | undefined) ?? null;
  const bindToken = (group.telegram_bind_token as string | null | undefined) ?? null;
  const bindExp = (group.telegram_bind_expires_at as string | null | undefined) ?? null;

  return {
    group: {
      ...group,
      telegram_chat_id: tgChat,
      telegram_linked: Boolean(tgChat),
      telegram_bind_pending: Boolean(
        bindToken && bindExp && new Date(bindExp) > new Date(),
      ),
      direction_label: card.direction_label,
      schedule_label: card.schedule_label,
      status_label: card.status_label,
      subtitle: card.subtitle,
      rules: rules ?? [],
    },
    members,
    counts: {
      active: members.filter((m) => m.status === "active").length,
      paused: members.filter((m) => m.status === "paused").length,
      ended: members.filter((m) => m.status === "ended").length,
    },
  };
}

export async function setEnrollmentStatusDb(input: {
  enrollmentId: string;
  tenantId: string;
  status: "active" | "paused" | "ended";
}) {
  const db = getAdminClient();
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === "ended") {
    patch.ended_at = new Date().toISOString();
  } else if (input.status === "active") {
    patch.ended_at = null;
  }
  const { data, error } = await db
    .from("enrollments")
    .update(patch)
    .eq("id", input.enrollmentId)
    .eq("tenant_id", input.tenantId)
    .select("id, status, group_id, student_person_id")
    .single();
  if (error) throw new Error(error.message);

  if (input.status === "active" && data?.student_person_id && data?.group_id) {
    try {
      const { sendTelegramGroupInviteForPersonDb } = await import(
        "@/lib/group-telegram"
      );
      await sendTelegramGroupInviteForPersonDb(data.student_person_id, {
        groupId: data.group_id,
      });
    } catch (e) {
      console.error("[enrollment] tg invite", e);
    }
  }

  return data;
}

export async function updateGroupDb(
  groupId: string,
  tenantId: string,
  patch: {
    title?: string;
    direction?: string | null;
    status?: "active" | "archived";
    capacity?: number;
    telegram_chat_id?: number | null;
  },
) {
  const db = getAdminClient();
  const { data, error } = await db
    .from("groups")
    .update(patch)
    .eq("id", groupId)
    .eq("tenant_id", tenantId)
    .select("id, title, direction, status, capacity, brand_id, telegram_chat_id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function setGroupStatusDb(
  groupId: string,
  tenantId: string,
  status: "active" | "archived",
) {
  const db = getAdminClient();
  const { data, error } = await db
    .from("groups")
    .update({ status })
    .eq("id", groupId)
    .eq("tenant_id", tenantId)
    .select("id, title, status, brand_id, capacity")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function moveEnrollmentDb(input: {
  enrollmentId: string;
  toGroupId: string;
  tenantId: string;
}) {
  const db = getAdminClient();
  const { data: enr, error: e1 } = await db
    .from("enrollments")
    .select("id, tenant_id, student_person_id, group_id, plan_id, brand_id, status, tags")
    .eq("id", input.enrollmentId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!enr) throw new Error("Enrollment not found");
  if (enr.status !== "active") throw new Error("Enrollment is not active");
  if (enr.group_id === input.toGroupId) throw new Error("Already in this group");

  const { data: target, error: e2 } = await db
    .from("groups")
    .select("id, status, brand_id")
    .eq("id", input.toGroupId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (e2) throw new Error(e2.message);
  if (!target) throw new Error("Target group not found");
  if (target.status !== "active") throw new Error("Target group is not active");

  const { data: existingActive } = await db
    .from("enrollments")
    .select("id")
    .eq("student_person_id", enr.student_person_id)
    .eq("group_id", input.toGroupId)
    .eq("status", "active")
    .maybeSingle();
  if (existingActive) throw new Error("Student already active in target group");

  // end current
  const { error: endErr } = await db
    .from("enrollments")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", enr.id);
  if (endErr) throw new Error(endErr.message);

  // reactivate ended in target, or insert new
  const { data: endedTarget } = await db
    .from("enrollments")
    .select("id")
    .eq("student_person_id", enr.student_person_id)
    .eq("group_id", input.toGroupId)
    .eq("status", "ended")
    .maybeSingle();

  let newId: string;
  if (endedTarget) {
    const { data: revived, error: rErr } = await db
      .from("enrollments")
      .update({
        status: "active",
        ended_at: null,
        brand_id: target.brand_id ?? enr.brand_id,
        started_at: new Date().toISOString(),
      })
      .eq("id", endedTarget.id)
      .select("id")
      .single();
    if (rErr) throw new Error(rErr.message);
    newId = revived.id;
  } else {
    const { data: created, error: cErr } = await db
      .from("enrollments")
      .insert({
        tenant_id: input.tenantId,
        student_person_id: enr.student_person_id,
        group_id: input.toGroupId,
        plan_id: enr.plan_id,
        status: "active",
        brand_id: target.brand_id ?? enr.brand_id,
        tags: enr.tags ?? [],
      })
      .select("id")
      .single();
    if (cErr) throw new Error(cErr.message);
    newId = created.id;
  }

  // move open package + unpaid payments to new enrollment
  await db
    .from("student_packages")
    .update({ enrollment_id: newId })
    .eq("enrollment_id", enr.id)
    .eq("status", "active");
  await db
    .from("payments")
    .update({ enrollment_id: newId })
    .eq("enrollment_id", enr.id)
    .in("status", ["pending", "partial"]);

  return {
    from_enrollment_id: enr.id,
    to_enrollment_id: newId,
    student_person_id: enr.student_person_id,
    from_group_id: enr.group_id,
    to_group_id: input.toGroupId,
  };
}

export async function listStudentsDb(tenantId: string, brandId: BrandId) {
  const db = getAdminClient();
  // All enrollment statuses so admin can see who stopped attending
  const { data: enrollments } = await db
    .from("enrollments")
    .select("id, student_person_id, group_id, brand_id, status")
    .eq("tenant_id", tenantId)
    .eq("brand_id", brandId);

  const studentIds = [...new Set((enrollments ?? []).map((e) => e.student_person_id))];
  if (!studentIds.length) {
    // also list any students with role even without enrollment for brand
    const { data: roleRows } = await db
      .from("person_roles")
      .select("person_id")
      .eq("tenant_id", tenantId)
      .eq("role", "student")
      .is("revoked_at", null);
    const ids = (roleRows ?? []).map((r) => r.person_id);
    if (!ids.length) return { students: [], enrollments: [], contacts: [], groups: [] };
    const { data: persons } = await db.from("persons").select("*").in("id", ids);
    return {
      students: (persons ?? []).map((p) => ({
        ...p,
        onboarding_status: p.onboarding_status ?? "draft",
        telegram_linked: false,
      })),
      enrollments: [],
      contacts: [],
      groups: await listGroupsDb(tenantId, brandId),
    };
  }

  const [{ data: persons }, { data: contacts }, groups] = await Promise.all([
    db.from("persons").select("*").in("id", studentIds),
    db
      .from("student_contacts")
      .select("*")
      .in("student_person_id", studentIds),
    listGroupsDb(tenantId, brandId),
  ]);

  // include parents linked to these students
  const parentIds = [...new Set((contacts ?? []).map((c) => c.contact_person_id))];
  let parents: Array<Record<string, unknown>> = [];
  if (parentIds.length) {
    const { data } = await db.from("persons").select("*").in("id", parentIds);
    parents = data ?? [];
  }

  const allPeople = [...(persons ?? []), ...parents];
  const uniq = new Map(allPeople.map((p) => [p.id as string, p]));

  return {
    students: [...uniq.values()].map((p) => ({
      ...p,
      onboarding_status: (p as { onboarding_status?: string }).onboarding_status ?? "draft",
      telegram_linked: false,
      is_minor: Boolean((p as { is_minor?: boolean }).is_minor),
    })),
    enrollments: enrollments ?? [],
    contacts: contacts ?? [],
    groups,
  };
}

export async function listPaymentsDb(tenantId: string, brandId: BrandId) {
  const db = getAdminClient();
  const { data, error } = await db
    .from("payments")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function isWontComeStatus(status?: string | null) {
  return status === "absent" || status === "absent_notified";
}

async function loadBrandSessionsBoard(
  tenantId: string,
  brandId: BrandId,
  range: { start: string; end: string },
) {
  const db = getAdminClient();

  const { data: groups } = await db
    .from("groups")
    .select("id, title, brand_id, capacity")
    .eq("tenant_id", tenantId)
    .eq("brand_id", brandId);

  const groupIds = (groups ?? []).map((g) => g.id);
  if (!groupIds.length) return [];

  const { data: sessions } = await db
    .from("sessions")
    .select("id, group_id, starts_at, status")
    .eq("tenant_id", tenantId)
    .in("group_id", groupIds)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at", { ascending: true });

  const sessionList = sessions ?? [];
  const sessionIds = sessionList.map((s) => s.id);
  if (!sessionIds.length) return [];

  const { data: enrollments } = await db
    .from("enrollments")
    .select("id, student_person_id, group_id")
    .in("group_id", groupIds)
    .eq("status", "active");

  const { data: attendance } = await db
    .from("attendance")
    .select("session_id, student_person_id, status, enrollment_id")
    .in("session_id", sessionIds);

  const attStudentIds = (attendance ?? []).map((a) => a.student_person_id);
  const enrollStudentIds = (enrollments ?? []).map((e) => e.student_person_id);
  const studentIds = [...new Set([...enrollStudentIds, ...attStudentIds])];

  const [{ data: personsRaw }, { data: tgRows }, { data: statsRows }] =
    await Promise.all([
      studentIds.length
        ? db
            .from("persons")
            .select("id, full_name, phone, birth_date, tshirt_size")
            .in("id", studentIds)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              full_name: string;
              phone: string | null;
              birth_date: string | null;
              tshirt_size: string | null;
            }>,
          }),
      studentIds.length
        ? db
            .from("telegram_identities")
            .select("person_id, username, chat_id")
            .in("person_id", studentIds)
        : Promise.resolve({
            data: [] as Array<{
              person_id: string;
              username: string | null;
              chat_id: number | null;
            }>,
          }),
      studentIds.length
        ? db
            .from("attendance")
            .select("student_person_id, status")
            .in("student_person_id", studentIds)
        : Promise.resolve({
            data: [] as Array<{ student_person_id: string; status: string }>,
          }),
    ]);

  // avatar_path optional until migration 007
  const avatarById = new Map<string, string | null>();
  if (studentIds.length) {
    const av = await db
      .from("persons")
      .select("id, avatar_path")
      .in("id", studentIds);
    if (!av.error) {
      for (const row of av.data ?? []) {
        avatarById.set(
          row.id,
          (row as { avatar_path?: string | null }).avatar_path ?? null,
        );
      }
    }
  }

  const statsMap = new Map<
    string,
    { present: number; absent: number; total: number }
  >();
  for (const row of statsRows ?? []) {
    const cur = statsMap.get(row.student_person_id) ?? {
      present: 0,
      absent: 0,
      total: 0,
    };
    cur.total += 1;
    if (row.status === "present") cur.present += 1;
    if (row.status === "absent" || row.status === "absent_notified") cur.absent += 1;
    statsMap.set(row.student_person_id, cur);
  }

  const tgMap = new Map(
    (tgRows ?? []).map((t) => [
      t.person_id,
      {
        username: t.username ? String(t.username).replace(/^@/, "") : null,
        chat_id: t.chat_id,
      },
    ]),
  );

  const { signedAvatarUrl } = await import("@/lib/avatars");
  const { formatBirthDay } = await import("@/lib/format-date");

  type PersonRow = {
    id: string;
    full_name: string;
    phone: string | null;
    birth_date: string | null;
    tshirt_size: string | null;
  };
  const personMap = new Map<string, PersonRow>(
    ((personsRaw ?? []) as PersonRow[]).map((p) => [p.id, p]),
  );

  const avatarUrls = new Map<string, string | null>();
  await Promise.all(
    [...avatarById.entries()].map(async ([id, path]) => {
      if (!path) {
        avatarUrls.set(id, null);
        return;
      }
      avatarUrls.set(id, await signedAvatarUrl(path));
    }),
  );

  const groupMap = new Map((groups ?? []).map((g) => [g.id, g]));

  function buildRosterItem(
    studentPersonId: string,
    enrollmentId: string,
    attStatus: string | null,
    sessionStatus: string,
  ) {
    const person = personMap.get(studentPersonId);
    const tg = tgMap.get(studentPersonId);
    const stats = statsMap.get(studentPersonId) ?? {
      present: 0,
      absent: 0,
      total: 0,
    };
    const wont = isWontComeStatus(attStatus);
    const effective =
      attStatus ??
      (sessionStatus === "cancelled_by_studio" ? "cancelled_by_studio" : "present");
    const username = tg?.username ?? null;
    return {
      enrollmentId,
      studentPersonId,
      fullName: person?.full_name ?? "?",
      phone: person?.phone ?? null,
      birth_day: person?.birth_date ? formatBirthDay(person.birth_date) : null,
      tshirt_size: person?.tshirt_size ?? null,
      avatar_url: avatarUrls.get(studentPersonId) ?? null,
      telegram_username: username,
      telegram_url: username ? `https://t.me/${username}` : null,
      stats,
      status: attStatus,
      effectiveStatus: wont ? attStatus! : effective,
      explicitWontCome: wont,
      coming: !wont && sessionStatus !== "cancelled_by_studio",
    };
  }

  return sessionList.map((s) => {
    const group = groupMap.get(s.group_id);
    const groupTitle = group?.title ?? "Занятие";
    const sessionAtt = (attendance ?? []).filter((a) => a.session_id === s.id);
    const attByStudent = new Map(sessionAtt.map((a) => [a.student_person_id, a]));
    const rosterEnroll = (enrollments ?? []).filter((e) => e.group_id === s.group_id);

    const rosterIds = new Set<string>();
    const roster: ReturnType<typeof buildRosterItem>[] = [];

    for (const e of rosterEnroll) {
      rosterIds.add(e.student_person_id);
      const att = attByStudent.get(e.student_person_id);
      roster.push(
        buildRosterItem(e.student_person_id, e.id, att?.status ?? null, s.status),
      );
    }

    for (const att of sessionAtt) {
      if (rosterIds.has(att.student_person_id)) continue;
      roster.push(
        buildRosterItem(
          att.student_person_id,
          att.enrollment_id ?? "",
          att.status,
          s.status,
        ),
      );
    }

    roster.sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));

    const coming = roster.filter((r) => r.coming).length;
    const wontCome = roster.filter((r) => !r.coming).length;
    return {
      id: s.id,
      title: groupTitle,
      group_title: groupTitle,
      starts_at: s.starts_at,
      status: s.status,
      capacity: group?.capacity ?? 12,
      expected_coming: coming,
      expected_wont_come: wontCome,
      will_hold: coming >= 2,
      cancel_risk: s.status === "scheduled" && roster.length > 0 && coming < 2,
      roster,
    };
  });
}

/** Day board: one Warsaw calendar day (default: today). */
export async function getDayBoardDb(
  tenantId: string,
  brandId: BrandId,
  opts?: { date?: string },
) {
  const day = opts?.date ?? warsawYmd();
  return loadBrandSessionsBoard(tenantId, brandId, warsawDayRange(day));
}

/** Sessions for attendance UI (one Warsaw day). */
export async function listSessionsForBrandDb(
  tenantId: string,
  brandId: BrandId,
  opts?: { date?: string },
) {
  const day = opts?.date ?? warsawYmd();
  return loadBrandSessionsBoard(tenantId, brandId, warsawDayRange(day));
}

/** Archive: sessions for a brand month, optional group filter. */
export async function listSessionsArchiveDb(
  tenantId: string,
  brandId: BrandId,
  opts?: { month?: string; groupId?: string },
) {
  const db = getAdminClient();
  const month = opts?.month ?? warsawYmd().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid month, expected YYYY-MM");

  const { data: groups } = await db
    .from("groups")
    .select("id, title, brand_id")
    .eq("tenant_id", tenantId)
    .eq("brand_id", brandId);
  let groupIds = (groups ?? []).map((g) => g.id);
  if (opts?.groupId) {
    if (!groupIds.includes(opts.groupId)) return [];
    groupIds = [opts.groupId];
  }
  if (!groupIds.length) return [];

  const [y, m] = month.split("-").map(Number);
  const startYmd = `${month}-01`;
  const nextY =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const range = {
    start: warsawDayRange(startYmd).start,
    end: warsawDayRange(nextY).start,
  };

  const { data: sessions, error } = await db
    .from("sessions")
    .select("id, group_id, starts_at, status")
    .eq("tenant_id", tenantId)
    .in("group_id", groupIds)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at", { ascending: false });
  if (error) throw new Error(error.message);

  const sessionList = sessions ?? [];
  const sessionIds = sessionList.map((s) => s.id);
  const { data: attendance } = sessionIds.length
    ? await db
        .from("attendance")
        .select("session_id, status")
        .in("session_id", sessionIds)
    : { data: [] as Array<{ session_id: string; status: string }> };

  const counts = new Map<string, { present: number; absent: number; total: number }>();
  for (const a of attendance ?? []) {
    const cur = counts.get(a.session_id) ?? { present: 0, absent: 0, total: 0 };
    cur.total += 1;
    if (a.status === "present") cur.present += 1;
    else if (a.status === "absent" || a.status === "absent_notified") cur.absent += 1;
    counts.set(a.session_id, cur);
  }

  const groupMap = new Map((groups ?? []).map((g) => [g.id, g.title]));
  return sessionList.map((s) => {
    const c = counts.get(s.id) ?? { present: 0, absent: 0, total: 0 };
    return {
      id: s.id,
      group_id: s.group_id,
      group_title: groupMap.get(s.group_id) ?? "Занятие",
      starts_at: s.starts_at,
      status: s.status,
      present_count: c.present,
      absent_count: c.absent,
      marked_count: c.total,
    };
  });
}

export async function getPersonOnboardingStatus(personId: string) {
  const db = getAdminClient();
  const { data } = await db
    .from("persons")
    .select("onboarding_status, accepted_rules_at")
    .eq("id", personId)
    .maybeSingle();
  let status = (data?.onboarding_status as string) ?? "complete";

  // Heal stuck welcome: rules already accepted but status never flipped.
  if (
    data?.accepted_rules_at &&
    (status === "draft" || status === "invited" || status === "activated")
  ) {
    await db
      .from("persons")
      .update({ onboarding_status: "complete" })
      .eq("id", personId);
    status = "complete";
  }
  return status;
}
