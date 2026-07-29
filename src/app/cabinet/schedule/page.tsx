"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import Link from "next/link";
import { STUDIO_POLICY } from "@/lib/studio-policy";

type Session = {
  id: string;
  title: string;
  starts_at: string;
  status: string;
  myStatus?: string | null;
  forStudentId?: string;
};

type Child = { id: string; full_name: string };

const CUTOFF_MS = STUDIO_POLICY.absentNotifyCutoffHours * 60 * 60 * 1000;

export default function SchedulePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v1/me/dashboard");
    const json = await res.json();
    if (!json.ok) return;
    setSessions(json.data.schedule ?? []);
    setChildren(json.data.children ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function cantAttend(sessionId: string, studentPersonId?: string) {
    const label = studentPersonId
      ? children.find((c) => c.id === studentPersonId)?.full_name
      : null;
    if (!confirm(label ? `Ребёнок ${label} не придёт?` : "Сообщить, что не придёшь?")) {
      return;
    }
    setBusyId(sessionId);
    setMessage("");
    const res = await fetch("/api/v1/me/cant-attend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, studentPersonId }),
    });
    const json = await res.json();
    setBusyId(null);
    setMessage(json.ok ? json.data.message : json.error);
    await load();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Мои занятия</h1>
        <p className="mt-2 text-fog">
          {children.length
            ? "Родительский кабинет: отметь «не придёт» за ребёнка."
            : `По умолчанию придёшь. «Не приду» за ${STUDIO_POLICY.absentNotifyCutoffHours}+ ч.`}
        </p>
      </div>

      {message ? (
        <div className="glass p-4 text-sm">
          {message}{" "}
          <Link href="/cabinet/makeups" className="underline">
            К отработкам →
          </Link>
        </div>
      ) : null}

      <ul className="space-y-3">
        {sessions.map((s) => {
          const soon = new Date(s.starts_at).getTime() - Date.now() < CUTOFF_MS;
          const skipped =
            s.myStatus === "absent_notified" || s.myStatus === "absent";
          const cancelled = s.status === "cancelled_by_studio";
          const child = children.find((c) => c.id === s.forStudentId);

          return (
            <li key={s.id + (s.forStudentId ?? "")} className="glass p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{s.title}</p>
                  {child ? (
                    <p className="text-sm text-fog">за {child.full_name}</p>
                  ) : null}
                  <p className="text-sm text-fog">
                    {format(new Date(s.starts_at), "EEEE, d MMMM yyyy · HH:mm", {
                      locale: pl,
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {cancelled ? (
                    <span className="badge badge-danger">Отменено</span>
                  ) : skipped ? (
                    <span className="badge badge-warn">Не приду</span>
                  ) : (
                    <>
                      <span className="badge badge-ok">Приду</span>
                      <button
                        type="button"
                        className="btn w-full sm:w-auto"
                        style={{
                          background: "color-mix(in oklab, var(--danger) 85%, black)",
                          color: "#fff",
                          minHeight: 48,
                        }}
                        disabled={busyId === s.id || soon}
                        onClick={() => cantAttend(s.id, s.forStudentId)}
                      >
                        {busyId === s.id
                          ? "…"
                          : soon
                            ? "Уже поздно"
                            : child
                              ? "Ребёнок не придёт"
                              : "Не приду"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {!sessions.length ? (
          <li className="glass p-8 text-center text-fog">Пока нет занятий в расписании.</li>
        ) : null}
      </ul>
    </section>
  );
}
