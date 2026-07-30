"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { STUDIO_POLICY } from "@/lib/studio-policy";

type Makeup = {
  id: string;
  status: string;
  valid_until: string;
  target_session_id?: string;
};
type Session = { id: string; title: string; starts_at: string };

const STATUS_LABELS: Record<string, string> = {
  available: "можно использовать",
  booked: "забронирована",
  used: "использована",
  expired: "срок истёк",
  burned: "сгорела",
};

export default function MakeupsPage() {
  const [makeups, setMakeups] = useState<Makeup[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch("/api/v1/me/dashboard");
    const json = await res.json();
    if (json.ok) {
      setMakeups(json.data.makeups ?? []);
      setSessions(json.data.schedule ?? []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function book(makeupId: string) {
    setMessage("");
    const targetSessionId = selected[makeupId] || sessions[0]?.id;
    if (!targetSessionId) {
      setMessage("Нет доступных занятий для брони");
      return;
    }
    const res = await fetch(`/api/v1/makeups/${makeupId}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetSessionId }),
    });
    const json = await res.json();
    setMessage(json.ok ? "Отработка забронирована." : json.error);
    await load();
  }

  async function cancel(makeupId: string) {
    const res = await fetch(`/api/v1/makeups/${makeupId}/cancel`, { method: "POST" });
    const json = await res.json();
    setMessage(
      json.ok
        ? json.data.creditStatus === "burned"
          ? "Бронь отменена слишком поздно — отработка сгорела."
          : "Бронь отменена, отработка снова доступна."
        : json.error,
    );
    await load();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Отработки</h1>
        <p className="text-fog">
          Бронируй и отменяй минимум за {STUDIO_POLICY.makeupCutoffHours} ч.
          Одна отработка даёт одно дополнительное занятие.
        </p>
      </div>
      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      <div className="space-y-4">
        {makeups.map((m) => (
          <article key={m.id} className="glass p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{m.id}</p>
                <p className="text-sm text-fog">
                  до {format(new Date(m.valid_until), "d MMM yyyy", { locale: ru })}
                  {m.target_session_id ? ` · занятие ${m.target_session_id.slice(0, 8)}` : ""}
                </p>
              </div>
              <span
                className={`badge ${
                  m.status === "available"
                    ? "badge-ok"
                    : m.status === "burned" || m.status === "expired"
                      ? "badge-danger"
                      : "badge-warn"
                }`}
              >
                {STATUS_LABELS[m.status] ?? m.status}
              </span>
            </div>

            {m.status === "available" ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <select
                  className="input max-w-md"
                  value={selected[m.id] ?? sessions[0]?.id ?? ""}
                  onChange={(e) =>
                    setSelected((s) => ({ ...s, [m.id]: e.target.value }))
                  }
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ·{" "}
                      {format(new Date(s.starts_at), "d MMM HH:mm", { locale: ru })}
                    </option>
                  ))}
                </select>
                <button className="btn btn-stage" onClick={() => book(m.id)} disabled={!sessions.length}>
                  Забронировать
                </button>
              </div>
            ) : null}

            {m.status === "booked" ? (
              <button className="btn btn-ghost mt-4" onClick={() => cancel(m.id)}>
                Отменить бронь
              </button>
            ) : null}
          </article>
        ))}
        {!makeups.length ? (
          <div className="glass p-8 text-center text-fog">
            Нет отработок. Если отметишься «не приду» — отработка появится здесь.
          </div>
        ) : null}
      </div>
    </section>
  );
}
