/** RU labels for attendance statuses (DB enums stay English). */
export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  present: "Пришёл",
  absent: "Не был",
  absent_notified: "Предупредил",
  cancelled_by_studio: "Отменено",
  coming: "Придёт",
};

export function attendanceStatusLabel(status?: string | null): string {
  if (!status) return "—";
  return ATTENDANCE_STATUS_LABELS[status] ?? status;
}

/** Shift YYYY-MM-DD by calendar days. */
export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
