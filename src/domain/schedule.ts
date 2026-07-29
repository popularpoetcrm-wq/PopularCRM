import { warsawDayRange, warsawYmd } from "@/lib/format-date";
import { getAdminClient } from "@/lib/supabase/admin";

/** weekday: 0=Sunday … 6=Saturday (JS Date#getUTCDay / schedule rules). */
function warsawWallClockToIso(ymd: string, time: string): string {
  const [hh, mm, ss] = time.split(":").map((x) => Number(x));
  const midnight = Date.parse(warsawDayRange(ymd).start);
  return new Date(
    midnight + ((hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0)) * 1000,
  ).toISOString();
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** JS weekday for a Warsaw calendar date. */
function warsawWeekday(ymd: string): number {
  // noon UTC on that calendar day, then format weekday in Warsaw
  const noon = new Date(`${ymd}T12:00:00.000Z`);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Warsaw",
    weekday: "short",
  }).format(noon);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? noon.getUTCDay();
}

export async function generateSessionsFromRulesDb(
  tenantId: string,
  opts?: { weeks?: number },
) {
  const weeks = Math.min(Math.max(opts?.weeks ?? 8, 1), 26);
  const db = getAdminClient();

  const { data: groups, error: gErr } = await db
    .from("groups")
    .select("id, status, teacher_person_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  if (gErr) throw new Error(gErr.message);
  const groupIds = (groups ?? []).map((g) => g.id);
  if (!groupIds.length) return { created: 0, skipped: 0, weeks };

  const { data: rules, error: rErr } = await db
    .from("group_schedule_rules")
    .select("*")
    .in("group_id", groupIds);
  if (rErr) throw new Error(rErr.message);
  if (!rules?.length) return { created: 0, skipped: 0, weeks };

  const teacherByGroup = new Map(
    (groups ?? []).map((g) => [g.id, g.teacher_person_id as string | null]),
  );

  const today = warsawYmd();
  const endYmd = addDaysYmd(today, weeks * 7);
  const rows: Array<{
    tenant_id: string;
    group_id: string;
    teacher_person_id: string | null;
    starts_at: string;
    ends_at: string;
    status: string;
  }> = [];

  for (let i = 0; i < weeks * 7; i++) {
    const ymd = addDaysYmd(today, i);
    if (ymd >= endYmd) break;
    const wd = warsawWeekday(ymd);
    for (const rule of rules) {
      if (Number(rule.weekday) !== wd) continue;
      if (rule.valid_from && ymd < rule.valid_from) continue;
      if (rule.valid_to && ymd > rule.valid_to) continue;
      const startTime = String(rule.start_time).slice(0, 8);
      const startsAt = warsawWallClockToIso(ymd, startTime);
      const endsAt = new Date(
        Date.parse(startsAt) + Number(rule.duration_minutes || 90) * 60_000,
      ).toISOString();
      // only future (and today upcoming) — skip past slots today
      if (Date.parse(startsAt) < Date.now() - 60 * 60_000) continue;
      rows.push({
        tenant_id: tenantId,
        group_id: rule.group_id,
        teacher_person_id: teacherByGroup.get(rule.group_id) ?? null,
        starts_at: startsAt,
        ends_at: endsAt,
        status: "scheduled",
      });
    }
  }

  if (!rows.length) return { created: 0, skipped: 0, weeks };

  // Upsert in chunks; ignore duplicates via onConflict
  let created = 0;
  const chunk = 100;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { data, error } = await db
      .from("sessions")
      .upsert(slice, {
        onConflict: "group_id,starts_at",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(error.message);
    created += data?.length ?? 0;
  }

  return {
    created,
    skipped: rows.length - created,
    weeks,
    planned: rows.length,
  };
}
