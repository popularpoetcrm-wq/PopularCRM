"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

type ArchiveSession = {
  id: string;
  group_id: string;
  group_title: string;
  starts_at: string;
  status: string;
  present_count: number;
  absent_count: number;
  marked_count: number;
};

type GroupOpt = { id: string; title: string; status?: string };

function monthNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_RU: Record<string, string> = {
  scheduled: "Запланировано",
  completed: "Закрыто",
  cancelled_by_studio: "Отменено",
};

function SessionsArchiveInner() {
  const [month, setMonth] = useState(monthNow);
  const [groupId, setGroupId] = useState("");
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [groups, setGroups] = useState<GroupOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(m = month, g = groupId) {
    setBusy(true);
    setError("");
    const q = new URLSearchParams({ month: m });
    if (g) q.set("groupId", g);
    const res = await fetch(`/api/v1/admin/sessions?${q}`);
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setError(json.error ?? "Ошибка");
      return;
    }
    setSessions(json.data.sessions ?? []);
    setGroups(json.data.groups ?? []);
    if (json.data.month) setMonth(json.data.month);
  }

  useEffect(() => {
    void load(month, groupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, groupId]);

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-3xl">Журнал занятий</h1>
        <p className="text-fog">
          Архив по месяцу и группе. Чтобы поставить отметки — открой день в посещаемости.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">
          Месяц
          <input
            type="month"
            className="input mt-2"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <label className="min-w-[14rem] flex-1 text-sm font-semibold">
          Группа
          <select
            className="input mt-2"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
          >
            <option value="">Все группы</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
                {g.status === "archived" ? " (неактивна)" : ""}
              </option>
            ))}
          </select>
        </label>
        <Link href="/admin/attendance" className="btn btn-stage text-sm">
          Отметить день
        </Link>
        <button
          type="button"
          className="btn btn-ghost text-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            const res = await fetch("/api/v1/admin/sessions/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ weeks: 8 }),
            });
            const json = await res.json();
            setBusy(false);
            if (!json.ok) setError(json.error);
            else await load(month, groupId);
          }}
        >
          Сгенерировать 8 недель
        </button>
      </div>

      {error ? <p className="text-sm text-warn">{error}</p> : null}
      {busy && !sessions.length ? <p className="text-fog">Загрузка…</p> : null}

      {!busy && !sessions.length ? (
        <div className="glass p-8 text-center text-fog">Нет занятий за этот месяц.</div>
      ) : (
        <>
        <div className="glass hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-white/10 text-fog">
              <tr>
                <th className="px-4 py-3 font-medium">Дата</th>
                <th className="px-4 py-3 font-medium">Группа</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium">Был</th>
                <th className="px-4 py-3 font-medium">Не был</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const day = s.starts_at.slice(0, 10);
                return (
                  <tr key={s.id} className="border-b border-white/5">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {format(new Date(s.starts_at), "d MMM · HH:mm", { locale: ru })}
                    </td>
                    <td className="px-4 py-3">{s.group_title}</td>
                    <td className="px-4 py-3">
                      <span className="badge">{STATUS_RU[s.status] ?? s.status}</span>
                    </td>
                    <td className="px-4 py-3">{s.present_count}</td>
                    <td className="px-4 py-3">{s.absent_count}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/attendance?date=${day}&session=${s.id}`}
                        className="text-sm underline"
                      >
                        Отметить
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="space-y-3 sm:hidden">
          {sessions.map((s) => {
            const day = s.starts_at.slice(0, 10);
            return (
              <li key={s.id} className="glass p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{s.group_title}</p>
                    <p className="mt-1 text-sm text-fog">
                      {format(new Date(s.starts_at), "d MMMM · HH:mm", {
                        locale: ru,
                      })}
                    </p>
                  </div>
                  <span className="badge shrink-0">
                    {STATUS_RU[s.status] ?? s.status}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-sm text-fog">
                    Пришли {s.present_count} · не пришли {s.absent_count}
                  </p>
                  <Link
                    href={`/admin/attendance?date=${day}&session=${s.id}`}
                    className="btn btn-stage text-sm"
                  >
                    Отметить
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </section>
  );
}

export default function AdminSessionsPage() {
  return (
    <Suspense fallback={<p className="text-fog">Загрузка…</p>}>
      <SessionsArchiveInner />
    </Suspense>
  );
}
