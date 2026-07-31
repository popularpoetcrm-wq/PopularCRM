import type { BrandId } from "@/lib/brands";
import { directionLabel as directionLabelShared } from "@/lib/group-display";
import { getAdminClient } from "@/lib/supabase/admin";

export type InsightPerson = {
  id: string;
  full_name: string;
  present: number;
  total: number;
  rate: number;
  directions: string[];
  groups: string[];
  ltv: number;
  debt: number;
  reason: string;
};

export type InsightGroup = {
  id: string;
  title: string;
  direction: string | null;
  roster: number;
  capacity: number;
  present_rate: number | null;
  reason: string;
};

export type AdminInsights = {
  brand_id: BrandId;
  pulse: {
    revenue_paid: number;
    debt_open: number;
    debtors: number;
    active_students: number;
    attach_pct: number;
    attach_count: number;
    present_rate: number | null;
  };
  directions: Array<{ direction: string; students: number; enrollments: number }>;
  open_debt: InsightPerson[];
  top_ltv: InsightPerson[];
  risk: InsightPerson[];
  cross_sell: InsightPerson[];
  thin_groups: InsightGroup[];
  advice: Array<{ id: string; title: string; detail: string; count: number }>;
};

function directionLabel(d: string | null | undefined) {
  return directionLabelShared(d) ?? (d || "другое");
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function loadAdminInsightsDb(
  tenantId: string,
  brandId: BrandId,
): Promise<AdminInsights> {
  const db = getAdminClient();

  const { data: groups, error: gErr } = await db
    .from("groups")
    .select("id, title, direction, capacity, status, brand_id")
    .eq("tenant_id", tenantId)
    .eq("brand_id", brandId)
    .eq("status", "active");
  if (gErr) throw new Error(gErr.message);

  const groupList = groups ?? [];
  const groupIds = groupList.map((g) => g.id);
  const groupMap = new Map(groupList.map((g) => [g.id, g]));

  if (!groupIds.length) {
    return emptyInsights(brandId);
  }

  const { data: enrollments, error: eErr } = await db
    .from("enrollments")
    .select("id, student_person_id, group_id, status, started_at")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("group_id", groupIds);
  if (eErr) throw new Error(eErr.message);

  const enrollList = enrollments ?? [];
  const studentIds = [...new Set(enrollList.map((e) => e.student_person_id))];

  const persons: Array<{ id: string; full_name: string }> = [];
  for (const ids of chunk(studentIds, 100)) {
    const { data } = await db
      .from("persons")
      .select("id, full_name")
      .in("id", ids);
    persons.push(...(data ?? []));
  }
  const personMap = new Map(persons.map((p) => [p.id, p.full_name]));

  // Payments for brand (also via enrollment if brand_id missing)
  const { data: payDirect } = await db
    .from("payments")
    .select(
      "id, payer_person_id, enrollment_id, amount, amount_paid, status, brand_id",
    )
    .eq("tenant_id", tenantId)
    .eq("brand_id", brandId)
    .limit(2000);

  const enrollIds = enrollList.map((e) => e.id);
  const payViaEnroll: typeof payDirect = [];
  for (const ids of chunk(enrollIds, 80)) {
    const { data } = await db
      .from("payments")
      .select(
        "id, payer_person_id, enrollment_id, amount, amount_paid, status, brand_id",
      )
      .in("enrollment_id", ids)
      .is("brand_id", null)
      .limit(2000);
    payViaEnroll.push(...(data ?? []));
  }

  const paySeen = new Set<string>();
  const payments = [...(payDirect ?? []), ...payViaEnroll].filter((p) => {
    if (paySeen.has(p.id)) return false;
    paySeen.add(p.id);
    return true;
  });

  // Attendance aggregates per student (all marks in brand groups)
  const sessionIds: string[] = [];
  for (const ids of chunk(groupIds, 40)) {
    const { data: sess } = await db
      .from("sessions")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("group_id", ids)
      .neq("status", "cancelled_by_studio");
    sessionIds.push(...(sess ?? []).map((s) => s.id));
  }

  const attByStudent = new Map<string, { present: number; total: number }>();
  const attByGroup = new Map<string, { present: number; total: number }>();
  const sessionGroup = new Map<string, string>();

  for (const ids of chunk(sessionIds, 80)) {
    const { data: sess } = await db
      .from("sessions")
      .select("id, group_id")
      .in("id", ids);
    for (const s of sess ?? []) sessionGroup.set(s.id, s.group_id);
  }

  for (const ids of chunk(sessionIds, 60)) {
    const { data: marks } = await db
      .from("attendance")
      .select("student_person_id, session_id, status")
      .in("session_id", ids);
    for (const m of marks ?? []) {
      const st = attByStudent.get(m.student_person_id) ?? {
        present: 0,
        total: 0,
      };
      st.total += 1;
      if (m.status === "present") st.present += 1;
      attByStudent.set(m.student_person_id, st);

      const gid = sessionGroup.get(m.session_id);
      if (gid) {
        const g = attByGroup.get(gid) ?? { present: 0, total: 0 };
        g.total += 1;
        if (m.status === "present") g.present += 1;
        attByGroup.set(gid, g);
      }
    }
  }

  // Per-student direction / group sets
  type StudentAgg = {
    id: string;
    full_name: string;
    directions: Set<string>;
    groups: string[];
    present: number;
    total: number;
    ltv: number;
    debt: number;
  };
  const byStudent = new Map<string, StudentAgg>();
  for (const sid of studentIds) {
    const att = attByStudent.get(sid) ?? { present: 0, total: 0 };
    byStudent.set(sid, {
      id: sid,
      full_name: personMap.get(sid) ?? "—",
      directions: new Set(),
      groups: [],
      present: att.present,
      total: att.total,
      ltv: 0,
      debt: 0,
    });
  }
  for (const e of enrollList) {
    const s = byStudent.get(e.student_person_id);
    if (!s) continue;
    const g = groupMap.get(e.group_id);
    if (!g) continue;
    const dir = (g.direction || "other").toLowerCase();
    s.directions.add(dir);
    if (!s.groups.includes(g.title)) s.groups.push(g.title);
  }

  const enrollToStudent = new Map(
    enrollList.map((e) => [e.id, e.student_person_id]),
  );

  /** Prefer student from enrollment; fall back to payer (parent / self). */
  function debtOwnerId(p: {
    payer_person_id?: string | null;
    enrollment_id?: string | null;
  }): string | null {
    const fromEnroll = p.enrollment_id
      ? enrollToStudent.get(p.enrollment_id) ?? null
      : null;
    return fromEnroll || p.payer_person_id || null;
  }

  for (const p of payments) {
    const sid = debtOwnerId(p);
    if (!sid) continue;
    let s = byStudent.get(sid);
    if (!s) {
      s = {
        id: sid,
        full_name: personMap.get(sid) ?? "—",
        directions: new Set(),
        groups: [],
        present: 0,
        total: 0,
        ltv: 0,
        debt: 0,
      };
      byStudent.set(sid, s);
    }
    const paid = Number(p.amount_paid || 0);
    const amount = Number(p.amount || 0);
    if (p.status === "paid" || p.status === "partial") s.ltv += paid;
    if (["pending", "partial"].includes(p.status)) {
      s.debt += Math.max(0, amount - paid);
    }
  }

  let revenue_paid = 0;
  let debt_open = 0;
  const debtorIds = new Set<string>();
  for (const p of payments) {
    const paid = Number(p.amount_paid || 0);
    const amount = Number(p.amount || 0);
    if (p.status === "paid" || p.status === "partial") revenue_paid += paid;
    if (["pending", "partial"].includes(p.status)) {
      const open = Math.max(0, amount - paid);
      debt_open += open;
      const sid = debtOwnerId(p);
      if (sid && open > 0) debtorIds.add(sid);
    }
  }

  // Names for debtors who aren't in active roster (ended / payer-only)
  const missingNames = [...debtorIds].filter((id) => !personMap.has(id));
  for (const ids of chunk(missingNames, 100)) {
    const { data } = await db
      .from("persons")
      .select("id, full_name")
      .in("id", ids);
    for (const p of data ?? []) {
      personMap.set(p.id, p.full_name);
      const s = byStudent.get(p.id);
      if (s && s.full_name === "—") s.full_name = p.full_name;
    }
  }

  const students = [...byStudent.values()];
  const attach_count = students.filter((s) => {
    const dirs = [...s.directions].filter((d) => d !== "other" && d !== "kids");
    return dirs.length >= 2;
  }).length;
  const active_students = studentIds.length;
  const attach_pct =
    active_students > 0
      ? Math.round((attach_count / active_students) * 1000) / 10
      : 0;

  let presentTotal = 0;
  let markTotal = 0;
  for (const s of students) {
    presentTotal += s.present;
    markTotal += s.total;
  }
  const present_rate =
    markTotal > 0
      ? Math.round((presentTotal / markTotal) * 1000) / 10
      : null;

  const dirCounts = new Map<string, { students: Set<string>; enrollments: number }>();
  for (const e of enrollList) {
    const g = groupMap.get(e.group_id);
    const dir = (g?.direction || "other").toLowerCase();
    const row = dirCounts.get(dir) ?? {
      students: new Set<string>(),
      enrollments: 0,
    };
    row.students.add(e.student_person_id);
    row.enrollments += 1;
    dirCounts.set(dir, row);
  }
  const directions = [...dirCounts.entries()]
    .map(([direction, v]) => ({
      direction: directionLabel(direction),
      students: v.students.size,
      enrollments: v.enrollments,
    }))
    .sort((a, b) => b.students - a.students);

  const toPerson = (
    s: StudentAgg,
    reason: string,
  ): InsightPerson => ({
    id: s.id,
    full_name: s.full_name,
    present: s.present,
    total: s.total,
    rate: s.total ? Math.round((s.present / s.total) * 1000) / 10 : 0,
    directions: [...s.directions].map(directionLabel),
    groups: s.groups,
    ltv: Math.round(s.ltv),
    debt: Math.round(s.debt),
    reason,
  });

  const top_ltv = students
    .filter((s) => s.ltv > 0)
    .sort((a, b) => b.ltv - a.ltv)
    .slice(0, 8)
    .map((s) => toPerson(s, `LTV ${Math.round(s.ltv)} PLN`));

  const risk = students
    .filter((s) => s.total >= 5 && s.present / s.total < 0.5)
    .sort((a, b) => a.present / a.total - b.present / b.total)
    .slice(0, 12)
    .map((s) => {
      const rate = Math.round((s.present / s.total) * 100);
      const debtNote = s.debt > 0 ? ` · долг ${Math.round(s.debt)}` : "";
      return toPerson(s, `посещаемость ${rate}%${debtNote}`);
    });

  const cross_sell = students
    .filter((s) => {
      const hasImpro = s.directions.has("impro");
      const hasActing = s.directions.has("acting");
      return (
        hasImpro &&
        !hasActing &&
        s.present >= 8 &&
        s.debt <= 0 &&
        brandId === "poet"
      );
    })
    .sort((a, b) => b.present - a.present)
    .slice(0, 15)
    .map((s) =>
      toPerson(
        s,
        `${s.present} посещений · предложи актёрское мастерство`,
      ),
    );

  const thin_groups: InsightGroup[] = groupList
    .map((g) => {
      const roster = enrollList.filter((e) => e.group_id === g.id).length;
      const att = attByGroup.get(g.id);
      const present_rate =
        att && att.total > 0
          ? Math.round((att.present / att.total) * 1000) / 10
          : null;
      return {
        id: g.id,
        title: g.title,
        direction: g.direction,
        roster,
        capacity: g.capacity,
        present_rate,
        reason:
          roster < 4
            ? `в группе ${roster} — донабор или объединение`
            : `в группе ${roster}`,
      };
    })
    .filter((g) => g.roster < 4)
    .sort((a, b) => a.roster - b.roster);

  const advice: AdminInsights["advice"] = [];
  if (cross_sell.length) {
    advice.push({
      id: "cross-sell-impro-acting",
      title: "Импровизация → актёрское мастерство",
      detail:
        "Хорошая посещаемость на импро, ещё нет актёрского мастерства, без долга — мягко предложить второй трек.",
      count: cross_sell.length,
    });
  }
  if (risk.length) {
    advice.push({
      id: "churn-risk",
      title: "Риск тихого ухода",
      detail: "посещаемость <50% при ≥5 отметках — созвон / пауза / смена слота.",
      count: risk.length,
    });
  }
  if (thin_groups.length) {
    advice.push({
      id: "thin-groups",
      title: "Маленькие группы",
      detail: "Меньше 4 человек — риск отмены. Донабор или объединение.",
      count: thin_groups.length,
    });
  }
  const open_debt = students
    .filter((s) => s.debt > 0)
    .sort((a, b) => b.debt - a.debt)
    .map((s) =>
      toPerson(
        { ...s, full_name: personMap.get(s.id) ?? s.full_name },
        `долг ${Math.round(s.debt)} PLN` +
          (s.groups.length ? ` · ${s.groups.slice(0, 2).join(", ")}` : ""),
      ),
    );

  if (debtorIds.size) {
    advice.push({
      id: "open-debt",
      title: "Открытые долги",
      detail: `Сумма ${Math.round(debt_open)} PLN у ${debtorIds.size} чел. — сначала касса, потом предложения.`,
      count: debtorIds.size,
    });
  }
  const loyal = students.filter(
    (s) => s.total >= 5 && s.present / s.total >= 0.8 && s.directions.size === 1,
  );
  if (loyal.length && brandId === "poet") {
    advice.push({
      id: "loyal-upsell",
      title: "Лояльные на одном направлении",
      detail:
        "≥80% посещаемости на одной группе — кандидаты на пакет или второй слот.",
      count: loyal.length,
    });
  }

  return {
    brand_id: brandId,
    pulse: {
      revenue_paid: Math.round(revenue_paid),
      debt_open: Math.round(debt_open),
      debtors: open_debt.length || debtorIds.size,
      active_students,
      attach_pct,
      attach_count,
      present_rate,
    },
    directions,
    open_debt,
    top_ltv,
    risk,
    cross_sell,
    thin_groups,
    advice,
  };
}

function emptyInsights(brandId: BrandId): AdminInsights {
  return {
    brand_id: brandId,
    pulse: {
      revenue_paid: 0,
      debt_open: 0,
      debtors: 0,
      active_students: 0,
      attach_pct: 0,
      attach_count: 0,
      present_rate: null,
    },
    directions: [],
    open_debt: [],
    top_ltv: [],
    risk: [],
    cross_sell: [],
    thin_groups: [],
    advice: [],
  };
}
