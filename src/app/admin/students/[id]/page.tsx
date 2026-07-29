"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

type Card = {
  person: {
    id: string;
    full_name: string;
    email: string;
    phone?: string;
    onboarding_status?: string;
    is_minor?: boolean;
    telegram_linked?: boolean;
  };
  groups: Array<{ title: string }>;
  packages: Array<{ credits_available: number; credits_total: number }>;
  payments: Array<{
    id: string;
    amount: number;
    amount_paid: number;
    status: string;
    description: string;
    created_at: string;
  }>;
  attendance: Array<{
    status: string;
    session_title?: string;
    starts_at?: string;
  }>;
  invites: Array<{
    email: string;
    created_at: string;
    consumed_at?: string;
    expires_at: string;
  }>;
  parents: Array<{ full_name: string; email: string }>;
  children: Array<{ full_name: string; id: string }>;
  makeups: Array<{ status: string; valid_until: string }>;
};

export default function StudentCardPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const [card, setCard] = useState<Card | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await fetch(`/api/v1/admin/students/${id}`);
    const json = await res.json();
    if (json.ok) setCard(json.data);
    else setMsg(json.error);
  }

  useEffect(() => {
    if (id) void load();
  }, [id]);

  async function invite() {
    const res = await fetch(`/api/v1/admin/students/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "invite" }),
    });
    const json = await res.json();
    setMsg(json.ok ? `Инвайт: ${json.data.magicUrl}` : json.error);
    await load();
  }

  if (!card) {
    return <p className="text-fog">{msg || "Загрузка…"}</p>;
  }

  const p = card.person;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/students" className="text-sm text-fog underline">
            ← Ученики
          </Link>
          <h1 className="mt-2 font-display text-3xl">{p.full_name}</h1>
          <p className="text-fog">
            {p.email} · {p.phone ?? "—"}
            {p.is_minor ? " · ребёнок" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="badge">{p.onboarding_status ?? "draft"}</span>
          <span className={`badge ${p.telegram_linked ? "badge-ok" : "badge-warn"}`}>
            TG {p.telegram_linked ? "ok" : "—"}
          </span>
          <button type="button" className="btn btn-stage text-sm" onClick={invite}>
            Пригласить
          </button>
        </div>
      </div>

      {msg ? <p className="break-all text-sm text-stage-deep">{msg}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="glass p-4">
          <p className="text-xs uppercase tracking-wide text-fog">Группы</p>
          <p className="mt-2 font-semibold">
            {card.groups.map((g) => g.title).join(", ") || "—"}
          </p>
        </div>
        <div className="glass p-4">
          <p className="text-xs uppercase tracking-wide text-fog">Пакет</p>
          <p className="mt-2 text-2xl font-semibold">
            {card.packages[0]
              ? `${card.packages[0].credits_available}/${card.packages[0].credits_total}`
              : "—"}
          </p>
        </div>
      </div>

      {card.parents?.length ? (
        <div className="glass p-4">
          <p className="text-xs uppercase tracking-wide text-fog">Родители</p>
          <ul className="mt-2 space-y-1">
            {card.parents.map((x) => (
              <li key={x.email}>
                {x.full_name} · {x.email}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.children?.length ? (
        <div className="glass p-4">
          <p className="text-xs uppercase tracking-wide text-fog">Дети</p>
          <ul className="mt-2 space-y-1">
            {card.children.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/students/${c.id}`} className="underline">
                  {c.full_name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="glass p-4">
        <p className="text-xs uppercase tracking-wide text-fog">Платежи</p>
        {!card.payments.length ? (
          <p className="mt-3 text-fog">Пока нет</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/10">
            {card.payments.map((pay) => (
              <li key={pay.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>
                  {pay.description} · {pay.status}
                </span>
                <span>
                  {pay.amount_paid}/{pay.amount} PLN
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="glass p-4">
        <p className="text-xs uppercase tracking-wide text-fog">Посещения</p>
        {!card.attendance.length ? (
          <p className="mt-3 text-fog">Пока нет отметок</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/10">
            {card.attendance.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>{a.session_title ?? "занятие"}</span>
                <span>
                  {a.status}
                  {a.starts_at
                    ? ` · ${format(new Date(a.starts_at), "d MMM", { locale: pl })}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="glass p-4">
        <p className="text-xs uppercase tracking-wide text-fog">Инвайты</p>
        {!card.invites.length ? (
          <p className="mt-3 text-fog">Ещё не приглашали</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/10">
            {card.invites.map((inv, i) => (
              <li key={i} className="py-2 text-sm">
                {inv.email} · {inv.consumed_at ? "открыт" : "ожидает"} ·{" "}
                {format(new Date(inv.created_at), "d MMM HH:mm", { locale: pl })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="glass p-4">
        <p className="text-xs uppercase tracking-wide text-fog">Отработки</p>
        <p className="mt-2">
          {card.makeups.filter((m) => m.status === "available").length} available
        </p>
      </div>
    </section>
  );
}
