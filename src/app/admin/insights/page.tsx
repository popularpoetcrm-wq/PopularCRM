"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AdminInsights, InsightPerson } from "@/lib/admin-insights";

function money(n: number) {
  return `${n.toLocaleString("ru-RU")} PLN`;
}

function PersonRow({ p }: { p: InsightPerson }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
      <div>
        <Link href={`/admin/students/${p.id}`} className="font-semibold underline">
          {p.full_name}
        </Link>
        <p className="text-xs text-fog">
          {p.directions.join(" · ") || "—"}
          {p.groups.length ? ` · ${p.groups.slice(0, 2).join(", ")}` : ""}
        </p>
        <p className="mt-1 text-xs text-fog">{p.reason}</p>
      </div>
      <div className="text-right text-xs text-fog">
        <p>
          {p.present}/{p.total}
          {p.total ? ` · ${p.rate}%` : ""}
        </p>
        {p.ltv > 0 ? <p className="font-semibold text-ink">{money(p.ltv)}</p> : null}
        {p.debt > 0 ? <p className="text-warn">долг {money(p.debt)}</p> : null}
      </div>
    </li>
  );
}

export default function AdminInsightsPage() {
  const [data, setData] = useState<AdminInsights | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetch("/api/v1/admin/insights");
      const json = await res.json();
      setLoading(false);
      if (!json.ok) {
        setError(json.error || "Ошибка");
        return;
      }
      setData(json.data);
    })();
  }, []);

  if (loading) {
    return (
      <section className="glass p-8 text-center text-fog">Считаем сводку…</section>
    );
  }
  if (error || !data) {
    return (
      <section className="glass p-8 text-center text-warn">{error || "Нет данных"}</section>
    );
  }

  const { pulse } = data;

  return (
    <section className="space-y-8">
      <div>
        <h1 className="font-display text-3xl">Сводка</h1>
        <p className="text-fog">
          Касса, attach, риски и списки действий · вкладка бренда в шапке
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass p-5">
          <p className="text-xs uppercase tracking-wide text-fog">Выручка (paid)</p>
          <p className="mt-2 text-2xl font-semibold">{money(pulse.revenue_paid)}</p>
        </div>
        <div className="glass p-5">
          <p className="text-xs uppercase tracking-wide text-fog">Открытый долг</p>
          <p className="mt-2 text-2xl font-semibold text-warn">
            {money(pulse.debt_open)}
          </p>
          <p className="mt-1 text-xs text-fog">{pulse.debtors} чел.</p>
        </div>
        <div className="glass p-5">
          <p className="text-xs uppercase tracking-wide text-fog">Активных</p>
          <p className="mt-2 text-2xl font-semibold">{pulse.active_students}</p>
          <p className="mt-1 text-xs text-fog">
            attach {pulse.attach_pct}% ({pulse.attach_count} на 2+ направлениях)
          </p>
        </div>
        <div className="glass p-5">
          <p className="text-xs uppercase tracking-wide text-fog">Present</p>
          <p className="mt-2 text-2xl font-semibold">
            {pulse.present_rate != null ? `${pulse.present_rate}%` : "—"}
          </p>
        </div>
      </div>

      {data.advice.length ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Советы</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {data.advice.map((a) => (
              <li key={a.id} className="glass p-4">
                <p className="font-semibold">
                  {a.title}
                  {a.count ? (
                    <span className="ml-2 text-sm font-normal text-fog">
                      · {a.count}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-fog">{a.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.directions.length ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Направления</h2>
          <div className="flex flex-wrap gap-2">
            {data.directions.map((d) => (
              <span key={d.direction} className="badge">
                {d.direction}: {d.students} уч. · {d.enrollments} зачисл.
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Cross-sell</h2>
          <p className="text-sm text-fog">Импро с хорошей посещаемостью, без актёрки</p>
          {!data.cross_sell.length ? (
            <div className="glass p-5 text-fog">Пока пусто для этой вкладки.</div>
          ) : (
            <ul className="glass divide-y divide-white/10">
              {data.cross_sell.map((p) => (
                <PersonRow key={p.id} p={p} />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">Риск ухода</h2>
          <p className="text-sm text-fog">present &lt;50% при ≥5 отметках</p>
          {!data.risk.length ? (
            <div className="glass p-5 text-fog">Тихих рисков нет.</div>
          ) : (
            <ul className="glass divide-y divide-white/10">
              {data.risk.map((p) => (
                <PersonRow key={p.id} p={p} />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">Top LTV</h2>
          <p className="text-sm text-fog">Сумма amount_paid за жизнь</p>
          {!data.top_ltv.length ? (
            <div className="glass p-5 text-fog">Нет оплат по вкладке.</div>
          ) : (
            <ul className="glass divide-y divide-white/10">
              {data.top_ltv.map((p) => (
                <PersonRow key={p.id} p={p} />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">Тонкие группы</h2>
          <p className="text-sm text-fog">Ростер &lt;4</p>
          {!data.thin_groups.length ? (
            <div className="glass p-5 text-fog">Все группы нормального размера.</div>
          ) : (
            <ul className="glass divide-y divide-white/10">
              {data.thin_groups.map((g) => (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-semibold">{g.title}</p>
                    <p className="text-xs text-fog">{g.reason}</p>
                  </div>
                  <div className="text-right text-xs text-fog">
                    <p>
                      {g.roster}/{g.capacity}
                    </p>
                    {g.present_rate != null ? <p>present {g.present_rate}%</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
