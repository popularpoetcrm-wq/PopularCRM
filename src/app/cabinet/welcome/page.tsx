"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import Link from "next/link";
import { AvatarUpload } from "@/components/AvatarUpload";

type Child = {
  id: string;
  full_name: string;
  birth_date?: string | null;
  tshirt_size?: string | null;
};

type Welcome = {
  person: {
    id: string;
    full_name: string;
    email: string | null;
    phone?: string | null;
    birth_date?: string | null;
    tshirt_size?: string | null;
    telegram_username?: string | null;
  };
  onboarding_status: string;
  groups: Array<{ title: string }>;
  packages: Array<{ credits_available: number; credits_total: number }>;
  nextSession?: { title: string; starts_at: string };
  children: Child[];
  telegram_linked: boolean;
  policy: { absentNotifyCutoffHours: number; minAttendeesToHold: number };
};

const SIZES = ["", "XS", "S", "M", "L", "XL", "XXL"];

export default function WelcomePage() {
  const router = useRouter();
  const [data, setData] = useState<Welcome | null>(null);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [accept, setAccept] = useState(false);
  const [acceptPhoto, setAcceptPhoto] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profile, setProfile] = useState({
    full_name: "",
    phone: "",
    email: "",
    birth_date: "",
    tshirt_size: "",
    telegram_username: "",
  });
  const [childForms, setChildForms] = useState<
    Record<string, { full_name: string; birth_date: string; tshirt_size: string }>
  >({});

  async function load() {
    const res = await fetch("/api/v1/me/onboarding");
    const json = await res.json();
    if (!json.ok) {
      setMessage(json.error ?? "Ошибка");
      return;
    }
    const d = json.data as Welcome;
    setData(d);
    setProfile({
      full_name: d.person.full_name ?? "",
      phone: d.person.phone ?? "",
      email: d.person.email ?? "",
      birth_date: d.person.birth_date ?? "",
      tshirt_size: d.person.tshirt_size ?? "",
      telegram_username: (d.person.telegram_username ?? "").replace(/^@/, ""),
    });
    const kids: typeof childForms = {};
    for (const c of d.children ?? []) {
      kids[c.id] = {
        full_name: c.full_name ?? "",
        birth_date: c.birth_date ?? "",
        tshirt_size: c.tshirt_size ?? "",
      };
    }
    setChildForms(kids);
    const av = await fetch("/api/v1/me/avatar").then((r) => r.json());
    if (av.ok) setAvatarUrl(av.data.url);
  }

  useEffect(() => {
    void load();
  }, []);

  async function connectTelegram() {
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/v1/me/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "telegram-token" }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMessage(json.error);
      return;
    }
    setTgToken(json.data.token);
    setDeepLink(json.data.deepLink);
  }

  async function confirmTelegramDemo() {
    if (!tgToken) return;
    setBusy(true);
    const res = await fetch("/api/v1/me/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "telegram-confirm",
        token: tgToken,
        username: profile.telegram_username || "mikita_pl",
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMessage(json.error);
      return;
    }
    setMessage("Telegram подключён");
    setTgToken(null);
    await load();
  }

  async function finish() {
    if (!accept || !acceptPhoto) {
      setMessage("Нужно принять оферту/правила и согласие на фото");
      return;
    }
    if (profile.full_name.trim().length < 2) {
      setMessage("Укажи имя");
      return;
    }
    setBusy(true);
    const children = Object.entries(childForms).map(([id, c]) => ({
      id,
      full_name: c.full_name,
      birth_date: c.birth_date || null,
      tshirt_size: c.tshirt_size || null,
    }));
    const res = await fetch("/api/v1/me/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        acceptRules: true,
        acceptPhoto: true,
        profile: {
          full_name: profile.full_name.trim(),
          phone: profile.phone.trim() || null,
          email: profile.email.trim() || null,
          birth_date: profile.birth_date || null,
          tshirt_size: profile.tshirt_size || null,
          telegram_username: profile.telegram_username || null,
        },
        children,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMessage(json.error);
      return;
    }
    router.replace("/cabinet");
    router.refresh();
  }

  if (!data) {
    return <p className="text-fog">{message || "Загрузка…"}</p>;
  }

  const firstName = profile.full_name.split(" ")[0] || data.person.full_name.split(" ")[0];
  const pkg = data.packages[0];

  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <section className="glass glass-strong p-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-fog">
          Добро пожаловать
        </p>
        <h1 className="mt-2 font-display text-4xl">
          Привет, <span className="shine-text">{firstName}</span>
        </h1>
        <p className="mt-2 text-fog">
          Заполни профиль — это твои данные в студии. По умолчанию ты на занятии;
          «Не приду» только явно, за {data.policy.absentNotifyCutoffHours}+ ч.
        </p>
      </section>

      <section className="glass space-y-3 p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">
          Твои данные
        </p>
        <AvatarUpload url={avatarUrl} onUploaded={setAvatarUrl} />
        <label className="block text-sm">
          Имя и фамилия
          <input
            className="input mt-1"
            value={profile.full_name}
            onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
            required
          />
        </label>
        <label className="block text-sm">
          Email
          <input
            className="input mt-1"
            type="email"
            value={profile.email}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          Телефон
          <input
            className="input mt-1"
            value={profile.phone}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            placeholder="+48…"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            День рождения
            <input
              className="input mt-1"
              type="date"
              value={profile.birth_date}
              onChange={(e) => setProfile({ ...profile, birth_date: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Размер футболки
            <select
              className="input mt-1"
              value={profile.tshirt_size}
              onChange={(e) => setProfile({ ...profile, tshirt_size: e.target.value })}
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
          Telegram @username
          <input
            className="input mt-1"
            value={profile.telegram_username}
            onChange={(e) =>
              setProfile({ ...profile, telegram_username: e.target.value.replace(/^@/, "") })
            }
            placeholder="mikita_pl"
          />
        </label>
      </section>

      {data.children.length ? (
        <section className="glass space-y-4 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Дети</p>
          {data.children.map((c) => {
            const form = childForms[c.id] ?? {
              full_name: c.full_name,
              birth_date: "",
              tshirt_size: "",
            };
            return (
              <div key={c.id} className="space-y-2 border-t border-white/10 pt-3 first:border-0 first:pt-0">
                <label className="block text-sm">
                  Имя
                  <input
                    className="input mt-1"
                    value={form.full_name}
                    onChange={(e) =>
                      setChildForms({
                        ...childForms,
                        [c.id]: { ...form, full_name: e.target.value },
                      })
                    }
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    ДР
                    <input
                      className="input mt-1"
                      type="date"
                      value={form.birth_date}
                      onChange={(e) =>
                        setChildForms({
                          ...childForms,
                          [c.id]: { ...form, birth_date: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    Футболка
                    <select
                      className="input mt-1"
                      value={form.tshirt_size}
                      onChange={(e) =>
                        setChildForms({
                          ...childForms,
                          [c.id]: { ...form, tshirt_size: e.target.value },
                        })
                      }
                    >
                      {SIZES.map((s) => (
                        <option key={s || "empty"} value={s}>
                          {s || "—"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="glass p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Группа</p>
        <p className="mt-2 text-lg font-semibold">
          {data.groups.map((g) => g.title).join(", ") || "Пока без группы"}
        </p>
        {data.nextSession ? (
          <p className="mt-2 text-fog">
            Ближайшее: {data.nextSession.title} ·{" "}
            {format(new Date(data.nextSession.starts_at), "d MMM HH:mm", {
              locale: pl,
            })}
          </p>
        ) : (
          <p className="mt-2 text-fog">Ближайшее занятие появится в расписании</p>
        )}
      </section>

      <section className="glass p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Пакет</p>
        {pkg ? (
          <p className="mt-2 text-3xl font-semibold">
            {pkg.credits_available}
            <span className="text-base text-fog">/{pkg.credits_total}</span>
          </p>
        ) : (
          <p className="mt-2 text-fog">
            Пакета пока нет.{" "}
            <Link href="/cabinet/payments" className="underline">
              Оплатить
            </Link>
          </p>
        )}
      </section>

      <section className="glass p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Telegram</p>
        <p className="mt-2 text-sm text-fog">
          Для напоминаний. Username можно указать выше; привязка бота — опционально.
        </p>
        {data.telegram_linked ? (
          <span className="badge badge-ok mt-3">Подключён</span>
        ) : (
          <div className="mt-4 space-y-3">
            <button
              type="button"
              className="btn btn-stage"
              disabled={busy}
              onClick={connectTelegram}
            >
              Подключить Telegram
            </button>
            {deepLink ? (
              <div className="space-y-2 text-sm">
                <a href={deepLink} target="_blank" rel="noreferrer" className="underline">
                  Открыть бота
                </a>
                <p className="break-all text-xs text-fog">{deepLink}</p>
                <button
                  type="button"
                  className="btn btn-ghost text-sm"
                  disabled={busy}
                  onClick={confirmTelegramDemo}
                >
                  Dev: подтвердить привязку
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="glass space-y-3 p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">
          Согласия
        </p>
        <p className="text-sm text-fog">
          Полные тексты —{" "}
          <Link href="/cabinet/consents" className="underline">
            в разделе Согласия
          </Link>
          .
        </p>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
          />
          <span>
            Принимаю оферту и правила студии (v1.0). «Не приду» за{" "}
            {data.policy.absentNotifyCutoffHours}+ ч.
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={acceptPhoto}
            onChange={(e) => setAcceptPhoto(e.target.checked)}
          />
          <span>
            Согласен на фото/видео с занятий для соцсетей студии (инста и т.п.).
          </span>
        </label>
      </section>

      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      <button
        type="button"
        className="btn btn-primary w-full"
        style={{ minHeight: 52 }}
        disabled={busy}
        onClick={finish}
      >
        {busy ? "…" : "Сохранить и в кабинет"}
      </button>
    </div>
  );
}
