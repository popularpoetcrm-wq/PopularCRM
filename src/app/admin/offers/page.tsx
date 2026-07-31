"use client";

import { useEffect, useState } from "react";

type Trial = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  venue: string;
  total_tickets: number;
  remaining: number;
  price_grosze: number;
};

function ticketsUrl() {
  return (
    process.env.NEXT_PUBLIC_TICKETS_URL ||
    "https://www.populartickets.pl"
  ).replace(/\/$/, "");
}

export default function AdminOffersPage() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const base = ticketsUrl();

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetch("/api/v1/admin/tickets-trials");
      const json = await res.json();
      setLoading(false);
      if (!json.ok) {
        setError(json.error || "Не удалось загрузить с populartickets.pl");
        return;
      }
      setTrials(json.data.trials ?? []);
    })();
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Пробные и ивенты</h1>
        <p className="mt-2 max-w-2xl text-fog">
          Создаются и продаются на{" "}
          <strong className="text-ink">populartickets.pl</strong>. На
          popularpoet.pl только витрина. В CRM их не заводим — тут только
          просмотр того, что уже есть в Tickets.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            className="btn btn-primary"
            href={`${base}/admin`}
            target="_blank"
            rel="noreferrer"
          >
            Открыть Tickets → создать
          </a>
          <a
            className="btn btn-ghost"
            href={`${base}/`}
            target="_blank"
            rel="noreferrer"
          >
            Витрина Tickets
          </a>
        </div>
      </div>

      {loading ? (
        <p className="text-fog">Тянем список с populartickets.pl…</p>
      ) : null}
      {error ? (
        <div className="glass p-5 text-sm text-warn">
          <p>{error}</p>
          <p className="mt-2 text-fog">
            Проверь CRM_CHECKOUT_SECRET и что Tickets отдаёт{" "}
            <code>/api/crm/trials</code>.
          </p>
        </div>
      ) : null}

      {!loading && !error ? (
        <ul className="space-y-3">
          {!trials.length ? (
            <li className="glass p-5 text-fog">
              На Tickets сейчас нет открытых пробных.
            </li>
          ) : (
            trials.map((t) => (
              <li
                key={t.id}
                className="glass flex flex-wrap items-center justify-between gap-3 p-5"
              >
                <div>
                  <p className="font-semibold">{t.title}</p>
                  <p className="text-sm text-fog">
                    {new Date(t.starts_at).toLocaleString("ru-RU")}
                    {t.venue ? ` · ${t.venue}` : ""}
                    {" · "}
                    {Math.round(t.price_grosze / 100)} PLN · мест{" "}
                    {t.remaining}/{t.total_tickets}
                  </p>
                </div>
                <a
                  className="btn btn-stage"
                  href={`${base}/e/${t.slug || t.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Страница на Tickets
                </a>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </section>
  );
}
