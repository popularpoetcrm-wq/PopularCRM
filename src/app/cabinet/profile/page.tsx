"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Child = { id: string; full_name: string; email: string; birth_date?: string };

export default function ProfilePage() {
  const [me, setMe] = useState<{
    fullName: string;
    email: string;
    roles: string[];
    personId: string;
  } | null>(null);
  const [children, setChildren] = useState<Child[]>([]);

  useEffect(() => {
    void (async () => {
      const dash = await fetch("/api/v1/me/dashboard").then((r) => r.json());
      if (dash.ok) setMe(dash.data.me);
      const contacts = await fetch("/api/v1/contacts").then((r) => r.json());
      if (contacts.ok) setChildren(contacts.data.children ?? []);
    })();
  }, []);

  return (
    <section className="space-y-5">
      <div className="glass max-w-xl p-6">
        <h1 className="font-display text-3xl">Профиль</h1>
        <dl className="mt-6 space-y-4 text-sm">
          <div>
            <dt className="text-fog">Имя</dt>
            <dd className="text-lg font-semibold">{me?.fullName ?? "…"}</dd>
          </div>
          <div>
            <dt className="text-fog">Email</dt>
            <dd>{me?.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-fog">Роли</dt>
            <dd>{me?.roles?.join(", ") ?? "—"}</dd>
          </div>
        </dl>
      </div>

      {children.length ? (
        <div className="glass max-w-xl p-6">
          <h2 className="font-display text-2xl">Дети</h2>
          <ul className="mt-4 space-y-3">
            {children.map((c) => (
              <li key={c.id} className="flex justify-between border-b border-white/10 pb-2">
                <span className="font-semibold">{c.full_name}</span>
                <span className="text-sm text-fog">{c.birth_date ?? c.email}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-fog">
            Войди как maria@example.com чтобы увидеть привязку к Jan Nowak.
          </p>
        </div>
      ) : (
        <p className="text-sm text-fog">
          Нет привязанных детей. Demo-родитель: <code>maria@example.com</code>
        </p>
      )}

      <Link href="/cabinet" className="btn btn-ghost">
        Назад
      </Link>
    </section>
  );
}
