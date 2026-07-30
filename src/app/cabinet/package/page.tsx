"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

type Package = {
  id: string;
  status: string;
  credits_available: number;
  credits_total: number;
  expires_at?: string | null;
  activated_at?: string | null;
};

export default function PackagePage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/v1/me/dashboard")
      .then((response) => response.json())
      .then((json) => {
        if (json.ok) setPackages(json.data.packages ?? []);
        else setError(json.error);
      })
      .catch(() => setError("Не удалось загрузить абонемент"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-3xl">Абонемент</h1>
        <p className="mt-1 text-fog">
          Остаток обновляется автоматически после закрытия занятия.
        </p>
      </div>

      {packages.map((item) => (
        <article key={item.id} className="glass p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-fog">Осталось занятий</p>
              <p className="mt-1 text-4xl font-semibold">
                {item.credits_available}
                <span className="text-lg text-fog">/{item.credits_total}</span>
              </p>
            </div>
            <span className="badge badge-ok">
              {item.status === "active" ? "действует" : item.status}
            </span>
          </div>
          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-fog">Активирован</dt>
              <dd className="mt-1 font-semibold">
                {item.activated_at
                  ? format(new Date(item.activated_at), "d MMMM yyyy", {
                      locale: ru,
                    })
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-fog">Действует до</dt>
              <dd className="mt-1 font-semibold">
                {item.expires_at
                  ? format(new Date(item.expires_at), "d MMMM yyyy", {
                      locale: ru,
                    })
                  : "без указанной даты"}
              </dd>
            </div>
          </dl>
        </article>
      ))}

      {!loading && !packages.length ? (
        <div className="glass p-6 text-fog">
          Активного абонемента пока нет. Если оплата уже была, напиши студии —
          возможно, её ещё не отметили.
        </div>
      ) : null}
      {loading ? <p className="text-fog">Загрузка…</p> : null}
      {error ? <p className="text-danger">{error}</p> : null}
    </section>
  );
}
