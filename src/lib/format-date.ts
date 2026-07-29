/** Display birthday as day.month — year from sheets is often junk. */
export function formatBirthDay(value?: string | null): string {
  if (!value) return "—";
  const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}`;
  const m2 = String(value).match(/(\d{1,2})[./-](\d{1,2})/);
  if (m2) return `${m2[1].padStart(2, "0")}.${m2[2].padStart(2, "0")}`;
  return String(value);
}

const WARSAW = "Europe/Warsaw";

/** Calendar date YYYY-MM-DD in Europe/Warsaw. */
export function warsawYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: WARSAW,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** UTC half-open range [start, end) for a Warsaw calendar day. */
export function warsawDayRange(ymd: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error("Invalid date, expected YYYY-MM-DD");
  }
  const probe = new Date(`${ymd}T12:00:00.000Z`);
  const tzPart = new Intl.DateTimeFormat("en-US", {
    timeZone: WARSAW,
    timeZoneName: "longOffset",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = tzPart?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const sign = m?.[1] === "-" ? -1 : 1;
  const hours = m ? Number(m[2]) : 2;
  const mins = m?.[3] ? Number(m[3]) : 0;
  const offsetMs = sign * (hours * 60 + mins) * 60_000;
  const startMs = Date.parse(`${ymd}T00:00:00.000Z`) - offsetMs;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

function parseBirthMd(value: string): { month: number; day: number } | null {
  const iso = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { month: Number(iso[2]), day: Number(iso[3]) };
  const dmy = String(value).match(/(\d{1,2})[./-](\d{1,2})/);
  if (dmy) return { month: Number(dmy[2]), day: Number(dmy[1]) };
  return null;
}

/** Next occurrence of MM-DD on/after fromYmd (Warsaw calendar). */
export function nextBirthdayYmd(
  birthDate: string,
  fromYmd: string = warsawYmd(),
): string | null {
  const md = parseBirthMd(birthDate);
  if (!md || md.month < 1 || md.month > 12 || md.day < 1 || md.day > 31) {
    return null;
  }
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  let year = fy;
  const candidate = `${year}-${String(md.month).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
  if (candidate < fromYmd) year += 1;
  return `${year}-${String(md.month).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
}

export type BirthdayPerson = {
  id: string;
  full_name: string;
  birth_date: string;
  group_title?: string | null;
};

export function upcomingBirthdays(
  people: BirthdayPerson[],
  withinDays = 30,
  fromYmd: string = warsawYmd(),
) {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const out: Array<
    BirthdayPerson & {
      next_ymd: string;
      days_until: number;
      is_today: boolean;
      display: string;
    }
  > = [];

  for (const p of people) {
    if (!p.birth_date) continue;
    const next = nextBirthdayYmd(p.birth_date, fromYmd);
    if (!next) continue;
    const [y, m, d] = next.split("-").map(Number);
    const daysUntil = Math.round((Date.UTC(y, m - 1, d) - from) / 86400000);
    if (daysUntil < 0 || daysUntil > withinDays) continue;
    out.push({
      ...p,
      next_ymd: next,
      days_until: daysUntil,
      is_today: daysUntil === 0,
      display: formatBirthDay(p.birth_date),
    });
  }

  out.sort(
    (a, b) =>
      a.days_until - b.days_until || a.full_name.localeCompare(b.full_name, "ru"),
  );
  return out;
}

