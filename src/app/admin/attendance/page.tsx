"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { STUDIO_POLICY } from "@/lib/studio-policy";

type Roster = {
  enrollmentId: string;
  studentPersonId: string;
  fullName: string;
  status: string | null;
  explicitWontCome?: boolean;
};

type Session = {
  id: string;
  title: string;
  group_title: string;
  starts_at: string;
  capacity: number;
  status?: string;
  expected_coming?: number;
  expected_wont_come?: number;
  will_hold?: boolean;
  roster: Roster[];
};

export default function AdminAttendancePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/v1/attendance/bulk-upsert");
    const json = await res.json();
    if (json.ok) {
      setSessions(json.data);
      const first = json.data[0];
      if (first && !sessionId) {
        setSessionId(first.id);
        const initial: Record<string, string> = {};
        for (const r of first.roster) {
          initial[r.studentPersonId] = r.status ?? "present";
        }
        setMarks(initial);
      }
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const initial: Record<string, string> = {};
    for (const r of s.roster) {
      initial[r.studentPersonId] = r.status ?? "present";
    }
    setMarks(initial);
  }, [sessionId, sessions]);

  const current = sessions.find((s) => s.id === sessionId);

  async function submit() {
    if (!current) return;
    setBusy(true);
    setMessage("");
    const items = current.roster.map((s) => ({
      enrollmentId: s.enrollmentId,
      studentPersonId: s.studentPersonId,
      attendanceType: "regular" as const,
      status: (marks[s.studentPersonId] ?? "present") as
        | "present"
        | "absent"
        | "absent_notified"
        | "cancelled_by_studio",
    }));

    const res = await fetch("/api/v1/attendance/bulk-upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, items }),
    });
    const json = await res.json();
    setBusy(false);
    setMessage(
      json.ok
        ? `Сохранено. Makeups создано: ${(json.data.createdMakeups ?? []).length}`
        : json.error,
    );
    await load();
  }

  async function finalize() {
    if (!current) return;
    if (
      !confirm(
        "Закрыть занятие? Все без явного «не приду» будут отмечены как пришедшие.",
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/v1/attendance/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const json = await res.json();
    setBusy(false);
    setMessage(
      json.ok
        ? `Закрыто. Makeups: ${(json.data.createdMakeups ?? []).length}`
        : json.error,
    );
    await load();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Посещаемость</h1>
        <p className="text-fog">
          По умолчанию — пришёл. «Не приду» за {STUDIO_POLICY.absentNotifyCutoffHours}+ ч.
          Если придёт меньше {STUDIO_POLICY.minAttendeesToHold} — занятие отменяется.
        </p>
      </div>

      <label className="block max-w-lg text-sm font-semibold">
        Занятие
        <select
          className="input mt-2"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.group_title} ·{" "}
              {format(new Date(s.starts_at), "d MMM HH:mm", { locale: pl })}
              {s.will_hold === false ? " · ОТМЕНА?" : ""}
            </option>
          ))}
        </select>
      </label>

      {current ? (
        <div className="glass flex flex-wrap items-center gap-3 p-4 text-sm">
          <span>
            Ожидается: <strong>{current.expected_coming ?? "—"}</strong> придут ·{" "}
            {current.expected_wont_come ?? 0} не придут
          </span>
          {current.status === "cancelled_by_studio" ? (
            <span className="badge badge-danger">Отменено студией</span>
          ) : current.will_hold === false ? (
            <span className="badge badge-danger">
              Мало людей (&lt;{STUDIO_POLICY.minAttendeesToHold}) — отменится
            </span>
          ) : (
            <span className="badge badge-ok">Занятие состоится</span>
          )}
        </div>
      ) : null}

      {!current?.roster.length ? (
        <div className="glass p-6 text-fog">Нет учеников в группе / нет сессий. Сделай Seed дня.</div>
      ) : (
        <ul className="space-y-3">
          {current.roster.map((s) => (
            <li
              key={s.studentPersonId}
              className="glass flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div>
                <p className="font-semibold">{s.fullName}</p>
                {s.explicitWontCome ? (
                  <p className="text-xs text-warn">явно: не приду</p>
                ) : s.status ? (
                  <p className="text-xs text-fog">уже отмечен: {s.status}</p>
                ) : (
                  <p className="text-xs text-fog">по умолчанию: придёт</p>
                )}
              </div>
              <select
                className="input max-w-xs"
                value={marks[s.studentPersonId] ?? "present"}
                onChange={(e) =>
                  setMarks((m) => ({ ...m, [s.studentPersonId]: e.target.value }))
                }
              >
                <option value="present">present</option>
                <option value="absent">absent</option>
                <option value="absent_notified">absent_notified</option>
                <option value="cancelled_by_studio">cancelled_by_studio</option>
              </select>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary" onClick={submit} disabled={!current || busy}>
          Сохранить посещаемость
        </button>
        <button className="btn btn-stage" onClick={finalize} disabled={!current || busy}>
          Закрыть занятие
        </button>
      </div>
      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}
    </section>
  );
}
