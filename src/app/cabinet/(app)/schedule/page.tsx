"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CabinetLoading } from "@/components/CabinetLoading";
import { warsawYmd } from "@/lib/format-date";
import { STUDIO_POLICY } from "@/lib/studio-policy";

type Session = {
  id: string;
  group_id?: string;
  title: string;
  starts_at: string;
  status: string;
  myStatus?: string | null;
  forStudentId?: string;
};

type Child = { id: string; full_name: string };

type PlannedItem = {
  sessionId: string;
  title: string;
  startsAt: string;
  studentPersonId: string;
};

type PlannedSkipped = PlannedItem & { reason: string };

type PlannedPreview = {
  eligible: PlannedItem[];
  skipped: PlannedSkipped[];
};

const CUTOFF_MS = STUDIO_POLICY.absentNotifyCutoffHours * 60 * 60 * 1000;

function personLabel(studentId: string | undefined, children: Child[]) {
  return children.find((child) => child.id === studentId)?.full_name ?? null;
}

export default function SchedulePage() {
  const searchParams = useSearchParams();
  const selectedGroupId = searchParams.get("group");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startsOn, setStartsOn] = useState(() => warsawYmd());
  const [endsOn, setEndsOn] = useState(() => warsawYmd());
  /** Empty means the signed-in student. */
  const [planStudentId, setPlanStudentId] = useState("");
  const [planPreview, setPlanPreview] = useState<PlannedPreview | null>(null);
  const [planning, setPlanning] = useState<"preview" | "apply" | null>(null);
  const [now] = useState(() => Date.now());

  const selfHasClasses = useMemo(
    () =>
      sessions.some(
        (session) =>
          !session.forStudentId ||
          !children.some((child) => child.id === session.forStudentId),
      ),
    [children, sessions],
  );
  const planPeople = useMemo(
    () => [
      ...(selfHasClasses ? [{ id: "", full_name: "Я" }] : []),
      ...children,
    ],
    [children, selfHasClasses],
  );
  const visibleSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          new Date(session.starts_at).getTime() >= now &&
          (!selectedGroupId || session.group_id === selectedGroupId),
      ),
    [now, selectedGroupId, sessions],
  );

  async function load() {
    try {
      const res = await fetch("/api/v1/me/dashboard");
      const json = await res.json();
      if (json.ok) {
        setSessions(json.data.schedule ?? []);
        setChildren(json.data.children ?? []);
      } else {
        setMessage(json.error ?? "Не удалось загрузить расписание");
      }
    } catch {
      setMessage("Не удалось загрузить расписание. Попробуй обновить страницу.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!planPeople.length) return;
    if (!planPeople.some((person) => person.id === planStudentId)) {
      setPlanStudentId(planPeople[0]?.id ?? "");
    }
  }, [planPeople, planStudentId]);

  async function cantAttend(sessionId: string, studentPersonId?: string) {
    const label = personLabel(studentPersonId, children);
    if (
      !confirm(
        label
          ? `Перенести занятие для ${label}? Появится отработка, на которую можно выбрать новую дату.`
          : "Перенести занятие? Появится отработка, на которую можно выбрать новую дату.",
      )
    ) {
      return;
    }
    setBusyId(sessionId);
    setMessage("");
    try {
      const res = await fetch("/api/v1/me/cant-attend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, studentPersonId }),
      });
      const json = await res.json();
      setMessage(json.ok ? json.data.message : json.error);
      if (json.ok) await load();
    } catch {
      setMessage("Не удалось перенести занятие. Попробуй ещё раз.");
    } finally {
      setBusyId(null);
    }
  }

  async function previewPlannedAbsence() {
    if (!startsOn || !endsOn || endsOn < startsOn) {
      setMessage("Проверь даты поездки");
      return;
    }
    setPlanning("preview");
    setMessage("");
    setPlanPreview(null);
    try {
      const res = await fetch("/api/v1/me/planned-absence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          startsOn,
          endsOn,
          studentPersonId: planStudentId || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error ?? "Не удалось проверить занятия");
        return;
      }
      setPlanPreview({
        eligible: json.data.eligible ?? [],
        skipped: json.data.skipped ?? [],
      });
    } catch {
      setMessage("Не удалось проверить занятия. Попробуй ещё раз.");
    } finally {
      setPlanning(null);
    }
  }

  async function applyPlannedAbsence() {
    if (!planPreview?.eligible.length) return;
    setPlanning("apply");
    setMessage("");
    try {
      const res = await fetch("/api/v1/me/planned-absence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          startsOn,
          endsOn,
          studentPersonId: planStudentId || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error ?? "Не удалось перенести занятия");
        return;
      }
      const moved = Number(json.data.moved ?? 0);
      const makeups = Number(json.data.createdMakeups ?? 0);
      setMessage(
        moved
          ? `Готово: перенесли ${moved} ${moved === 1 ? "занятие" : "занятия"}; отработок создано: ${makeups}.`
          : json.data.message ?? "Нет занятий, которые можно перенести.",
      );
      setPlanPreview(null);
      await load();
    } catch {
      setMessage("Не удалось перенести занятия. Попробуй ещё раз.");
    } finally {
      setPlanning(null);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">
          {selectedGroupId ? "Занятия группы" : "Мои занятия"}
        </h1>
        <p className="mt-2 text-fog">
          {loading
            ? "Загружаем расписание…"
            : children.length
              ? "Выбери ребёнка и перенеси одно занятие или всю поездку заранее. На каждое перенесённое занятие появится отработка."
              : "Здесь всё твоё расписание. Перенеси одно занятие или весь период поездки заранее — на каждое появится отработка."}
        </p>
      </div>

      {selectedGroupId ? (
        <Link href="/cabinet/schedule" className="btn btn-ghost w-full sm:w-auto">
          ← Все мои занятия
        </Link>
      ) : null}

      {!selectedGroupId ? (
      <section className="glass p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Поездка или отпуск</p>
        <h2 className="mt-2 font-display text-2xl">Перенести занятия на даты</h2>
        <p className="mt-2 max-w-2xl text-sm text-fog">
          Например, уезжаешь с 10 по 15 августа: выбери даты, проверь список и одним подтверждением освободишь все занятия. Исходные места освободятся, а новые даты выберешь в «Отработках».
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {planPeople.length > 1 ? (
            <label className="block text-sm font-medium">
              Для кого
              <select
                className="input mt-1 w-full"
                value={planStudentId}
                onChange={(event) => {
                  setPlanStudentId(event.target.value);
                  setPlanPreview(null);
                }}
              >
                {planPeople.map((person) => (
                  <option key={person.id || "self"} value={person.id}>
                    {person.full_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-sm font-medium">
            С
            <input
              type="date"
              className="input mt-1 w-full"
              value={startsOn}
              onChange={(event) => {
                setStartsOn(event.target.value);
                setPlanPreview(null);
              }}
            />
          </label>
          <label className="block text-sm font-medium">
            По
            <input
              type="date"
              className="input mt-1 w-full"
              min={startsOn}
              value={endsOn}
              onChange={(event) => {
                setEndsOn(event.target.value);
                setPlanPreview(null);
              }}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn btn-stage mt-4 w-full sm:w-auto"
          onClick={previewPlannedAbsence}
          disabled={planning !== null || !planPeople.length}
        >
          {planning === "preview" ? "Проверяем занятия…" : "Проверить занятия"}
        </button>

        {planPreview ? (
          <div className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-4">
            {planPreview.eligible.length ? (
              <>
                <p className="font-semibold">
                  Перенесём {planPreview.eligible.length} {planPreview.eligible.length === 1 ? "занятие" : "занятия"}
                </p>
                <ul className="mt-3 space-y-2 text-sm text-fog">
                  {planPreview.eligible.map((item) => (
                    <li key={item.sessionId}>
                      {format(new Date(item.startsAt), "EEE, d MMMM · HH:mm", { locale: ru })} · {item.title}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btn-primary mt-4 w-full sm:w-auto"
                  onClick={applyPlannedAbsence}
                  disabled={planning !== null}
                >
                  {planning === "apply"
                    ? "Переносим занятия…"
                    : `Подтвердить перенос (${planPreview.eligible.length})`}
                </button>
              </>
            ) : (
              <p className="font-semibold">На эти даты нет занятий, которые можно перенести.</p>
            )}
            {planPreview.skipped.length ? (
              <ul className="mt-4 space-y-1 text-xs text-fog">
                {planPreview.skipped.map((item) => (
                  <li key={`${item.sessionId}-${item.reason}`}>
                    {format(new Date(item.startsAt), "d MMM · HH:mm", { locale: ru })} · {item.title}: {item.reason}.
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
      ) : null}

      {message ? (
        <div className="glass p-4 text-sm">
          {message}{" "}
          <Link href="/cabinet/makeups" className="underline">
            Выбрать дату отработки →
          </Link>
        </div>
      ) : null}

      {loading ? <CabinetLoading label="Загружаем занятия…" /> : null}

      {!loading ? (
        <ul className="space-y-3">
          {visibleSessions.map((session) => {
            const soon = new Date(session.starts_at).getTime() - now < CUTOFF_MS;
            const skipped =
              session.myStatus === "absent_notified" || session.myStatus === "absent";
            const cancelled = session.status === "cancelled_by_studio";
            const child = personLabel(session.forStudentId, children);

            return (
              <li key={session.id + (session.forStudentId ?? "")} className="glass p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold">{session.title}</p>
                    {child ? <p className="text-sm text-fog">за {child}</p> : null}
                    <p className="text-sm text-fog">
                      {format(new Date(session.starts_at), "EEEE, d MMMM yyyy · HH:mm", {
                        locale: ru,
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {cancelled ? (
                      <span className="badge badge-danger">Отменено студией</span>
                    ) : skipped ? (
                      <span className="badge badge-warn">Перенесено · есть отработка</span>
                    ) : (
                      <>
                        <span className="badge badge-ok">В расписании</span>
                        <button
                          type="button"
                          className="btn w-full sm:w-auto"
                          style={{
                            background: "color-mix(in oklab, var(--danger) 85%, black)",
                            color: "#fff",
                            minHeight: 48,
                          }}
                          disabled={busyId === session.id || soon}
                          onClick={() => cantAttend(session.id, session.forStudentId)}
                        >
                          {busyId === session.id
                            ? "Сохраняем…"
                            : soon
                              ? "Уже поздно"
                              : child
                                ? "Перенести ребёнку"
                                : "Перенести"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {!visibleSessions.length ? (
            <li className="glass p-8 text-center text-fog">
              {selectedGroupId
                ? "В этой группе пока нет будущих занятий."
                : "Пока нет будущих занятий в расписании."}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
