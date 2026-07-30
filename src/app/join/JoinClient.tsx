"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Group = { id: string; title: string; direction?: string | null; brand_id?: string };
type Person = {
  id: string;
  full_name: string;
  has_email: boolean;
  birth_md: string | null;
  requires_birth?: boolean;
  is_minor: boolean;
};

export default function JoinClient() {
  const sp = useSearchParams();
  const presetGroup = sp.get("group") ?? "";
  const brand = sp.get("brand") ?? "poet";

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState(presetGroup);
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState("");
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");
  const [birth, setBirth] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/v1/join/groups?brand=${encodeURIComponent(brand)}`);
      const json = await res.json();
      if (json.ok) {
        setGroups(json.data.groups ?? []);
        if (presetGroup) setGroupId(presetGroup);
      }
    })();
  }, [brand, presetGroup]);

  useEffect(() => {
    if (!groupId) {
      setPeople([]);
      return;
    }
    void (async () => {
      const res = await fetch(`/api/v1/join/people?groupId=${encodeURIComponent(groupId)}`);
      const json = await res.json();
      if (json.ok) setPeople(json.data.people ?? []);
      else setMsg(json.error);
    })();
  }, [groupId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return people;
    return people.filter((p) => p.full_name.toLowerCase().includes(s));
  }, [people, q]);

  const selected = people.find((p) => p.id === personId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!personId) return setMsg("Выбери себя в списке");
    if (!birth.trim()) return setMsg("Укажи дату рождения для проверки");
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/v1/join/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId,
        email,
        phone: phone || null,
        telegram_username: telegram || null,
        birth_date: birth,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMsg(json.error);
      return;
    }
    setMsg(
      json.data.message ||
        (json.data.emailed
          ? "Готово — ссылка входа на почте."
          : "Контакты сохранены. Напиши студии за ссылкой входа."),
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 py-10">
      <Link href="/" className="font-display text-2xl">
        Popular
      </Link>
      <section className="glass mt-6 space-y-4 p-6">
        <h1 className="font-display text-3xl">Это я</h1>
        <p className="text-sm text-fog">
          Найди себя в группе, подтверди день рождения и оставь email. Ссылка
          входа придёт на почту — в ответе API её больше нет.
        </p>

        <label className="block text-sm">
          Группа
          <select
            className="input mt-1"
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              setPersonId("");
            }}
          >
            <option value="">Выбери группу</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>

        {groupId ? (
          <>
            <label className="block text-sm">
              Поиск по имени
              <input
                className="input mt-1"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Начни вводить…"
              />
            </label>
            <div className="max-h-56 overflow-auto rounded-lg border border-white/10">
              {!filtered.length ? (
                <p className="p-4 text-sm text-fog">
                  Нет доступных профилей (нужна ДР в базе и ещё нет email). Войди
                  через{" "}
                  <Link href="/login" className="underline">
                    /login
                  </Link>
                  .
                </p>
              ) : (
                <ul>
                  {filtered.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5 ${
                          personId === p.id ? "bg-white/10" : ""
                        }`}
                        onClick={() => setPersonId(p.id)}
                      >
                        <span className="font-semibold">{p.full_name}</span>
                        {p.is_minor ? (
                          <span className="text-xs text-fog">ребёнок</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}

        {selected ? (
          <form onSubmit={submit} className="space-y-3 border-t border-white/10 pt-4">
            <p className="text-sm">
              Выбрано: <strong>{selected.full_name}</strong>
              {selected.is_minor ? " (укажи email родителя)" : null}
            </p>
            <label className="block text-sm">
              Email *
              <input
                className="input mt-1"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Телефон
              <input
                className="input mt-1"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+48…"
              />
            </label>
            <label className="block text-sm">
              Telegram @
              <input
                className="input mt-1"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value.replace(/^@/, ""))}
                placeholder="username"
              />
            </label>
            <label className="block text-sm">
              День рождения (мм-дд) *
              <input
                className="input mt-1"
                value={birth}
                onChange={(e) => setBirth(e.target.value)}
                placeholder={selected.birth_md ?? "MM-DD"}
                required
              />
            </label>
            <button className="btn btn-primary w-full" disabled={busy} type="submit">
              {busy ? "…" : "Получить ссылку на email"}
            </button>
          </form>
        ) : null}

        {msg ? <p className="text-sm text-stage-deep">{msg}</p> : null}
        {msg && !busy ? (
          <p className="text-sm text-fog">
            Дальше:{" "}
            <Link href="/login" className="underline">
              /login
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
