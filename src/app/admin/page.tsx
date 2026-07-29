"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { addCalendarDays, attendanceStatusLabel } from "@/lib/attendance-labels";

type DaySession = {
  id: string;
  title: string;
  group_title: string;
  starts_at: string;
  status: string;
  expected_coming: number;
  expected_wont_come: number;
  will_hold: boolean;
  cancel_risk: boolean;
  roster: Array<{ fullName: string; coming: boolean; status: string }>;
};

function todayLocalYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AdminHome() {
  const [stats, setStats] = useState({ groups: 0, debt: 0, students: 0 });
  const [sessions, setSessions] = useState<DaySession[]>([]);
  const [birthdays, setBirthdays] = useState<
    Array<{
      id: string;
      full_name: string;
      display: string;
      days_until: number;
      is_today: boolean;
      group_title?: string | null;
    }>
  >([]);
  const [date, setDate] = useState(todayLocalYmd);
  const [mode, setMode] = useState<"demo" | "supabase">("demo");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [jobMsg, setJobMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(forDate = date) {
    const [g, p, s, d, b] = await Promise.all([
      fetch("/api/v1/admin/groups").then((r) => r.json()),
      fetch("/api/v1/admin/payments").then((r) => r.json()),
      fetch("/api/v1/admin/students").then((r) => r.json()),
      fetch(`/api/v1/admin/day?date=${encodeURIComponent(forDate)}`).then((r) =>
        r.json(),
      ),
      fetch("/api/v1/admin/birthdays?days=30").then((r) => r.json()),
    ]);
    setStats({
      groups: g.ok ? g.data.length : 0,
      debt: p.ok
        ? p.data.filter((x: { status: string }) =>
            ["pending", "partial"].includes(x.status),
          ).length
        : 0,
      students: s.ok ? (s.data.students?.length ?? 0) : 0,
    });
    if (d.ok) {
      setSessions(d.data.sessions ?? []);
      if (d.data.mode) setMode(d.data.mode);
      if (d.data.date) setDate(d.data.date);
    }
    if (b.ok) setBirthdays(b.data.birthdays ?? []);
  }

  useEffect(() => {
    void load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function tick() {
    setBusy(true);
    const res = await fetch("/api/v1/demo/jobs", { method: "POST" });
    const json = await res.json();
    setBusy(false);
    setJobMsg(
      json.ok
        ? `Jobs · reminders ${json.data.reminders}, expired makeups ${json.data.expiredMakeups}`
        : json.error,
    );
    await load();
  }

  async function seed() {
    setBusy(true);
    const res = await fetch("/api/v1/demo/seed", { method: "POST" });
    const json = await res.json();
    setBusy(false);
    setJobMsg(
      json.ok
        ? `Seed: ${json.data.group} · ${json.data.enrollments} учеников`
        : json.error,
    );
    await load();
  }

  async function remindDebtors() {
    setBusy(true);
    const res = await fetch("/api/v1/admin/day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remind_debtors" }),
    });
    const json = await res.json();
    setBusy(false);
    setJobMsg(json.ok ? `Напоминания в inbox: ${json.data.reminded}` : json.error);
  }

  async function generateSessions() {
    setBusy(true);
    const res = await fetch("/api/v1/admin/sessions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeks: 8 }),
    });
    const json = await res.json();
    setBusy(false);
    setJobMsg(
      json.ok
        ? `Расписание: запланировано ${json.data.planned}, новых ${json.data.created} (8 недель)`
        : json.error,
    );
    await load();
  }

  async function finalize(sessionId: string) {
    if (!confirm("Закрыть занятие? Все без «не приду» → пришёл")) return;
    setBusy(true);
    const res = await fetch("/api/v1/admin/day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finalize", sessionId }),
    });
    const json = await res.json();
    setBusy(false);
    setJobMsg(json.ok ? "Занятие закрыто" : json.error);
    await load();
  }

  const today = todayLocalYmd();
  const yesterday = addCalendarDays(today, -1);

  return (
    <div className="grid gap-5">
      <section className="glass glass-strong p-5 sm:p-6">
        <h1 className="font-display text-3xl sm:text-4xl">Рабочий день</h1>
        <p className="mt-2 text-fog">
          Только выбранный день: кто придёт, риск отмены, быстрый переход к отметкам.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold">
            Дата
            <input
              type="date"
              className="input mt-1"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost text-sm"
            onClick={() => setDate(today)}
          >
            Сегодня
          </button>
          <button
            type="button"
            className="btn btn-ghost text-sm"
            onClick={() => setDate(yesterday)}
          >
            Вчера
          </button>
          <Link href={`/admin/attendance?date=${date}`} className="btn btn-stage text-sm">
            Отметить посещаемость
          </Link>
          <Link href="/admin/sessions" className="btn btn-ghost text-sm">
            Журнал занятий
          </Link>
          <button
            type="button"
            className="btn btn-stage text-sm"
            disabled={busy || mode === "demo"}
            onClick={generateSessions}
          >
            Сгенерировать 8 недель
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {mode === "demo" ? (
            <>
              <button className="btn btn-ghost text-sm" disabled={busy} onClick={seed}>
                Seed дня
              </button>
              <button className="btn btn-ghost text-sm" disabled={busy} onClick={tick}>
                Tick jobs
              </button>
            </>
          ) : null}
          <button
            className="btn btn-ghost text-sm"
            disabled={busy}
            onClick={remindDebtors}
          >
            Напомнить должникам
          </button>
          <a href="/api/v1/reports/export?type=week" className="btn btn-ghost text-sm">
            CSV недели
          </a>
        </div>
        {jobMsg ? <p className="mt-3 break-all text-sm text-stage-deep">{jobMsg}</p> : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/insights" className="glass block p-5 transition hover:bg-white/10">
          <p className="text-sm text-fog">Сводка</p>
          <p className="mt-2 text-lg font-semibold">Касса · советы</p>
        </Link>
        <Link href="/admin/groups" className="glass block p-5 transition hover:bg-white/10">
          <p className="text-sm text-fog">Группы</p>
          <p className="mt-2 text-3xl font-semibold">{stats.groups}</p>
        </Link>
        <Link href="/admin/students" className="glass block p-5 transition hover:bg-white/10">
          <p className="text-sm text-fog">Ученики</p>
          <p className="mt-2 text-3xl font-semibold">{stats.students}</p>
        </Link>
        <Link href="/admin/payments" className="glass block p-5 transition hover:bg-white/10">
          <p className="text-sm text-fog">Долги</p>
          <p className="mt-2 text-3xl font-semibold text-warn">{stats.debt}</p>
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-2xl">Дни рождения · 30 дней</h2>
        {!birthdays.length ? (
          <div className="glass p-5 text-fog">Ближайших ДР нет (или нет дат в профилях).</div>
        ) : (
          <ul className="glass divide-y divide-white/10">
            {birthdays.slice(0, 12).map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <div>
                  <Link href={`/admin/students/${b.id}`} className="font-semibold underline">
                    {b.full_name}
                  </Link>
                  <p className="text-xs text-fog">{b.group_title || "—"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{b.display}</span>
                  {b.is_today ? (
                    <span className="badge badge-ok">сегодня</span>
                  ) : (
                    <span className="badge">через {b.days_until} дн.</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl">
          Занятия · {format(new Date(date + "T12:00:00"), "d MMMM", { locale: ru })}
        </h2>
        {!sessions.length ? (
          <div className="glass p-8 text-center text-fog">
            На этот день занятий нет. Смотри{" "}
            <Link href="/admin/sessions" className="underline">
              журнал
            </Link>{" "}
            или другую дату.
          </div>
        ) : null}
        {sessions.map((s) => {
          const open = expanded[s.id];
          return (
            <article key={s.id} className="glass p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">{s.group_title}</p>
                  <p className="text-sm text-fog">
                    {format(new Date(s.starts_at), "EEEE · HH:mm", { locale: ru })}
                  </p>
                  <p className="mt-1 text-sm">
                    Придут <strong>{s.expected_coming}</strong> · не придут{" "}
                    {s.expected_wont_come}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {s.status === "cancelled_by_studio" ? (
                    <span className="badge badge-danger">Отменено</span>
                  ) : s.status === "completed" ? (
                    <span className="badge badge-ok">Закрыто</span>
                  ) : s.cancel_risk ? (
                    <span className="badge badge-danger">Риск отмены</span>
                  ) : (
                    <span className="badge badge-ok">Состоится</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost text-sm"
                    onClick={() =>
                      setExpanded((e) => ({ ...e, [s.id]: !e[s.id] }))
                    }
                  >
                    {open ? "Скрыть состав" : "Состав"}
                  </button>
                  <Link
                    href={`/admin/attendance?date=${date}&session=${s.id}`}
                    className="btn btn-ghost text-sm"
                  >
                    Отметить
                  </Link>
                  {s.status === "scheduled" ? (
                    <button
                      type="button"
                      className="btn btn-stage text-sm"
                      disabled={busy}
                      onClick={() => finalize(s.id)}
                    >
                      Закрыть
                    </button>
                  ) : null}
                </div>
              </div>
              {open ? (
                <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                  {s.roster.map((r) => (
                    <li
                      key={r.fullName + (r.status ?? "")}
                      className={`badge ${r.coming ? "badge-ok" : "badge-warn"}`}
                    >
                      {r.fullName}
                      {r.status
                        ? ` · ${attendanceStatusLabel(r.status)}`
                        : !r.coming
                          ? " · не приду"
                          : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
