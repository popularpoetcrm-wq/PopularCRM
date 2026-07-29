/** Shared display helpers for groups / schedule in cabinet & bot. */

const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;
const WEEKDAYS_FULL = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
] as const;

export function weekdayShort(wd: number) {
  return WEEKDAYS_RU[((wd % 7) + 7) % 7] ?? "—";
}

export function weekdayFull(wd: number) {
  return WEEKDAYS_FULL[((wd % 7) + 7) % 7] ?? "—";
}

export function directionLabel(d?: string | null) {
  const x = (d || "").toLowerCase();
  if (x === "impro") return "импро";
  if (x === "acting") return "актёрка";
  if (x === "school") return "школа";
  if (x === "kids") return "идея";
  if (x === "show") return "спектакль";
  if (x === "playback") return "playback";
  return d || null;
}

export function formatTime(t?: string | null) {
  if (!t) return "";
  return String(t).slice(0, 5);
}

export type ScheduleRuleLike = {
  weekday: number;
  start_time: string;
  duration_minutes?: number | null;
  room?: string | null;
};

export function formatRuleLine(rule: ScheduleRuleLike) {
  const time = formatTime(rule.start_time);
  const room = rule.room ? ` · ${rule.room}` : "";
  return `${weekdayShort(rule.weekday)} ${time}${room}`;
}

export function formatGroupCard(input: {
  title: string;
  direction?: string | null;
  rules?: ScheduleRuleLike[];
}) {
  const dir = directionLabel(input.direction);
  const when =
    (input.rules ?? []).map(formatRuleLine).filter(Boolean).join(", ") || null;
  return {
    title: input.title,
    direction: input.direction ?? null,
    direction_label: dir,
    schedule_label: when,
    subtitle: [dir, when].filter(Boolean).join(" · ") || input.title,
  };
}

export function moneyStatusLabel(input: {
  debtOpen: number;
  creditsLeft: number | null;
  hasPackage: boolean;
}) {
  if (input.debtOpen > 0) {
    return `Долг ${Math.round(input.debtOpen)} PLN`;
  }
  if (input.hasPackage && input.creditsLeft != null) {
    if (input.creditsLeft <= 0) return "Занятия в пакете закончились";
    if (input.creditsLeft <= 1) return `Осталось ${input.creditsLeft} занятие`;
    return `Осталось ${input.creditsLeft} из пакета`;
  }
  return "Оплат нет / пакет не активен";
}
