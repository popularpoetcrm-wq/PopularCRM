"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatBirthDay } from "@/lib/format-date";

type Member = {
  enrollment_id: string;
  student_person_id: string;
  status: string;
  status_label: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  tshirt_size?: string | null;
};

type Detail = {
  group: {
    id: string;
    title: string;
    direction?: string | null;
    direction_label?: string | null;
    schedule_label?: string | null;
    status: string;
    status_label?: string;
    capacity: number;
    subtitle?: string | null;
    telegram_chat_id?: number | null;
    telegram_linked?: boolean;
    telegram_bind_pending?: boolean;
  };
  members: Member[];
  counts: { active: number; paused: number; ended: number };
};

const DIRECTIONS = [
  { value: "impro", label: "импровизация" },
  { value: "acting", label: "актёрское мастерство" },
  { value: "kids", label: "детская студия" },
  { value: "show", label: "спектакль" },
  { value: "playback", label: "playback" },
  { value: "other", label: "другое" },
];

export default function AdminGroupDetailPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const [data, setData] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const [bindCmd, setBindCmd] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/v1/admin/groups/${id}`);
    const json = await res.json();
    if (!json.ok) {
      setMsg(json.error);
      return;
    }
    setData(json.data);
    setTitle(json.data.group.title);
    setDirection(json.data.group.direction ?? "");
  }

  useEffect(() => {
    if (id) void load();
  }, [id]);

  async function saveMeta() {
    const res = await fetch(`/api/v1/admin/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        direction: direction || null,
      }),
    });
    const json = await res.json();
    setMsg(json.ok ? "Сохранено" : json.error);
    await load();
  }

  async function toggleGroup() {
    if (!data) return;
    const next = data.group.status === "active" ? "archived" : "active";
    const res = await fetch(`/api/v1/admin/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const json = await res.json();
    setMsg(
      json.ok
        ? next === "active"
          ? "Группа снова активная"
          : "Группа неактивная"
        : json.error,
    );
    await load();
  }

  async function setMemberStatus(
    enrollmentId: string,
    status: "active" | "paused" | "ended",
  ) {
    const res = await fetch("/api/v1/admin/enrollments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_status",
        enrollment_id: enrollmentId,
        status,
      }),
    });
    const json = await res.json();
    setMsg(json.ok ? "Статус ученика обновлён" : json.error);
    await load();
  }

  async function issueTgBind() {
    const res = await fetch(`/api/v1/admin/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "telegram_bind_token" }),
    });
    const json = await res.json();
    if (!json.ok) {
      setMsg(json.error);
      return;
    }
    setBindCmd(json.data.command as string);
    const dmHint =
      typeof json.data.dm_hint === "string" ? ` ${json.data.dm_hint}.` : "";
    setMsg(
      `Код на 1 час для «${json.data.title}». Добавь бота в TG-группу (админом) и отправь команду ниже.${dmHint}`,
    );
    await load();
  }

  async function unbindTg() {
    const res = await fetch(`/api/v1/admin/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "telegram_unbind" }),
    });
    const json = await res.json();
    setMsg(json.ok ? "Telegram-группа отвязана" : json.error);
    setBindCmd(null);
    await load();
  }

  async function inviteAllTg() {
    const res = await fetch(`/api/v1/admin/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "telegram_invite_all" }),
    });
    const json = await res.json();
    setMsg(
      json.ok
        ? `Инвайты в TG: отправлено ${json.data.sent} (учеников ${json.data.students})`
        : json.error,
    );
  }

  if (!data) {
    return <p className="text-fog">{msg || "Загрузка…"}</p>;
  }

  const g = data.group;
  const visible = data.members.filter((m) =>
    showEnded ? true : m.status !== "ended",
  );

  return (
    <section className="space-y-6">
      <div>
        <Link href="/admin/groups" className="text-sm text-fog underline">
          ← Все группы
        </Link>
        <h1 className="mt-2 font-display text-3xl">{g.title}</h1>
        <p className="mt-1 text-fog">
          {[g.direction_label, g.schedule_label, g.status_label]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-2 text-sm text-fog">
          Ходят: {data.counts.active} · на паузе: {data.counts.paused} · не
          ходят: {data.counts.ended} · вместимость {g.capacity}
        </p>
      </div>

      {msg ? <p className="text-sm text-stage-deep">{msg}</p> : null}

      <div className="glass space-y-3 p-5">
        <h2 className="font-display text-xl">О группе</h2>
        <label className="block text-sm">
          Название
          <input
            className="input mt-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Напр. Воскресная школа · вс 11:00"
          />
        </label>
        <label className="block text-sm">
          Направление
          <select
            className="input mt-1"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="">не указано</option>
            {DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={saveMeta}>
            Сохранить
          </button>
          <button type="button" className="btn btn-ghost" onClick={toggleGroup}>
            {g.status === "active" ? "Сделать неактивной" : "Сделать активной"}
          </button>
          <a
            className="btn btn-ghost"
            href={`/join?group=${g.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Ссылка «Это я»
          </a>
        </div>
      </div>

      <div className="glass space-y-3 p-5">
        <h2 className="font-display text-xl">Telegram-группа</h2>
        <p className="text-sm text-fog">
          Привяжи супергруппу студии: бот должен быть админом чата. После привязки
          ученикам с личным ботом уйдёт ссылка-приглашение.
        </p>
        {g.telegram_linked ? (
          <p className="text-sm">
            Привязано · chat_id <code>{g.telegram_chat_id}</code>
          </p>
        ) : (
          <p className="text-sm text-fog">Пока не привязано</p>
        )}
        {bindCmd ? (
          <p className="rounded-lg bg-black/20 p-3 font-mono text-sm">{bindCmd}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-stage" onClick={issueTgBind}>
            {g.telegram_linked ? "Перепривязать" : "Получить код /bind"}
          </button>
          {g.telegram_linked ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={inviteAllTg}>
                Разослать инвайты ученикам
              </button>
              <button type="button" className="btn btn-ghost" onClick={unbindTg}>
                Отвязать
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl">Ученики в группе</h2>
        <label className="flex items-center gap-2 text-sm text-fog">
          <input
            type="checkbox"
            checked={showEnded}
            onChange={(e) => setShowEnded(e.target.checked)}
          />
          Показать тех, кто не ходит
        </label>
      </div>

      <ul className="glass divide-y divide-white/10">
        {!visible.length ? (
          <li className="p-5 text-fog">Пока никого.</li>
        ) : (
          visible.map((m) => (
            <li
              key={m.enrollment_id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <Link
                  href={`/admin/students/${m.student_person_id}`}
                  className="font-semibold underline"
                >
                  {m.full_name}
                </Link>
                <p className="text-xs text-fog">
                  {[
                    m.status_label,
                    m.email,
                    m.phone,
                    m.birth_date ? `ДР ${formatBirthDay(m.birth_date)}` : null,
                    m.tshirt_size ? `футболка ${m.tshirt_size}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {m.status !== "active" ? (
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => setMemberStatus(m.enrollment_id, "active")}
                  >
                    Вернуть (ходит)
                  </button>
                ) : null}
                {m.status !== "paused" ? (
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => setMemberStatus(m.enrollment_id, "paused")}
                  >
                    Пауза
                  </button>
                ) : null}
                {m.status !== "ended" ? (
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => setMemberStatus(m.enrollment_id, "ended")}
                  >
                    Не ходит
                  </button>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
