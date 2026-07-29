"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

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

export default function AdminHome() {
  const [stats, setStats] = useState({ groups: 0, debt: 0, students: 0 });
  const [sessions, setSessions] = useState<DaySession[]>([]);
  const [jobMsg, setJobMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [g, p, s, d] = await Promise.all([
      fetch("/api/v1/admin/groups").then((r) => r.json()),
      fetch("/api/v1/admin/payments").then((r) => r.json()),
      fetch("/api/v1/admin/students").then((r) => r.json()),
      fetch("/api/v1/admin/day").then((r) => r.json()),
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
    if (d.ok) setSessions(d.data.sessions ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

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

  async function finalize(sessionId: string) {
    if (!confirm("Закрыть занятие? Все без «не приду» → present")) return;
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

  return (
    <div className="grid gap-5">
      <section className="glass glass-strong p-5 sm:p-6">
        <h1 className="font-display text-3xl sm:text-4xl">Рабочий день</h1>
        <p className="mt-2 text-fog">
          Кто придёт · риск отмены · массовые действия — без внешних ключей.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-stage" disabled={busy} onClick={seed}>
            Seed дня
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={tick}>
            Tick jobs
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={remindDebtors}>
            Напомнить должникам
          </button>
          <a href="/api/v1/reports/export?type=week" className="btn btn-ghost">
            CSV недели
          </a>
          <Link href="/admin/attendance" className="btn btn-ghost">
            Посещаемость
          </Link>
        </div>
        {jobMsg ? <p className="mt-3 break-all text-sm text-stage-deep">{jobMsg}</p> : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
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
        <h2 className="font-display text-2xl">Ближайшие занятия</h2>
        {!sessions.length ? (
          <div className="glass p-8 text-center text-fog">
            Нет занятий на неделю. Нажми Seed дня.
          </div>
        ) : null}
        {sessions.map((s) => (
          <article key={s.id} className="glass p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{s.group_title}</p>
                <p className="text-sm text-fog">
                  {format(new Date(s.starts_at), "EEEE d MMM · HH:mm", { locale: pl })}
                </p>
                <p className="mt-2 text-sm">
                  Придут <strong>{s.expected_coming}</strong> · не придут{" "}
                  {s.expected_wont_come}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {s.status === "cancelled_by_studio" ? (
                  <span className="badge badge-danger">Отменено</span>
                ) : s.cancel_risk ? (
                  <span className="badge badge-danger">Риск отмены</span>
                ) : (
                  <span className="badge badge-ok">Состоится</span>
                )}
                {s.status === "scheduled" ? (
                  <button
                    type="button"
                    className="btn btn-stage text-sm"
                    disabled={busy}
                    onClick={() => finalize(s.id)}
                  >
                    Закрыть занятие
                  </button>
                ) : null}
              </div>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {s.roster.map((r) => (
                <li
                  key={r.fullName + r.status}
                  className={`badge ${r.coming ? "badge-ok" : "badge-warn"}`}
                >
                  {r.fullName}
                  {!r.coming ? " · не приду" : ""}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}
