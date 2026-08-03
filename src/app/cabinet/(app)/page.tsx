"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CabinetLoading } from "@/components/CabinetLoading";
import { STUDIO_POLICY } from "@/lib/studio-policy";

type Dash = {
  me: { fullName: string };
  brandName?: string;
  packages: Array<{ credits_available: number; credits_total: number; expires_at: string }>;
  makeups: Array<{ status: string }>;
  payments: Array<{ status: string; brand_id?: string }>;
  schedule: Array<{
    id: string;
    group_id?: string;
    title: string;
    starts_at: string;
    status: string;
    myStatus?: string | null;
  }>;
  children?: Array<{ id: string; full_name: string }>;
  groups?: Array<{
    id: string;
    title: string;
    subtitle?: string;
    direction_label?: string | null;
    schedule_label?: string | null;
  }>;
  money?: {
    label: string;
    debt_open: number;
    credits_left: number | null;
    last_paid_at?: string | null;
    last_paid_amount?: number | null;
  };
  attendance_note?: {
    message: string;
    present: number;
    total: number;
    rate: number;
  } | null;
};

type Recommendation = {
  id: string;
  title: string;
  starts_at: string;
  venue: string;
  remaining: number;
  reason: string;
  href: string;
};

export default function CabinetHome() {
  const [data, setData] = useState<Dash | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [now] = useState(() => Date.now());

  async function load() {
    const res = await fetch("/api/v1/me/dashboard");
    const json = await res.json();
    if (json.ok) setData(json.data);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    async function loadRecommendations() {
      try {
        const res = await fetch("/api/v1/me/recommendations");
        const json = await res.json();
        if (json.ok) setRecommendations(json.data.recommendations ?? []);
      } catch {
        // This is a pleasant extra; the core cabinet must remain quiet if Tickets is offline.
      }
    }
    void loadRecommendations();
  }, []);

  const pkg = data?.packages?.[0];
  const makeups = (data?.makeups ?? []).filter((m) => m.status === "available").length;
  const debt = (data?.payments ?? []).filter((p) =>
    ["pending", "partial"].includes(p.status),
  ).length;
  const next = [...(data?.schedule ?? [])]
    .filter((s) => s.status === "scheduled" && new Date(s.starts_at).getTime() >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const skipped =
    next &&
    (next.myStatus === "absent_notified" || next.myStatus === "absent");
  const canSkip =
    next &&
    !skipped &&
    new Date(next.starts_at).getTime() - now >=
      STUDIO_POLICY.absentNotifyCutoffHours * 60 * 60 * 1000;

  async function cantAttend() {
    if (!next) return;
    if (!confirm(`Перенести «${next.title}»? После этого появится отработка, на которую можно выбрать новую дату.`)) return;
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/v1/me/cant-attend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: next.id,
        studentPersonId: (next as { forStudentId?: string }).forStudentId,
      }),
    });
    const json = await res.json();
    setBusy(false);
    setMsg(json.ok ? json.data.message : json.error);
    await load();
  }

  if (!data) {
    return <CabinetLoading label="Загружаем кабинет…" />;
  }

  const firstName = data.me.fullName.split(" ")[0];

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <section className="glass glass-strong p-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-fog">Личный кабинет</p>
        <h1 className="mt-2 font-display text-4xl">
          Привет, <span className="shine-text">{firstName}</span>
        </h1>
        <p className="mt-2 text-fog">
          {(data.children?.length ?? 0) > 0
            ? "Кабинет родителя: расписание → перенос занятия → отработка → оплата → фактура."
            : `Цикл: занятия → перенос заранее (≥${STUDIO_POLICY.absentNotifyCutoffHours} ч) → отработка → оплата абонемента → фактура.`}
        </p>
      </section>

      {data.children?.length ? (
        <section className="glass p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Дети</p>
          <ul className="mt-2 space-y-1">
            {data.children.map((c) => (
              <li key={c.id} className="font-semibold">
                {c.full_name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.groups?.length ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Мои группы</h2>
          <ul className="space-y-2">
            {data.groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/cabinet/schedule?group=${encodeURIComponent(g.id)}`}
                  className="glass block p-4 transition hover:bg-white/10"
                >
                <p className="font-semibold">{g.title}</p>
                <p className="mt-1 text-sm text-fog">
                  {g.subtitle && g.subtitle !== g.title
                    ? g.subtitle
                    : [g.direction_label, g.schedule_label].filter(Boolean).join(" · ") ||
                      "Расписание уточняется"}
                </p>
                {(() => {
                  const groupNext = [...(data.schedule ?? [])]
                    .filter(
                      (session) =>
                        session.group_id === g.id &&
                        session.status === "scheduled" &&
                        new Date(session.starts_at).getTime() >= now,
                    )
                    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
                  return groupNext ? (
                    <p className="mt-3 text-sm text-stage-deep">
                      Следующее: {format(new Date(groupNext.starts_at), "d MMMM · HH:mm", {
                        locale: ru,
                      })} →
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-stage-deep">Открыть расписание →</p>
                  );
                })()}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recommendations.length ? (
        <section className="glass p-5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">
            Можно попробовать ещё
          </p>
          <h2 className="mt-2 font-display text-2xl">Новый навык — без обязательств</h2>
          <p className="mt-2 max-w-2xl text-sm text-fog">
            Это не обязательное предложение: мы показываем только ближайшие пробные с живыми местами из PopularTickets.
          </p>
          <div className="mt-4 grid gap-3">
            {recommendations.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-white/15 bg-white/5 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold">{item.title}</p>
                    <p className="mt-1 text-sm text-fog">
                      {format(new Date(item.starts_at), "EEEE, d MMMM · HH:mm", {
                        locale: ru,
                      })}
                      {item.venue ? ` · ${item.venue}` : ""}
                      {` · мест: ${item.remaining}`}
                    </p>
                    <p className="mt-2 text-sm text-fog">{item.reason}</p>
                  </div>
                  <a
                    href={item.href}
                    className="btn btn-stage w-full shrink-0 sm:w-auto"
                    target={item.href.startsWith("http") ? "_blank" : undefined}
                    rel={item.href.startsWith("http") ? "noreferrer" : undefined}
                  >
                    Смотреть пробное →
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {next ? (
        <section className="glass p-5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Ближайшее занятие</p>
          <h2 className="mt-2 font-display text-2xl sm:text-3xl">{next.title}</h2>
          <p className="mt-1 text-fog">
            {format(new Date(next.starts_at), "EEEE, d MMMM · HH:mm", { locale: ru })}
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {skipped ? (
              <div className="badge badge-warn self-center justify-center py-3">
                Не приду · отработка создана
              </div>
            ) : (
              <button
                type="button"
                className="btn w-full text-base"
                style={{
                  background: "color-mix(in oklab, var(--danger) 88%, black)",
                  color: "#fff",
                  minHeight: 52,
                }}
                disabled={!canSkip || busy}
                onClick={cantAttend}
              >
                {busy ? "Сохраняем…" : canSkip ? "Перенести занятие" : "Уже поздно переносить"}
              </button>
            )}
            <Link
              href="/cabinet/makeups"
              className="btn btn-stage w-full text-base"
              style={{ minHeight: 52 }}
            >
              Отработки {makeups ? `(${makeups})` : ""}
            </Link>
          </div>
          <p className="mt-3 text-xs text-fog">
            Если людей окажется слишком мало, студия предупредит об отмене.
          </p>
          {msg ? <p className="mt-3 text-sm text-stage-deep">{msg}</p> : null}
        </section>
      ) : null}

      {data.attendance_note ? (
        <section className="glass p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">
            Посещаемость
          </p>
          <p className="mt-2 text-base leading-relaxed">{data.attendance_note.message}</p>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/cabinet/package" className="glass block p-5 transition hover:bg-white/10">
          <p className="text-sm text-fog">Пакет</p>
          <p className="mt-2 text-3xl font-semibold">
            {pkg ? (
              <>
                {pkg.credits_available}
                <span className="text-base text-fog">/{pkg.credits_total}</span>
              </>
            ) : (
              "—"
            )}
          </p>
          <p className="mt-1 text-xs text-fog">осталось занятий</p>
        </Link>
        <Link href="/cabinet/payments" className="glass block p-5 transition hover:bg-white/10">
          <p className="text-sm text-fog">Оплата</p>
          <p className="mt-2 text-xl font-semibold">
            {data.money?.debt_open ? (
              <span className="text-warn">{data.money.debt_open} PLN</span>
            ) : (
              <span className="text-ok">всё ок</span>
            )}
          </p>
          <p className="mt-1 text-xs text-fog">{data.money?.label ?? (debt ? "есть долг" : "всё оплачено")}</p>
        </Link>
      </div>

      <nav className="grid grid-cols-2 gap-2">
        {[
          { href: "/cabinet/makeups", label: "Отработки" },
          { href: "/cabinet/consents", label: "Согласия" },
          { href: "/cabinet/invoices", label: "Фактуры" },
          { href: "/cabinet/profile", label: "Профиль и фото" },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="btn btn-ghost w-full text-sm">
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
