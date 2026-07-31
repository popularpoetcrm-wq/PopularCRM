"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ru } from "date-fns/locale";
import { warsawYmd } from "@/lib/format-date";

type CalEvent = {
  id: string;
  kind: "session" | "trial" | "event";
  title: string;
  starts_at: string;
  group_id?: string | null;
  status?: string | null;
  slug?: string | null;
  venue?: string | null;
  remaining?: number | null;
  total_tickets?: number | null;
  price_pln?: number | null;
  listing_kind?: "trial" | "performance" | "special" | null;
  source?: string | null;
};

function ticketsUrl() {
  return (
    process.env.NEXT_PUBLIC_TICKETS_URL ||
    "https://www.populartickets.pl"
  ).replace(/\/$/, "");
}

function poetUrl() {
  return (
    process.env.NEXT_PUBLIC_POET_URL || "https://popularpoet.pl"
  ).replace(/\/$/, "");
}

function warsawDayKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function warsawTime(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function ticketsHref(base: string, e: CalEvent) {
  if (!e.slug) return base;
  if (e.listing_kind === "special") return `${base}/ru/special/${e.slug}`;
  return `${base}/ru/events/${e.slug}`;
}

function kindLabel(e: CalEvent) {
  if (e.kind === "session") return "Занятие";
  if (e.kind === "trial") return "Пробное · Tickets / Poet";
  if (e.listing_kind === "special") return "Special · Tickets";
  return "Ивент · Tickets / Poet";
}

function kindShort(e: CalEvent) {
  if (e.kind === "session") return e.title;
  if (e.kind === "trial") return "пробн.";
  if (e.listing_kind === "special") return "spec.";
  return "ивент";
}

export default function AdminOffersPage() {
  const base = ticketsUrl();
  const poet = poetUrl();
  const [month, setMonth] = useState(() => warsawYmd().slice(0, 7));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedYmd, setSelectedYmd] = useState(() => warsawYmd());
  const [stubOpen, setStubOpen] = useState(false);
  const [stubContext, setStubContext] = useState<string>("");

  const monthDate = useMemo(() => parseISO(`${month}-01`), [month]);

  async function load(forMonth = month) {
    setLoading(true);
    setError("");
    const res = await fetch(
      `/api/v1/admin/calendar?month=${encodeURIComponent(forMonth)}`,
    );
    const json = await res.json();
    setLoading(false);
    if (!json.ok) {
      setError(json.error || "Ошибка загрузки");
      setEvents([]);
      return;
    }
    setEvents(json.data.events ?? []);
    setTicketsError(
      json.data.tickets_error ?? json.data.trials_error ?? null,
    );
  }

  useEffect(() => {
    void load(month);
    if (!selectedYmd.startsWith(month)) {
      setSelectedYmd(`${month}-01`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [monthDate]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const key = warsawDayKey(ev.starts_at);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const dayEvents = byDay.get(selectedYmd) ?? [];

  function openStub(ctx: string) {
    setStubContext(ctx);
    setStubOpen(true);
  }

  function shiftMonth(delta: number) {
    const next = addMonths(monthDate, delta);
    setMonth(format(next, "yyyy-MM"));
  }

  const weekdayLabels = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Календарь студии</h1>
          <p className="mt-2 max-w-2xl text-fog">
            Занятия групп + ивенты и пробные с{" "}
            <strong className="text-ink">populartickets.pl</strong> (то же, что
            светятся на popularpoet.pl). Страницу пробного создаём в Tickets —
            здесь обзор и заглушка.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            className="btn btn-primary"
            href={`${base}/admin`}
            target="_blank"
            rel="noreferrer"
          >
            Tickets → создать
          </a>
          <a
            className="btn btn-ghost"
            href={poet}
            target="_blank"
            rel="noreferrer"
          >
            Poet
          </a>
          <button
            type="button"
            className="btn btn-stage"
            onClick={() => openStub(`день ${selectedYmd}`)}
          >
            Сделать страницу пробного
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className="btn btn-ghost" onClick={() => shiftMonth(-1)}>
          ←
        </button>
        <p className="min-w-[10rem] text-center font-display text-xl capitalize">
          {format(monthDate, "LLLL yyyy", { locale: ru })}
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => shiftMonth(1)}>
          →
        </button>
        <button
          type="button"
          className="btn btn-ghost text-sm"
          onClick={() => {
            const now = warsawYmd();
            setMonth(now.slice(0, 7));
            setSelectedYmd(now);
          }}
        >
          Сегодня
        </button>
        <span className="ml-auto flex flex-wrap gap-3 text-xs text-fog">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" /> занятие
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--warn)]" /> пробное
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--ok)]" /> ивент
          </span>
        </span>
      </div>

      {loading ? <p className="text-fog">Загружаем месяц…</p> : null}
      {error ? <p className="text-warn">{error}</p> : null}
      {ticketsError ? (
        <p className="text-sm text-warn">
          Ивенты/пробные с Tickets не подтянулись: {ticketsError}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="glass overflow-hidden p-3 sm:p-4">
          <div className="grid grid-cols-7 gap-1 text-center text-xs uppercase tracking-wide text-fog">
            {weekdayLabels.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const ymd = format(day, "yyyy-MM-dd");
              const inMonth = isSameMonth(day, monthDate);
              const selected = ymd === selectedYmd;
              const today = ymd === warsawYmd();
              const list = byDay.get(ymd) ?? [];
              const hasSession = list.some((e) => e.kind === "session");
              const hasTrial = list.some((e) => e.kind === "trial");
              const hasEvent = list.some((e) => e.kind === "event");

              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => setSelectedYmd(ymd)}
                  className={[
                    "min-h-[4.5rem] rounded-xl border p-1.5 text-left transition",
                    inMonth ? "border-white/10" : "border-transparent opacity-40",
                    selected
                      ? "bg-white/15 ring-1 ring-white/30"
                      : "hover:bg-white/8",
                    today && !selected
                      ? "ring-1 ring-[color-mix(in_oklab,var(--accent)_50%,transparent)]"
                      : "",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "text-sm font-semibold",
                      selected ? "text-ink" : "text-fog",
                    ].join(" ")}
                  >
                    {format(day, "d")}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {hasSession ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                    ) : null}
                    {hasTrial ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" />
                    ) : null}
                    {hasEvent ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                    ) : null}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {list.slice(0, 2).map((e) => (
                      <p
                        key={e.id}
                        className="truncate text-[10px] leading-tight text-fog"
                      >
                        {warsawTime(e.starts_at)} {kindShort(e)}
                      </p>
                    ))}
                    {list.length > 2 ? (
                      <p className="text-[10px] text-fog">+{list.length - 2}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="glass space-y-4 p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-fog">День</p>
            <h2 className="font-display text-2xl capitalize">
              {format(parseISO(selectedYmd), "d MMMM yyyy, EEEE", {
                locale: ru,
              })}
            </h2>
          </div>

          {!dayEvents.length ? (
            <p className="text-fog">
              Пусто — можно сделать страницу пробного на этот день.
            </p>
          ) : (
            <ul className="space-y-3">
              {dayEvents.map((e) => (
                <li
                  key={e.id}
                  className="rounded-xl border border-white/10 bg-black/10 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-fog">
                        {kindLabel(e)} · {warsawTime(e.starts_at)}
                      </p>
                      <p className="font-semibold">{e.title}</p>
                      {e.kind !== "session" ? (
                        <p className="mt-1 text-xs text-fog">
                          {[
                            e.venue,
                            e.price_pln != null ? `${e.price_pln} PLN` : null,
                            e.remaining != null && e.total_tickets != null
                              ? `мест ${e.remaining}/${e.total_tickets}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-fog">
                          {e.status ?? "scheduled"}
                        </p>
                      )}
                    </div>
                    {e.kind !== "session" && e.slug ? (
                      <a
                        className="btn btn-ghost text-xs"
                        href={ticketsHref(base, e)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Tickets
                      </a>
                    ) : null}
                  </div>
                  {e.kind === "session" ? (
                    <button
                      type="button"
                      className="btn btn-stage mt-3 text-xs"
                      onClick={() =>
                        openStub(
                          `занятие «${e.title}» ${warsawTime(e.starts_at)} ${selectedYmd}`,
                        )
                      }
                    >
                      Сделать страницу пробного
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={() => openStub(`день ${selectedYmd}`)}
          >
            Сделать страницу пробного на этот день
          </button>
        </div>
      </div>

      {stubOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          onClick={() => setStubOpen(false)}
        >
          <div
            className="glass-strong w-full max-w-md space-y-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-2xl">Пока заглушка</h3>
            <p className="text-sm text-fog">
              Страницы пробных и ивентов создаются на{" "}
              <strong className="text-ink">populartickets.pl</strong> и потом
              видны на popularpoet.pl. Контекст: {stubContext || "—"}.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                className="btn btn-primary"
                href={`${base}/admin`}
                target="_blank"
                rel="noreferrer"
              >
                Открыть Tickets admin
              </a>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStubOpen(false)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
