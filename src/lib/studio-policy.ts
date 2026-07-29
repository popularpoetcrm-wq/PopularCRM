/** Studio business rules (demo + later tenant.settings) */
export const STUDIO_POLICY = {
  /** "Не приду" позже чем за N часов = слишком поздно */
  absentNotifyCutoffHours: 6,
  /** Если ожидается прийти меньше этого числа — занятие отменяется */
  minAttendeesToHold: 2,
  /** Makeup booking / cancel cutoff (same window for simplicity) */
  makeupCutoffHours: 6,
  makeupValidityDays: 30,
} as const;

export function cutoffMinutes(hours = STUDIO_POLICY.absentNotifyCutoffHours) {
  return hours * 60;
}
