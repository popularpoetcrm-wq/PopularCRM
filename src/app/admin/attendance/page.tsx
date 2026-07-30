"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  ATTENDANCE_STATUS_LABELS,
  addCalendarDays,
  attendanceStatusLabel,
} from "@/lib/attendance-labels";
import { warsawYmd } from "@/lib/format-date";

type Roster = {
  enrollmentId: string;
  studentPersonId: string;
  fullName: string;
  phone?: string | null;
  birth_day?: string | null;
  tshirt_size?: string | null;
  avatar_url?: string | null;
  telegram_username?: string | null;
  telegram_url?: string | null;
  stats?: { present: number; absent: number; total: number };
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

/** Админ отмечает факт: пришёл / не пришёл. «Предупредил» — только из ЛК клиента. */
const MARK_OPTIONS = ["present", "absent", "cancelled_by_studio"] as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function AttendanceInner() {
  const search = useSearchParams();
  const [date, setDate] = useState(
    () => search.get("date") || warsawYmd(),
  );
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState(search.get("session") || "");
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(forDate = date, preferSession = sessionId) {
    const res = await fetch(
      `/api/v1/attendance/bulk-upsert?date=${encodeURIComponent(forDate)}`,
    );
    const json = await res.json();
    if (json.ok) {
      const list = json.data as Session[];
      setSessions(list);
      const preferred =
        list.find((s) => s.id === preferSession) ?? list[0] ?? null;
      if (preferred) {
        setSessionId(preferred.id);
        const initial: Record<string, string> = {};
        for (const r of preferred.roster) {
          initial[r.studentPersonId] = r.status ?? "present";
        }
        setMarks(initial);
      } else {
        setSessionId("");
        setMarks({});
      }
    }
  }

  useEffect(() => {
    void load(date, search.get("session") || sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

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
  const today = warsawYmd();
  const yesterday = addCalendarDays(today, -1);

  async function submit() {
    if (!current) return;
    setBusy(true);
    setMessage("");
    const items = current.roster.map((s) => {
      const chosen = marks[s.studentPersonId] ?? "present";
      // Не затираем клиентское «предупредил» кнопкой «не пришёл».
      const preserved =
        chosen === "absent" && s.status === "absent_notified"
          ? "absent_notified"
          : chosen;
      return {
        enrollmentId: s.enrollmentId,
        studentPersonId: s.studentPersonId,
        attendanceType: "regular" as const,
        status: preserved as
          | "present"
          | "absent"
          | "absent_notified"
          | "cancelled_by_studio",
      };
    });

    const res = await fetch("/api/v1/attendance/bulk-upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, items }),
    });
    const json = await res.json();
    setBusy(false);
    setMessage(
      json.ok
        ? `Сохранено. Отработок создано: ${(json.data.createdMakeups ?? []).length}`
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
        ? `Закрыто. Отработок: ${(json.data.createdMakeups ?? []).length}`
        : json.error,
    );
    await load();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Посещаемость</h1>
        <p className="text-fog">
          Отметь «пришёл / не пришёл» и закрой занятие. «Предупредил» ставит
          клиент в ЛК (≥6 ч) — это не перезаписываем вручную.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm font-semibold">
          Дата
          <input
            type="date"
            className="input mt-2"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-ghost text-sm" onClick={() => setDate(today)}>
          Сегодня
        </button>
        <button
          type="button"
          className="btn btn-ghost text-sm"
          onClick={() => setDate(yesterday)}
        >
          Вчера
        </button>
        <label className="block min-w-[16rem] flex-1 text-sm font-semibold">
          Занятие
          <select
            className="input mt-2"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            disabled={!sessions.length}
          >
            {!sessions.length ? (
              <option value="">Нет занятий в этот день</option>
            ) : null}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.group_title} ·{" "}
                {format(new Date(s.starts_at), "d MMM HH:mm", { locale: ru })}
                {s.will_hold === false ? " · мало участников" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {current ? (
        <div className="glass flex flex-wrap items-center gap-3 p-4 text-sm">
          <span>
            Ожидается: <strong>{current.expected_coming ?? "—"}</strong> придут ·{" "}
            {current.expected_wont_come ?? 0} не придут
          </span>
          {current.status === "cancelled_by_studio" ? (
            <span className="badge badge-danger">Отменено студией</span>
          ) : current.status === "completed" ? (
            <span className="badge badge-ok">Закрыто</span>
          ) : current.will_hold === false ? (
            <span className="badge badge-danger">
              Мало участников — проверь, состоится ли занятие
            </span>
          ) : (
            <span className="badge badge-ok">Занятие состоится</span>
          )}
        </div>
      ) : null}

      {!current?.roster.length ? (
        <div className="glass p-6 text-fog">
          Нет занятий или учеников на выбранную дату. Выбери другой день или открой
          журнал занятий.
        </div>
      ) : (
        <ul className="space-y-3">
          {current.roster.map((s) => {
            const value = marks[s.studentPersonId] ?? "present";
            const stats = s.stats ?? { present: 0, absent: 0, total: 0 };
            const rate =
              stats.total > 0
                ? Math.round((stats.present / stats.total) * 100)
                : null;
            const meta = [
              s.birth_day ? `ДР ${s.birth_day}` : null,
              s.phone || null,
              s.tshirt_size ? `футболка ${s.tshirt_size}` : null,
            ].filter(Boolean);

            return (
              <li
                key={s.studentPersonId}
                className="glass grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Link
                    href={`/admin/students/${s.studentPersonId}`}
                    className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white/10"
                    title="Карточка ученика"
                  >
                    {s.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-xs font-semibold text-fog">
                        {initials(s.fullName)}
                      </span>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <Link
                        href={`/admin/students/${s.studentPersonId}`}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {s.fullName}
                      </Link>
                      {s.telegram_username ? (
                        <span className="text-xs text-fog">@{s.telegram_username}</span>
                      ) : null}
                    </div>
                    {meta.length ? (
                      <p className="mt-0.5 truncate text-xs text-fog">{meta.join(" · ")}</p>
                    ) : (
                      <p className="mt-0.5 text-xs text-fog">
                        {s.status
                          ? `в базе: ${attendanceStatusLabel(s.status)}`
                          : "ещё не отмечен"}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="badge">
                        был {stats.present}/{stats.total || "—"}
                        {rate != null ? ` · ${rate}%` : ""}
                      </span>
                      {stats.absent > 0 ? (
                        <span className="badge badge-warn">пропуск {stats.absent}</span>
                      ) : null}
                      {s.telegram_url ? (
                        <a
                          href={s.telegram_url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost px-2 py-1 text-xs"
                        >
                          Telegram
                        </a>
                      ) : (
                        <span className="text-fog">TG —</span>
                      )}
                      <Link
                        href={`/admin/students/${s.studentPersonId}`}
                        className="btn btn-ghost px-2 py-1 text-xs"
                      >
                        Карточка
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                  {s.status === "absent_notified" ? (
                    <span className="badge badge-warn mr-1">предупредил</span>
                  ) : null}
                  {MARK_OPTIONS.map((opt) => {
                    const active =
                      value === opt ||
                      (opt === "absent" && value === "absent_notified");
                    return (
                      <button
                        key={opt}
                        type="button"
                        className={`btn text-sm ${
                          active ? "btn-stage" : "btn-ghost"
                        }`}
                        onClick={() =>
                          setMarks((m) => ({
                            ...m,
                            [s.studentPersonId]:
                              opt === "absent" && s.status === "absent_notified"
                                ? "absent_notified"
                                : opt,
                          }))
                        }
                      >
                        {ATTENDANCE_STATUS_LABELS[opt]}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary" onClick={submit} disabled={!current || busy}>
          Сохранить
        </button>
        <button className="btn btn-stage" onClick={finalize} disabled={!current || busy}>
          Закрыть занятие
        </button>
      </div>
      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}
    </section>
  );
}

export default function AdminAttendancePage() {
  return (
    <Suspense fallback={<p className="text-fog">Загрузка…</p>}>
      <AttendanceInner />
    </Suspense>
  );
}
