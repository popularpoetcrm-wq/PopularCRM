"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBirthDay } from "@/lib/format-date";
import { AvatarUpload } from "@/components/AvatarUpload";

type Person = {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  tshirt_size?: string | null;
  telegram_username?: string | null;
  telegram_linked?: boolean;
  roles?: string[];
  is_minor?: boolean;
  onboarding_status?: string;
};

type Child = Person & { id: string };

const SIZES = ["", "XS", "S", "M", "L", "XL", "XXL"];

type ProfileForm = {
  full_name: string;
  email: string;
  phone: string;
  birth_date: string;
  tshirt_size: string;
  telegram_username: string;
};

const emptyForm: ProfileForm = {
  full_name: "",
  email: "",
  phone: "",
  birth_date: "",
  tshirt_size: "",
  telegram_username: "",
};

export default function ProfilePage() {
  const [person, setPerson] = useState<Person | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [children, setChildren] = useState<Child[]>([]);
  const [parents, setParents] = useState<Person[]>([]);
  const [groups, setGroups] = useState<Array<{ title: string }>>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [consentSummary, setConsentSummary] = useState<string>("");

  async function load() {
    const [res, av, cons] = await Promise.all([
      fetch("/api/v1/me/profile"),
      fetch("/api/v1/me/avatar"),
      fetch("/api/v1/me/consents"),
    ]);
    const json = await res.json();
    if (!json.ok) {
      setMessage(json.error ?? "Ошибка");
      return;
    }
    const p = json.data.person as Person;
    setPerson(p);
    setChildren(json.data.children ?? []);
    setParents(json.data.parents ?? []);
    setGroups(json.data.groups ?? []);
    setForm({
      full_name: p.full_name ?? "",
      email: p.email ?? "",
      phone: p.phone ?? "",
      birth_date: p.birth_date ?? "",
      tshirt_size: p.tshirt_size ?? "",
      telegram_username: (p.telegram_username ?? "").replace(/^@/, ""),
    });
    const avJson = await av.json();
    if (avJson.ok) setAvatarUrl(avJson.data.url);
    const cJson = await cons.json();
    if (cJson.ok) {
      const docs = cJson.data.docs as Array<{
        title: string;
        accepted: boolean;
        version: string;
        accepted_at?: string | null;
      }>;
      setConsentSummary(
        docs
          .map((d) =>
            d.accepted
              ? `${d.title}: v${d.version} ок`
              : `${d.title}: не принято`,
          )
          .join(" · "),
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        birth_date: form.birth_date || null,
        tshirt_size: form.tshirt_size || null,
        telegram_username: form.telegram_username || null,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMessage(json.error);
      return;
    }
    setMessage("Сохранено");
    await load();
  }

  return (
    <section className="space-y-5">
      <form onSubmit={save} className="glass max-w-xl space-y-4 p-6">
        <h1 className="font-display text-3xl">Профиль</h1>
        <p className="text-sm text-fog">
          Данные, которые ты заполнил при онбординге. Можно обновить.
        </p>
        <AvatarUpload url={avatarUrl} onUploaded={setAvatarUrl} />

        <label className="block text-sm">
          Имя и фамилия
          <input
            className="input mt-1"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
          />
        </label>
        <label className="block text-sm">
          Email
          <input
            className="input mt-1"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          Телефон
          <input
            className="input mt-1"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            День рождения
            <input
              className="input mt-1"
              type="date"
              value={form.birth_date}
              onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
            />
            <span className="mt-1 block text-xs text-fog">
              В списках: {formatBirthDay(form.birth_date || null)}
            </span>
          </label>
          <label className="block text-sm">
            Футболка
            <select
              className="input mt-1"
              value={form.tshirt_size}
              onChange={(e) => setForm({ ...form, tshirt_size: e.target.value })}
            >
              {SIZES.map((s) => (
                <option key={s || "empty"} value={s}>
                  {s || "—"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          Telegram
          <input
            className="input mt-1"
            value={form.telegram_username}
            onChange={(e) =>
              setForm({ ...form, telegram_username: e.target.value.replace(/^@/, "") })
            }
            placeholder="username"
          />
          <span className="mt-1 block text-xs text-fog">
            {person?.telegram_linked ? "Бот привязан" : "Бот ещё не привязан"}
            {person?.roles?.length ? ` · роли: ${person.roles.join(", ")}` : ""}
          </span>
        </label>

        {groups.length ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-fog">Группы</p>
            <p className="mt-1 font-semibold">
              {groups.map((g) => g.title).join(", ")}
            </p>
          </div>
        ) : null}

        {message ? <p className="text-sm text-stage-deep">{message}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : "Сохранить"}
        </button>
      </form>

      {parents.length ? (
        <div className="glass max-w-xl p-6">
          <h2 className="font-display text-2xl">Родители / контакты</h2>
          <ul className="mt-4 space-y-3">
            {parents.map((p) => (
              <li key={String(p.id)} className="border-b border-white/10 pb-2 text-sm">
                <p className="font-semibold">{p.full_name}</p>
                <p className="text-fog">
                  {[p.email, p.phone, p.telegram_username ? `@${p.telegram_username}` : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {children.length ? (
        <div className="glass max-w-xl p-6">
          <h2 className="font-display text-2xl">Дети</h2>
          <ul className="mt-4 space-y-3">
            {children.map((c) => (
              <li key={c.id} className="border-b border-white/10 pb-2">
                <p className="font-semibold">{c.full_name}</p>
                <p className="text-sm text-fog">
                  {[
                    c.birth_date ? `ДР ${formatBirthDay(c.birth_date)}` : null,
                    c.tshirt_size ? `футболка ${c.tshirt_size}` : null,
                    c.email,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Нет доп. данных"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="glass max-w-xl space-y-2 p-6">
        <h2 className="font-display text-2xl">Согласия</h2>
        <p className="text-sm text-fog">{consentSummary || "Загрузка…"}</p>
        <Link href="/cabinet/consents" className="btn btn-ghost text-sm">
          Открыть / обновить
        </Link>
      </div>

      <Link href="/cabinet" className="btn btn-ghost">
        Назад
      </Link>
    </section>
  );
}
