"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import Link from "next/link";
import { STUDIO_POLICY } from "@/lib/studio-policy";

type Makeup = {
  id: string;
  status: string;
  valid_until: string;
  target_session_id?: string | null;
  target_kind?: string | null;
  tickets_event_id?: string | null;
};

type DestGroup = {
  kind: "group_session";
  id: string;
  title: string;
  group_title: string;
  starts_at: string;
  remaining: number;
};

type DestTrial = {
  kind: "trial_event";
  id: string;
  title: string;
  starts_at: string;
  venue: string;
  remaining: number;
};

const STATUS_LABELS: Record<string, string> = {
  available: "можно использовать",
  booked: "забронирована",
  used: "использована",
  expired: "срок истёк",
  burned: "сгорела",
};

export default function MakeupsPage() {
  const [makeups, setMakeups] = useState<Makeup[]>([]);
  const [groups, setGroups] = useState<DestGroup[]>([]);
  const [trials, setTrials] = useState<DestTrial[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [dashRes, destRes] = await Promise.all([
      fetch("/api/v1/me/dashboard"),
      fetch("/api/v1/me/makeup-destinations"),
    ]);
    const dash = await dashRes.json();
    const dest = await destRes.json();
    if (dash.ok) setMakeups(dash.data.makeups ?? []);
    if (dest.ok) {
      setGroups(dest.data.groups ?? []);
      setTrials(dest.data.trials ?? []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const options = [
    ...groups.map((g) => ({
      value: `group:${g.id}`,
      label: `${g.group_title} · ${format(new Date(g.starts_at), "d MMM HH:mm", { locale: ru })} · мест ${g.remaining}`,
    })),
    ...trials.map((t) => ({
      value: `trial:${t.id}`,
      label: `Пробное · ${t.title} · ${format(new Date(t.starts_at), "d MMM HH:mm", { locale: ru })} · мест ${t.remaining}`,
    })),
  ];

  async function book(makeupId: string) {
    setMessage("");
    const raw = selected[makeupId] || options[0]?.value;
    if (!raw) {
      setMessage("Нет доступных занятий или пробных для брони");
      return;
    }
    const [kind, id] = raw.split(":");
    setBusyId(makeupId);
    const body =
      kind === "trial"
        ? { targetKind: "trial_event", ticketsEventId: id }
        : { targetKind: "group_session", targetSessionId: id };
    const res = await fetch(`/api/v1/makeups/${makeupId}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusyId(null);
    setMessage(
      json.ok
        ? kind === "trial"
          ? "Отработка на пробное забронирована (место на poet занято бесплатно)."
          : "Отработка забронирована на занятие группы."
        : json.error,
    );
    await load();
  }

  async function cancel(makeupId: string) {
    setBusyId(makeupId);
    const res = await fetch(`/api/v1/makeups/${makeupId}/cancel`, {
      method: "POST",
    });
    const json = await res.json();
    setBusyId(null);
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
        <p className="mt-2 text-fog">
          Появится, если предупредил «не приду» ≥{STUDIO_POLICY.absentNotifyCutoffHours}{" "}
          ч до занятия. Можно прийти в другую группу или на пробное с popularpoet.pl
          (бесплатно, но место списывается). Бронь/отмена за{" "}
          {STUDIO_POLICY.makeupCutoffHours} ч.
        </p>
        <p className="mt-1 text-sm text-fog">
          <Link href="/cabinet/schedule" className="underline">
            Расписание
          </Link>
          {" · "}
          <Link href="/cabinet/payments" className="underline">
            Оплата
          </Link>
          {" · "}
          <Link href="/cabinet/invoices" className="underline">
            Фактуры
          </Link>
        </p>
      </div>
      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      <div className="space-y-4">
        {makeups.map((m) => (
          <article key={m.id} className="glass p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">Отработка</p>
                <p className="text-sm text-fog">
                  до {format(new Date(m.valid_until), "d MMM yyyy", { locale: ru })}
                  {m.target_kind === "trial_event"
                    ? " · пробное"
                    : m.target_session_id
                      ? " · занятие группы"
                      : ""}
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
                  className="input max-w-xl"
                  value={selected[m.id] ?? options[0]?.value ?? ""}
                  onChange={(e) =>
                    setSelected((s) => ({ ...s, [m.id]: e.target.value }))
                  }
                >
                  {!options.length ? (
                    <option value="">Нет свободных слотов</option>
                  ) : null}
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-stage"
                  onClick={() => book(m.id)}
                  disabled={!options.length || busyId === m.id}
                >
                  Забронировать
                </button>
              </div>
            ) : null}

            {m.status === "booked" ? (
              <button
                className="btn btn-ghost mt-4"
                onClick={() => cancel(m.id)}
                disabled={busyId === m.id}
              >
                Отменить бронь
              </button>
            ) : null}
          </article>
        ))}
        {!makeups.length ? (
          <div className="glass p-8 text-center text-fog">
            Нет отработок. Отметь «не приду» в{" "}
            <Link href="/cabinet/schedule" className="underline">
              расписании
            </Link>{" "}
            заранее — тогда отработка появится здесь.
          </div>
        ) : null}
      </div>
    </section>
  );
}
