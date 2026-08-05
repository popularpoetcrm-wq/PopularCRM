"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBirthDay } from "@/lib/format-date";
import { AvatarUpload } from "@/components/AvatarUpload";
import { CabinetLoading } from "@/components/CabinetLoading";

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
  invoice_street?: string;
  invoice_post_code?: string;
  invoice_city?: string;
  invoice_country?: string;
  invoice_nip?: string;
  invoice_company_name?: string;
  billing_complete?: boolean;
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
  invoice_street: string;
  invoice_post_code: string;
  invoice_city: string;
  invoice_country: string;
  invoice_nip: string;
  invoice_company_name: string;
};

const emptyForm: ProfileForm = {
  full_name: "",
  email: "",
  phone: "",
  birth_date: "",
  tshirt_size: "",
  telegram_username: "",
  invoice_street: "",
  invoice_post_code: "",
  invoice_city: "",
  invoice_country: "PL",
  invoice_nip: "",
  invoice_company_name: "",
};

export default function ProfilePage() {
  const [person, setPerson] = useState<Person | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [children, setChildren] = useState<Child[]>([]);
  const [parents, setParents] = useState<Person[]>([]);
  const [groups, setGroups] = useState<
    Array<{
      id: string;
      title: string;
      subtitle?: string;
      schedule_label?: string | null;
    }>
  >([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
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
      setLoading(false);
      return;
    }
    const p = json.data.person as Person & { avatar_url?: string | null };
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
      invoice_street: p.invoice_street ?? "",
      invoice_post_code: p.invoice_post_code ?? "",
      invoice_city: p.invoice_city ?? "",
      invoice_country: p.invoice_country || "PL",
      invoice_nip: p.invoice_nip ?? "",
      invoice_company_name: p.invoice_company_name ?? "",
    });
    const avJson = await av.json();
    const fromApi = avJson.ok ? avJson.data.url : null;
    setAvatarUrl(fromApi ?? p.avatar_url ?? null);
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
    setLoading(false);
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
        invoice_street: form.invoice_street.trim() || null,
        invoice_post_code: form.invoice_post_code.trim() || null,
        invoice_city: form.invoice_city.trim() || null,
        invoice_country: form.invoice_country.trim() || "PL",
        invoice_nip: form.invoice_nip.trim() || null,
        invoice_company_name: form.invoice_company_name.trim() || null,
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
      {loading ? <CabinetLoading label="Загружаем профиль…" /> : null}
      {!loading ? (
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

        <div className="border-t border-white/10 pt-4">
          <h2 className="font-display text-xl">Данные для фактуры</h2>
          <p className="mt-1 text-sm text-fog">
            Адрес покупателя на фактуре. Без улицы, индекса и города фактуру
            выставить нельзя.
            {person?.billing_complete ? (
              <span className="ml-1 text-stage-deep">Заполнено.</span>
            ) : (
              <span className="ml-1 text-warn">Нужно заполнить.</span>
            )}
          </p>
          <label className="mt-3 block text-sm">
            Улица и номер
            <input
              className="input mt-1"
              value={form.invoice_street}
              onChange={(e) => setForm({ ...form, invoice_street: e.target.value })}
              placeholder="ul. Przykładowa 1/2"
              required
            />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              Индекс
              <input
                className="input mt-1"
                value={form.invoice_post_code}
                onChange={(e) =>
                  setForm({ ...form, invoice_post_code: e.target.value })
                }
                placeholder="00-001"
                required
              />
            </label>
            <label className="block text-sm">
              Город
              <input
                className="input mt-1"
                value={form.invoice_city}
                onChange={(e) => setForm({ ...form, invoice_city: e.target.value })}
                placeholder="Warszawa"
                required
              />
            </label>
            <label className="block text-sm">
              Страна
              <input
                className="input mt-1"
                value={form.invoice_country}
                onChange={(e) =>
                  setForm({ ...form, invoice_country: e.target.value })
                }
                placeholder="PL"
              />
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Компания (если фирма)
              <input
                className="input mt-1"
                value={form.invoice_company_name}
                onChange={(e) =>
                  setForm({ ...form, invoice_company_name: e.target.value })
                }
              />
            </label>
            <label className="block text-sm">
              NIP (если фирма)
              <input
                className="input mt-1"
                value={form.invoice_nip}
                onChange={(e) => setForm({ ...form, invoice_nip: e.target.value })}
              />
            </label>
          </div>
        </div>

        {message ? <p className="text-sm text-stage-deep">{message}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : "Сохранить"}
        </button>
      </form>
      ) : null}

      {!loading && groups.length ? (
        <section className="glass max-w-xl p-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Мои группы</p>
          <p className="mt-2 text-sm text-fog">
            Открой группу, чтобы увидеть только её расписание и перенести нужные занятия.
          </p>
          <ul className="mt-4 space-y-2">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/cabinet/schedule?group=${encodeURIComponent(group.id)}`}
                  className="card-quiet block p-4 transition hover:bg-white/10"
                >
                  <p className="font-semibold">{group.title}</p>
                  <p className="mt-1 text-sm text-fog">
                    {group.subtitle && group.subtitle !== group.title
                      ? group.subtitle
                      : group.schedule_label || "Расписание"}
                  </p>
                  <p className="mt-3 text-sm text-stage-deep">Открыть группу →</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!loading && parents.length ? (
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

      {!loading && children.length ? (
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

      {!loading ? (
      <div className="glass max-w-xl space-y-2 p-6">
        <h2 className="font-display text-2xl">Согласия</h2>
        <p className="text-sm text-fog">{consentSummary || "—"}</p>
        <Link href="/cabinet/consents" className="btn btn-ghost text-sm">
          Открыть / обновить
        </Link>
      </div>
      ) : null}

      <Link href="/cabinet" className="btn btn-ghost">
        Назад
      </Link>
    </section>
  );
}
