"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Note = {
  id: string;
  template_code: string;
  text: string;
  channel: string;
  created_at: string;
};

export default function InboxPage() {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v1/demo/jobs");
      const json = await res.json();
      if (json.ok) setNotes(json.data.notifications ?? []);
    })();
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Входящие</h1>
        <p className="text-fog">Локальный inbox вместо Telegram (пока без ключей)</p>
      </div>
      <ul className="space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="glass p-5">
            <p className="text-xs text-fog">
              {n.channel} · {n.template_code} · {new Date(n.created_at).toLocaleString()}
            </p>
            <p className="mt-2">{n.text}</p>
          </li>
        ))}
        {!notes.length ? (
          <li className="glass p-8 text-center text-fog">
            Пусто. Отметь пропуск или сделай оплату — появятся сообщения.
          </li>
        ) : null}
      </ul>
      <Link href="/cabinet" className="btn btn-ghost">
        Назад
      </Link>
    </section>
  );
}
