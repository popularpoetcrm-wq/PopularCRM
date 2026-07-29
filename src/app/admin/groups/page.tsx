"use client";

import { useEffect, useState } from "react";

type Group = {
  id: string;
  title: string;
  capacity: number;
  teacher_name: string;
  brand_id: string;
};

type RosterRow = {
  enrollment_id: string;
  student_person_id: string;
  full_name: string;
  tshirt_size?: string;
  birth_date?: string;
  amount?: number;
  amount_paid?: number;
  payment_id?: string;
  payment_status?: string;
  payment_method?: string;
  credits?: string;
};

export default function AdminGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [roster, setRoster] = useState<Record<string, RosterRow[]>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  async function load() {
    const [g, s] = await Promise.all([
      fetch("/api/v1/admin/groups").then((r) => r.json()),
      fetch("/api/v1/admin/students").then((r) => r.json()),
    ]);
    if (g.ok) setGroups(g.data);
    if (s.ok) {
      const map: Record<string, RosterRow[]> = {};
      for (const enr of s.data.enrollments ?? []) {
        const person = (s.data.students as { id: string; full_name: string; tshirt_size?: string; birth_date?: string }[]).find(
          (p) => p.id === enr.student_person_id,
        );
        if (!person) continue;
        const paymentsRes = await fetch("/api/v1/admin/payments");
        const paymentsJson = await paymentsRes.json();
        const payment = (paymentsJson.data ?? []).find(
          (p: { enrollment_id: string }) => p.enrollment_id === enr.id,
        );
        map[enr.group_id] ??= [];
        map[enr.group_id].push({
          enrollment_id: enr.id,
          student_person_id: person.id,
          full_name: person.full_name,
          tshirt_size: person.tshirt_size,
          birth_date: person.birth_date,
          amount: payment?.amount,
          amount_paid: payment?.amount_paid,
          payment_id: payment?.id,
          payment_status: payment?.status,
          payment_method: payment?.payment_method,
        });
      }
      setRoster(map);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/admin/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Группа: ${json.data.title}` : json.error);
    setTitle("");
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
        amount_paid: row.amount_paid ?? 0,
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
        <p className="text-fog">Лист группы: суммы, partial, метод оплаты</p>
      </div>

      <form onSubmit={createGroup} className="glass flex flex-wrap gap-3 p-4">
        <input
          className="input max-w-md flex-1"
          placeholder="Напр. Piątek 19:00 — Impro"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <button className="btn btn-primary" type="submit">
          Создать группу
        </button>
      </form>

      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      {groups.map((g) => (
        <article key={g.id} className="glass overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="font-display text-2xl">{g.title}</h2>
              <p className="text-sm text-fog">
                {g.teacher_name} · {g.capacity} мест
              </p>
            </div>
            <span className="badge">{(roster[g.id] ?? []).length} чел.</span>
          </div>
          <div className="overflow-x-auto">
            <table className="table-glass min-w-full">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Футболка</th>
                  <th>ДР</th>
                  <th>Сумма</th>
                  <th>Внесено</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(roster[g.id] ?? []).map((row) => (
                  <tr key={row.enrollment_id}>
                    <td className="font-semibold">{row.full_name}</td>
                    <td>{row.tshirt_size ?? "—"}</td>
                    <td>{row.birth_date ?? "—"}</td>
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
                      <span className="badge">{row.payment_status ?? "нет"}</span>
                    </td>
                    <td className="space-x-2 whitespace-nowrap">
                      <button className="btn btn-ghost" type="button" onClick={() => saveAmount(row)}>
                        Save
                      </button>
                      <button className="btn btn-ghost" type="button" onClick={() => addPartial(row)}>
                        +100
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </section>
  );
}
