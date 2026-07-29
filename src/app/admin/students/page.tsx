"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Student = {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  onboarding_status?: string;
  telegram_linked?: boolean;
  credits_available?: number;
  is_minor?: boolean;
};
type Group = { id: string; title: string };

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<"adult" | "kids">("adult");
  const [csv, setCsv] = useState(
    "email,full_name,phone,group,credits_left,makeups_left,parent_email\n",
  );
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    tshirt_size: "",
    birth_date: "",
    group_id: "",
    invite: true,
  });
  const [kids, setKids] = useState({
    child_full_name: "",
    child_birth_date: "",
    parent_full_name: "",
    parent_email: "",
    parent_phone: "",
    group_id: "",
    credits_left: "",
    invite: true,
  });

  async function load() {
    const [s, g] = await Promise.all([
      fetch("/api/v1/admin/students").then((r) => r.json()),
      fetch("/api/v1/admin/groups").then((r) => r.json()),
    ]);
    if (s.ok) setStudents(s.data.students ?? []);
    if (g.ok) setGroups(g.data ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createAdult(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/admin/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, group_id: form.group_id || undefined }),
    });
    const json = await res.json();
    setMessage(
      json.ok
        ? json.data.invite?.magicUrl
          ? `Создан: ${json.data.person.full_name}. ${json.data.invite.magicUrl}`
          : `Создан: ${json.data.person.full_name}`
        : json.error,
    );
    if (json.ok) {
      setForm({ ...form, full_name: "", email: "", phone: "", birth_date: "", tshirt_size: "" });
      await load();
    }
  }

  async function createKids(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/admin/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "child_parent",
        ...kids,
        group_id: kids.group_id || undefined,
        credits_left: kids.credits_left ? Number(kids.credits_left) : undefined,
      }),
    });
    const json = await res.json();
    setMessage(
      json.ok
        ? `Ребёнок ${json.data.child.full_name} + родитель ${json.data.parent.full_name}${
            json.data.invite?.magicUrl ? ` · ${json.data.invite.magicUrl}` : ""
          }`
        : json.error,
    );
    if (json.ok) {
      setKids({
        ...kids,
        child_full_name: "",
        child_birth_date: "",
        parent_full_name: "",
        parent_email: "",
        parent_phone: "",
        credits_left: "",
      });
      await load();
    }
  }

  async function inviteSelected() {
    const personIds = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (!personIds.length) return setMessage("Выбери хотя бы одного");
    const res = await fetch("/api/v1/admin/students/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personIds }),
    });
    const json = await res.json();
    if (json.ok) {
      setMessage(
        `Инвайты: ${(json.data.results as Array<{ ok: boolean }>).filter((r) => r.ok).length}`,
      );
      setSelected({});
      await load();
    } else setMessage(json.error);
  }

  async function inviteGroup(groupId: string) {
    const res = await fetch("/api/v1/admin/students/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    const json = await res.json();
    setMessage(
      json.ok
        ? `Инвайт группы: ${(json.data.results as Array<{ ok: boolean }>).filter((r) => r.ok).length}`
        : json.error,
    );
    if (json.ok) await load();
  }

  async function importCsv() {
    const res = await fetch("/api/v1/admin/students", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import", csv }),
    });
    const json = await res.json();
    setMessage(
      json.ok
        ? `Импорт: ${(json.data.results as Array<{ ok: boolean }>).filter((r) => r.ok).length}`
        : json.error,
    );
    if (json.ok) await load();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Ученики</h1>
        <p className="text-fog">Взрослые · пара ребёнок+родитель · CSV · инвайты</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`btn ${mode === "adult" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setMode("adult")}
        >
          Взрослый
        </button>
        <button
          type="button"
          className={`btn ${mode === "kids" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setMode("kids")}
        >
          Kids: ребёнок + родитель
        </button>
      </div>

      {mode === "adult" ? (
        <form onSubmit={createAdult} className="glass grid gap-3 p-5 md:grid-cols-2">
          <input className="input" placeholder="Имя" required value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <input className="input" type="email" placeholder="Email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" placeholder="Телефон" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <select className="input" value={form.group_id}
            onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
            <option value="">Без группы</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={form.invite}
              onChange={(e) => setForm({ ...form, invite: e.target.checked })} />
            Сразу magic-link
          </label>
          <button className="btn btn-primary md:col-span-2" type="submit">Добавить</button>
        </form>
      ) : (
        <form onSubmit={createKids} className="glass grid gap-3 p-5 md:grid-cols-2">
          <input className="input" placeholder="Имя ребёнка" required value={kids.child_full_name}
            onChange={(e) => setKids({ ...kids, child_full_name: e.target.value })} />
          <input className="input" placeholder="ДР ребёнка YYYY-MM-DD" value={kids.child_birth_date}
            onChange={(e) => setKids({ ...kids, child_birth_date: e.target.value })} />
          <input className="input" placeholder="Имя родителя" required value={kids.parent_full_name}
            onChange={(e) => setKids({ ...kids, parent_full_name: e.target.value })} />
          <input className="input" type="email" placeholder="Email родителя" required
            value={kids.parent_email}
            onChange={(e) => setKids({ ...kids, parent_email: e.target.value })} />
          <input className="input" placeholder="Телефон родителя" value={kids.parent_phone}
            onChange={(e) => setKids({ ...kids, parent_phone: e.target.value })} />
          <input className="input" placeholder="Остаток credits (опц.)" value={kids.credits_left}
            onChange={(e) => setKids({ ...kids, credits_left: e.target.value })} />
          <select className="input md:col-span-2" value={kids.group_id}
            onChange={(e) => setKids({ ...kids, group_id: e.target.value })}>
            <option value="">Без группы</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={kids.invite}
              onChange={(e) => setKids({ ...kids, invite: e.target.checked })} />
            Инвайт родителю
          </label>
          <button className="btn btn-primary md:col-span-2" type="submit">
            Создать пару
          </button>
        </form>
      )}

      <div className="glass space-y-3 p-5">
        <h2 className="font-display text-xl">CSV импорт</h2>
        <textarea className="input min-h-24 font-mono text-xs" value={csv}
          onChange={(e) => setCsv(e.target.value)} />
        <button type="button" className="btn btn-stage" onClick={importCsv}>Импортировать</button>
      </div>

      {message ? <p className="break-all text-sm text-stage-deep">{message}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={inviteSelected}>
          Пригласить выбранных
        </button>
        {groups.map((g) => (
          <button key={g.id} type="button" className="btn btn-ghost text-sm"
            onClick={() => inviteGroup(g.id)}>
            Инвайт · {g.title}
          </button>
        ))}
      </div>

      {!students.length ? (
        <div className="glass p-8 text-center text-fog">Пока нет учеников на вкладке.</div>
      ) : (
        <ul className="glass divide-y divide-white/10">
          {students.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-start gap-3">
                <input type="checkbox" className="mt-1" checked={Boolean(selected[s.id])}
                  onChange={(e) => setSelected((m) => ({ ...m, [s.id]: e.target.checked }))} />
                <div>
                  <Link href={`/admin/students/${s.id}`} className="font-semibold underline">
                    {s.full_name}
                  </Link>
                  {s.is_minor ? <span className="text-fog"> · child</span> : null}
                  <p className="text-sm text-fog">
                    {s.email}
                    {s.credits_available != null ? ` · ${s.credits_available} cr` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="badge">{s.onboarding_status ?? "draft"}</span>
                <span className={`badge ${s.telegram_linked ? "badge-ok" : "badge-warn"}`}>
                  TG
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
