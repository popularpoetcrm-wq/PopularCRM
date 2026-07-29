"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import Link from "next/link";

type Welcome = {
  person: { full_name: string; email: string };
  onboarding_status: string;
  groups: Array<{ title: string }>;
  packages: Array<{ credits_available: number; credits_total: number }>;
  nextSession?: { title: string; starts_at: string };
  children: Array<{ full_name: string }>;
  telegram_linked: boolean;
  policy: { absentNotifyCutoffHours: number; minAttendeesToHold: number };
};

export default function WelcomePage() {
  const router = useRouter();
  const [data, setData] = useState<Welcome | null>(null);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/v1/me/onboarding");
    const json = await res.json();
    if (json.ok) setData(json.data);
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
        username: "demo_user",
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
    setBusy(true);
    const res = await fetch("/api/v1/me/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", acceptRules: true }),
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
    return <p className="text-fog">Загрузка…</p>;
  }

  const firstName = data.person.full_name.split(" ")[0];
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
          Это твой личный кабинет. По умолчанию ты на занятии — «Не приду»
          только явно, за {data.policy.absentNotifyCutoffHours}+ ч.
        </p>
      </section>

      {data.children.length ? (
        <section className="glass p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Дети</p>
          <ul className="mt-2 space-y-1">
            {data.children.map((c) => (
              <li key={c.full_name} className="font-semibold">
                {c.full_name}
              </li>
            ))}
          </ul>
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
        <p className="mt-3 text-xs text-fog">
          Если в группе останется меньше {data.policy.minAttendeesToHold} человек —
          занятие отменится.
        </p>
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
          Для напоминаний. Можно пропустить — кабинет работает и без бота.
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
                <p className="text-xs text-fog break-all">{deepLink}</p>
                <button
                  type="button"
                  className="btn btn-ghost text-sm"
                  disabled={busy}
                  onClick={confirmTelegramDemo}
                >
                  Demo: подтвердить привязку
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <label className="glass flex items-start gap-3 p-5 text-sm">
        <input type="checkbox" defaultChecked className="mt-1" readOnly />
        <span>
          Согласен с правилами студии: «Не приду» за{" "}
          {data.policy.absentNotifyCutoffHours}+ ч, иначе без отработки.
        </span>
      </label>

      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      <button
        type="button"
        className="btn btn-primary w-full"
        style={{ minHeight: 52 }}
        disabled={busy}
        onClick={finish}
      >
        {busy ? "…" : "В кабинет"}
      </button>
    </div>
  );
}
