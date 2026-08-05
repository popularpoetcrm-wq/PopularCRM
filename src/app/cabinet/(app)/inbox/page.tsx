"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ru } from "date-fns/locale";
import { CabinetLoading } from "@/components/CabinetLoading";

type Note = {
  id: string;
  template_code: string;
  title: string;
  body: string;
  category: "payment" | "attendance" | "makeup" | "schedule" | "document" | "system";
  priority: "urgent" | "high" | "normal" | "low";
  action: { label: string; href: string } | null;
  read_at: string | null;
  created_at: string;
};

type Filter = "important" | "all" | "read";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "important", label: "Важно сейчас" },
  { id: "all", label: "Все" },
  { id: "read", label: "Прочитано" },
];

const CATEGORY_LABEL: Record<Note["category"], string> = {
  payment: "Оплата",
  attendance: "Занятие",
  makeup: "Отработка",
  schedule: "Расписание",
  document: "Документ",
  system: "Студия",
};

function cardTone(priority: Note["priority"], read: boolean) {
  if (read) return "border-white/10 opacity-70";
  if (priority === "urgent") return "border-red-300/40 bg-red-300/[0.07]";
  if (priority === "high") return "border-amber-200/35 bg-amber-200/[0.06]";
  return "border-white/20";
}

function categoryBadge(priority: Note["priority"]) {
  if (priority === "urgent") return "badge badge-danger";
  if (priority === "high") return "badge badge-warn";
  return "badge";
}

export default function InboxPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [filter, setFilter] = useState<Filter>("important");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/v1/me/notifications");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Не удалось загрузить сообщения");
      setNotes(json.data.notifications ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить сообщения");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const unread = notes.filter((note) => !note.read_at).length;
  const important = notes.filter(
    (note) => !note.read_at && ["urgent", "high"].includes(note.priority),
  ).length;
  const visible = useMemo(() => {
    if (filter === "read") return notes.filter((note) => note.read_at);
    if (filter === "important") {
      return notes.filter(
        (note) => !note.read_at && ["urgent", "high"].includes(note.priority),
      );
    }
    return notes;
  }, [filter, notes]);

  async function update(action: "read" | "unread" | "archive" | "read_all", id?: string) {
    setBusyId(id ?? "all");
    setError("");
    try {
      const res = await fetch("/api/v1/me/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(id ? { id } : {}) }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Не удалось сохранить");
      const now = new Date().toISOString();
      if (action === "archive" && id) {
        setNotes((current) => current.filter((note) => note.id !== id));
      } else if (action === "read_all") {
        setNotes((current) => current.map((note) => ({ ...note, read_at: note.read_at ?? now })));
      } else if (id) {
        setNotes((current) =>
          current.map((note) =>
            note.id === id ? { ...note, read_at: action === "read" ? now : null } : note,
          ),
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить");
    } finally {
      setBusyId(null);
    }
  }

  function openAction(note: Note) {
    if (!note.read_at) void update("read", note.id);
  }

  return (
    <section className="space-y-5">
      <header className="glass glass-strong overflow-hidden p-5 sm:p-7">
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-fog">Центр заботы</p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl">Важное — без лишнего шума</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-fog sm:text-base">
            Здесь только оплаты, ближайшие занятия, отработки и изменения студии.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className={important ? "badge badge-warn" : "badge badge-ok"}>
              {important ? `Нужно действие: ${important}` : "Срочных дел нет"}
            </span>
            {unread ? <span className="badge">Непрочитано: {unread}</span> : null}
          </div>
        </div>
      </header>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Фильтр сообщений">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className="btn btn-ghost shrink-0 px-4 text-sm"
              data-active={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {unread ? (
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-fog underline underline-offset-4"
            disabled={busyId === "all"}
            onClick={() => void update("read_all")}
          >
            Прочитать все
          </button>
        ) : null}
      </div>

      {error ? <p className="glass border-red-300/30 p-4 text-sm text-danger" role="alert">{error}</p> : null}
      {loading ? <CabinetLoading label="Собираем важное…" /> : null}

      {!loading ? (
        <div className="space-y-3" aria-live="polite">
          {visible.map((note) => {
            const read = Boolean(note.read_at);
            return (
              <article
                key={note.id}
                className={`glass p-5 transition sm:p-6 ${cardTone(note.priority, read)}`}
              >
                <div className="relative">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={categoryBadge(note.priority)}>{CATEGORY_LABEL[note.category]}</span>
                    {!read ? <span className="h-2 w-2 rounded-full bg-accent" aria-label="Не прочитано" /> : null}
                    <time className="text-xs text-fog" dateTime={note.created_at} title={format(new Date(note.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}>
                      {formatDistanceToNowStrict(new Date(note.created_at), { addSuffix: true, locale: ru })}
                    </time>
                  </div>
                  <h2 className="mt-3 font-display text-2xl">{note.title}</h2>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-fog sm:text-base">{note.body}</p>

                  <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
                    {note.action ? (
                      <Link
                        href={note.action.href}
                        className="btn btn-stage w-full sm:w-auto"
                        onClick={() => openAction(note)}
                      >
                        {note.action.label} →
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost w-full text-sm sm:w-auto"
                      disabled={busyId === note.id}
                      onClick={() => void update(read ? "unread" : "read", note.id)}
                    >
                      {read ? "Вернуть в непрочитанные" : "Готово"}
                    </button>
                    {read ? (
                      <button
                        type="button"
                        className="min-h-11 px-3 text-sm text-fog underline underline-offset-4"
                        disabled={busyId === note.id}
                        onClick={() => void update("archive", note.id)}
                      >
                        Скрыть
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}

          {!visible.length ? (
            <div className="glass p-8 text-center sm:p-10">
              <p className="text-3xl" aria-hidden="true">✓</p>
              <h2 className="mt-3 font-display text-2xl">
                {filter === "important" ? "Срочных дел нет" : "Здесь пока пусто"}
              </h2>
              <p className="mt-2 text-sm text-fog">
                {filter === "important"
                  ? "Если появится оплата, занятие или отработка, требующая внимания, мы покажем её здесь."
                  : "Новые сообщения студии появятся автоматически."}
              </p>
              {filter === "important" && notes.length ? (
                <button type="button" className="btn btn-ghost mt-5" onClick={() => setFilter("all")}>
                  Посмотреть все
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
