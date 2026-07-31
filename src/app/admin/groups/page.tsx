"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatBirthDay } from "@/lib/format-date";
import { enrollmentStatusLabel } from "@/lib/group-display";

type Group = {
  id: string;
  title: string;
  capacity: number;
  teacher_name: string;
  brand_id: string;
  status?: "active" | "archived";
  direction?: string | null;
  direction_label?: string | null;
  schedule_label?: string | null;
  status_label?: string;
};

type RosterRow = {
  enrollment_id: string;
  student_person_id: string;
  full_name: string;
  tshirt_size?: string;
  birth_date?: string;
  enrollment_status?: string;
  amount?: number;
  amount_paid?: number;
  payment_id?: string;
  payment_status?: string;
  payment_method?: string;
};

export default function AdminGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState("");
  const [message, setMessage] = useState("");
  const [roster, setRoster] = useState<Record<string, RosterRow[]>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [showEndedMembers, setShowEndedMembers] = useState(false);

  async function load(includeInactive = showInactive) {
    setLoading(true);
    const q = includeInactive ? "?all=1" : "";
    const [g, s, p] = await Promise.all([
      fetch(`/api/v1/admin/groups${q}`).then((r) => r.json()),
      fetch("/api/v1/admin/students").then((r) => r.json()),
      fetch("/api/v1/admin/payments").then((r) => r.json()),
    ]);
    if (g.ok) setGroups(Array.isArray(g.data) ? g.data : []);

    const map: Record<string, RosterRow[]> = {};
    if (s.ok) {
      const people = new Map(
        ((s.data.students as Array<{
          id: string;
          full_name: string;
          tshirt_size?: string;
          birth_date?: string;
        }>) ?? []).map((person) => [person.id, person]),
      );
      const payments = (p.ok ? p.data : []) as Array<{
        id: string;
        enrollment_id: string;
        amount: number;
        amount_paid: number;
        status: string;
        payment_method: string;
      }>;
      const payByEnroll = new Map<string, (typeof payments)[number]>();
      for (const payment of payments) {
        if (payment.enrollment_id && !payByEnroll.has(payment.enrollment_id)) {
          payByEnroll.set(payment.enrollment_id, payment);
        }
      }

      for (const enr of s.data.enrollments ?? []) {
        const person = people.get(enr.student_person_id);
        if (!person) continue;
        const payment = payByEnroll.get(enr.id);
        map[enr.group_id] ??= [];
        map[enr.group_id].push({
          enrollment_id: enr.id,
          student_person_id: person.id,
          full_name: person.full_name,
          tshirt_size: person.tshirt_size,
          birth_date: person.birth_date,
          enrollment_status: enr.status,
          amount: payment?.amount,
          amount_paid: payment?.amount_paid,
          payment_id: payment?.id,
          payment_status: payment?.status,
          payment_method: payment?.payment_method,
        });
      }
      for (const rows of Object.values(map)) {
        rows.sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
      }
    }
    setRoster(map);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeGroups = useMemo(
    () => groups.filter((g) => (g.status ?? "active") === "active"),
    [groups],
  );

  const totalInGroups = useMemo(
    () => Object.values(roster).reduce((n, rows) => n + rows.length, 0),
    [roster],
  );

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/admin/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        direction: direction || undefined,
      }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Группа: ${json.data.title}` : json.error);
    setTitle("");
    setDirection("");
    await load();
  }

  async function toggleStatus(g: Group) {
    const next = (g.status ?? "active") === "active" ? "archived" : "active";
    const res = await fetch("/api/v1/admin/groups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: g.id, status: next }),
    });
    const json = await res.json();
    setMessage(
      json.ok
        ? `${g.title}: ${next === "active" ? "активна" : "неактивна"}`
        : json.error,
    );
    await load(showInactive || next === "archived");
  }

  async function moveStudent(row: RosterRow, toGroupId: string) {
    if (!toGroupId) return;
    const res = await fetch("/api/v1/admin/enrollments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "move",
        enrollment_id: row.enrollment_id,
        to_group_id: toGroupId,
      }),
    });
    const json = await res.json();
    const target = groups.find((g) => g.id === toGroupId);
    setMessage(
      json.ok
        ? `${row.full_name} → ${target?.title ?? "группа"}`
        : json.error,
    );
    await load();
  }

  async function setMemberStatus(
    row: RosterRow,
    status: "active" | "paused" | "ended",
  ) {
    const res = await fetch("/api/v1/admin/enrollments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_status",
        enrollment_id: row.enrollment_id,
        status,
      }),
    });
    const json = await res.json();
    setMessage(
      json.ok
        ? `${row.full_name}: ${enrollmentStatusLabel(status)}`
        : json.error,
    );
    await load();
  }

  async function saveAmount(row: RosterRow) {
    const amount = Number(amounts[row.enrollment_id] ?? row.amount ?? 400);
    const res = await fetch("/api/v1/admin/payments/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert",
        enrollment_id: row.enrollment_id,
        payer_person_id: row.student_person_id,
        amount,
        amount_paid: ["pending", "partial"].includes(row.payment_status ?? "")
          ? row.amount_paid ?? 0
          : 0,
        payment_method: row.payment_method ?? "cash",
        description: `Пакет — ${row.full_name}`,
      }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Сумма сохранена: ${amount} PLN` : json.error);
    await load();
  }

  async function addPartial(row: RosterRow) {
    if (!row.payment_id) {
      setMessage("Сначала задай сумму");
      return;
    }
    const res = await fetch("/api/v1/admin/payments/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "partial",
        payment_id: row.payment_id,
        add_amount: 100,
        method: "cash",
      }),
    });
    const json = await res.json();
    setMessage(json.ok ? `+100 PLN → ${json.data.status}` : json.error);
    await load();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Группы</h1>
        <p className="text-fog">
          Название · направление · активная/неактивная · кто ходит
          {!loading ? ` · ${groups.length} групп · ${totalInGroups} записей` : " · загрузка…"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={createGroup} className="glass flex flex-1 flex-wrap gap-3 p-4">
          <input
            className="input max-w-md flex-1"
            placeholder="Название, напр. Воскресная школа"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <select
            className="input max-w-xs"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="">направление</option>
            <option value="impro">импровизация</option>
            <option value="acting">актёрское мастерство</option>
            <option value="kids">детская студия</option>
            <option value="show">спектакль</option>
            <option value="playback">playback</option>
            <option value="other">другое</option>
          </select>
          <button className="btn btn-primary" type="submit">
            Создать группу
          </button>
        </form>
        <label className="glass flex items-center gap-2 px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => {
              const v = e.target.checked;
              setShowInactive(v);
              void load(v);
            }}
          />
          Неактивные группы
        </label>
        <label className="glass flex items-center gap-2 px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={showEndedMembers}
            onChange={(e) => setShowEndedMembers(e.target.checked)}
          />
          Кто не ходит
        </label>
      </div>

      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      {!loading && !groups.length ? (
        <div className="glass p-8 text-center text-fog">Нет групп на этой вкладке.</div>
      ) : null}

      {groups.map((g) => {
        const active = (g.status ?? "active") === "active";
        const members = (roster[g.id] ?? []).filter((r) =>
          showEndedMembers
            ? true
            : (r.enrollment_status ?? "active") !== "ended",
        );
        return (
          <article
            key={g.id}
            className={`glass overflow-hidden ${active ? "" : "opacity-60"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <Link
                  href={`/admin/groups/${g.id}`}
                  className="font-display text-2xl underline"
                >
                  {g.title}
                </Link>
                <p className="text-sm text-fog">
                  {[
                    g.direction_label,
                    g.schedule_label,
                    g.teacher_name !== "—" ? g.teacher_name : null,
                    `${g.capacity} мест`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${active ? "badge-ok" : "badge-warn"}`}>
                  {g.status_label ?? (active ? "активная" : "неактивная")}
                </span>
                <span className="badge">
                  {(roster[g.id] ?? []).filter((r) => (r.enrollment_status ?? "active") === "active").length}{" "}
                  ходят
                </span>
                <Link href={`/admin/groups/${g.id}`} className="btn btn-stage text-sm">
                  Открыть
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost text-sm"
                  onClick={() => toggleStatus(g)}
                >
                  {active ? "Сделать неактивной" : "Сделать активной"}
                </button>
              </div>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="table-glass min-w-full">
                <thead>
                  <tr>
                    <th>Имя</th>
                    <th>В группе</th>
                    <th>Футболка</th>
                    <th>ДР</th>
                    <th>Сумма</th>
                    <th>Внесено</th>
                    <th>Оплата</th>
                    <th>Перенос</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-fog">
                        Пока никого в группе
                      </td>
                    </tr>
                  ) : (
                    members.map((row) => (
                      <tr key={row.enrollment_id}>
                        <td className="font-semibold">
                          <Link
                            href={`/admin/students/${row.student_person_id}`}
                            className="underline"
                          >
                            {row.full_name}
                          </Link>
                        </td>
                        <td>
                          <select
                            className="input max-w-[9rem] text-sm"
                            value={row.enrollment_status ?? "active"}
                            onChange={(e) => {
                              const v = e.target.value as
                                | "active"
                                | "paused"
                                | "ended";
                              void setMemberStatus(row, v);
                            }}
                          >
                            <option value="active">ходит</option>
                            <option value="paused">на паузе</option>
                            <option value="ended">не ходит</option>
                          </select>
                        </td>
                        <td>{row.tshirt_size ?? "—"}</td>
                        <td>{formatBirthDay(row.birth_date)}</td>
                        <td>
                          <input
                            className="input max-w-24"
                            defaultValue={row.amount ?? 400}
                            onChange={(e) =>
                              setAmounts((a) => ({
                                ...a,
                                [row.enrollment_id]: e.target.value,
                              }))
                            }
                          />
                        </td>
                        <td>{row.amount_paid ?? 0}</td>
                        <td>
                          <span className="badge">
                            {row.payment_status === "paid"
                              ? "оплачено"
                              : row.payment_status === "pending"
                                ? "ждём"
                                : row.payment_status === "partial"
                                  ? "частично"
                                  : row.payment_status ?? "нет"}
                          </span>
                        </td>
                        <td>
                          <select
                            className="input max-w-[14rem] text-sm"
                            defaultValue=""
                            disabled={!active}
                            onChange={(e) => {
                              const to = e.target.value;
                              e.target.value = "";
                              if (to) void moveStudent(row, to);
                            }}
                          >
                            <option value="">В другую группу…</option>
                            {activeGroups
                              .filter((x) => x.id !== g.id)
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.title}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="space-x-2 whitespace-nowrap">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => saveAmount(row)}
                          >
                            Сохранить
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => addPartial(row)}
                          >
                            +100
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-white/10 md:hidden">
              {members.length === 0 ? (
                <li className="p-5 text-fog">Пока никого в группе</li>
              ) : (
                members.map((row) => (
                  <li key={row.enrollment_id} className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/students/${row.student_person_id}`}
                          className="break-words font-semibold underline"
                        >
                          {row.full_name}
                        </Link>
                        <p className="mt-1 text-xs text-fog">
                          ДР {formatBirthDay(row.birth_date)} · футболка{" "}
                          {row.tshirt_size ?? "—"}
                        </p>
                      </div>
                      <span className="badge shrink-0">
                        {row.payment_status === "paid"
                          ? "оплачено"
                          : row.payment_status === "pending"
                            ? "ждём оплату"
                            : row.payment_status === "partial"
                              ? "частично"
                              : "нет начисления"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-fog">
                        В группе
                        <select
                          className="input mt-1 text-sm text-foreground"
                          value={row.enrollment_status ?? "active"}
                          onChange={(e) =>
                            void setMemberStatus(
                              row,
                              e.target.value as "active" | "paused" | "ended",
                            )
                          }
                        >
                          <option value="active">ходит</option>
                          <option value="paused">на паузе</option>
                          <option value="ended">не ходит</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-fog">
                        Сумма, PLN
                        <input
                          className="input mt-1 text-foreground"
                          inputMode="decimal"
                          defaultValue={row.amount ?? 400}
                          onChange={(e) =>
                            setAmounts((amountMap) => ({
                              ...amountMap,
                              [row.enrollment_id]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>

                    <p className="text-sm text-fog">
                      Внесено: <strong className="text-foreground">{row.amount_paid ?? 0} PLN</strong>
                    </p>

                    <select
                      className="input text-sm"
                      defaultValue=""
                      disabled={!active}
                      onChange={(e) => {
                        const to = e.target.value;
                        e.target.value = "";
                        if (to) void moveStudent(row, to);
                      }}
                    >
                      <option value="">Перевести в другую группу…</option>
                      {activeGroups
                        .filter((item) => item.id !== g.id)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                    </select>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className="btn btn-ghost text-sm"
                        type="button"
                        onClick={() => saveAmount(row)}
                      >
                        Сохранить сумму
                      </button>
                      <button
                        className="btn btn-stage text-sm"
                        type="button"
                        onClick={() => addPartial(row)}
                      >
                        Внести 100 PLN
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
