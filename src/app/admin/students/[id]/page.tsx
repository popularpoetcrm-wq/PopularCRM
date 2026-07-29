"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { formatBirthDay } from "@/lib/format-date";
import { attendanceStatusLabel } from "@/lib/attendance-labels";

type Card = {
  person: {
    id: string;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    birth_date?: string | null;
    tshirt_size?: string | null;
    telegram_username?: string | null;
    onboarding_status?: string;
    is_minor?: boolean;
    telegram_linked?: boolean;
    roles?: string[];
    avatar_url?: string | null;
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
    attendance_type?: string;
    session_title?: string;
    group_title?: string | null;
    starts_at?: string;
  }>;
  attendance_summary?: {
    total: number;
    present: number;
    absent: number;
    absent_notified: number;
    cancelled_by_studio: number;
    makeup: number;
  };
  invites: Array<{
    email: string;
    created_at: string;
    consumed_at?: string;
    expires_at: string;
  }>;
  parents: Array<{
    id?: string;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    telegram_username?: string | null;
  }>;
  children: Array<{
    id: string;
    full_name: string;
    birth_date?: string | null;
    tshirt_size?: string | null;
  }>;
  makeups: Array<{ status: string; valid_until: string }>;
};

export default function StudentCardPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const [card, setCard] = useState<Card | null>(null);
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");

  async function load() {
    const res = await fetch(`/api/v1/admin/students/${id}`);
    const json = await res.json();
    if (json.ok) {
      setCard(json.data);
      setEmail(json.data.person.email ?? "");
      setPhone(json.data.person.phone ?? "");
      setTelegram(json.data.person.telegram_username ?? "");
    } else setMsg(json.error);
  }

  useEffect(() => {
    if (id) void load();
  }, [id]);

  async function invite() {
    const res = await fetch(`/api/v1/admin/students/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "invite",
        email: email || undefined,
      }),
    });
    const json = await res.json();
    setMsg(
      json.ok
        ? `Инвайт: ${json.data.magicUrl}${json.data.emailed ? " (email sent)" : " (ссылка — email не настроен)"}`
        : json.error,
    );
    await load();
  }

  async function saveContacts() {
    const res = await fetch(`/api/v1/admin/students/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email || undefined,
        phone: phone || null,
        telegram_username: telegram || null,
      }),
    });
    const json = await res.json();
    setMsg(json.ok ? "Контакты сохранены" : json.error);
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
            {[p.email, p.phone, p.telegram_username ? `@${p.telegram_username}` : null]
              .filter(Boolean)
              .join(" · ") || "Нет контактов"}
            {p.is_minor ? " · ребёнок" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {"avatar_url" in p && (p as { avatar_url?: string }).avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(p as { avatar_url?: string }).avatar_url}
              alt=""
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : null}
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
      </div>

      {msg ? <p className="break-all text-sm text-stage-deep">{msg}</p> : null}

      <div className="glass grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-fog">Профиль</p>
          <dl className="mt-2 space-y-1 text-sm">
            <div>ДР: {formatBirthDay(p.birth_date)}</div>
            <div>Футболка: {p.tshirt_size ?? "—"}</div>
            <div>Роли: {(p.roles ?? []).join(", ") || "—"}</div>
          </dl>
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-fog">Контакты</p>
          <input
            className="input w-full"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@…"
          />
          <input
            className="input w-full"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="телефон"
          />
          <input
            className="input w-full"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value.replace(/^@/, ""))}
            placeholder="telegram username"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost text-sm" onClick={saveContacts}>
              Сохранить
            </button>
            <button type="button" className="btn btn-primary text-sm" onClick={invite}>
              Инвайт
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="glass p-4">
          <p className="text-xs uppercase tracking-wide text-fog">Группы</p>
          <p className="mt-2 font-semibold">
            {card.groups.map((g) => g.title).join(", ") || "—"}
          </p>
        </div>
        <div className="glass p-4">
          <p className="text-xs uppercase tracking-wide text-fog">Пакет</p>
          <p className="mt-2 text-3xl font-semibold">
            {card.packages[0]
              ? `${card.packages[0].credits_available}/${card.packages[0].credits_total}`
              : "—"}
          </p>
        </div>
      </div>

      <div className="glass p-4">
        <p className="text-xs uppercase tracking-wide text-fog">Посещаемость</p>
        <p className="mt-1 text-xs text-fog">
          Сводка по отметкам в базе (легенда Excel уточнит спецметки позже).
        </p>
        {card.attendance_summary ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div>
              <p className="text-2xl font-semibold">{card.attendance_summary.present}</p>
              <p className="text-xs text-fog">Был</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">
                {card.attendance_summary.absent_notified}
              </p>
              <p className="text-xs text-fog">Предупредил</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{card.attendance_summary.absent}</p>
              <p className="text-xs text-fog">Не был</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{card.attendance_summary.makeup}</p>
              <p className="text-xs text-fog">Отработка</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{card.attendance_summary.total}</p>
              <p className="text-xs text-fog">Всего отметок</p>
            </div>
          </div>
        ) : null}
        {!card.attendance.length ? (
          <p className="mt-3 text-fog">Пока нет отметок</p>
        ) : (
          <ul className="mt-4 max-h-64 divide-y divide-white/10 overflow-y-auto">
            {card.attendance.map((a, i) => (
              <li
                key={`${a.starts_at}-${a.status}-${i}`}
                className="flex flex-wrap justify-between gap-2 py-2 text-sm"
              >
                <span>
                  {a.session_title ?? "Занятие"}
                  {a.starts_at
                    ? ` · ${format(new Date(a.starts_at), "d MMM yyyy", { locale: ru })}`
                    : ""}
                </span>
                <span className="text-fog">
                  {attendanceStatusLabel(a.status)}
                  {a.attendance_type === "makeup" ? " · отработка" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {card.parents?.length ? (
        <div className="glass p-4">
          <p className="text-xs uppercase tracking-wide text-fog">Родители</p>
          <ul className="mt-2 space-y-2 text-sm">
            {card.parents.map((x) => (
              <li key={x.id ?? x.email ?? x.full_name}>
                <span className="font-semibold">{x.full_name}</span>
                <span className="text-fog">
                  {" "}
                  ·{" "}
                  {[x.email, x.phone, x.telegram_username ? `@${x.telegram_username}` : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.children?.length ? (
        <div className="glass p-4">
          <p className="text-xs uppercase tracking-wide text-fog">Дети</p>
          <ul className="mt-2 space-y-2 text-sm">
            {card.children.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/students/${c.id}`} className="font-semibold underline">
                  {c.full_name}
                </Link>
                <span className="text-fog">
                  {" "}
                  · ДР {formatBirthDay(c.birth_date)}
                  {c.tshirt_size ? ` · ${c.tshirt_size}` : ""}
                </span>
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
        <p className="text-xs uppercase tracking-wide text-fog">Инвайты</p>
        {!card.invites.length ? (
          <p className="mt-3 text-fog">Ещё не приглашали</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {card.invites.map((inv, i) => (
              <li key={`${inv.email}-${i}`}>
                {inv.email} ·{" "}
                {inv.consumed_at
                  ? "использован"
                  : `до ${format(new Date(inv.expires_at), "d MMM", { locale: ru })}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
