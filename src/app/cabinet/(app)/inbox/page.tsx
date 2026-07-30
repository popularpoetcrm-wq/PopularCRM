"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CabinetLoading } from "@/components/CabinetLoading";

type Note = {
  id: string;
  template_code: string;
  text: string;
  channel: string;
  status: string;
  created_at: string;
};

export default function InboxPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v1/me/notifications");
      const json = await res.json();
      if (json.ok) setNotes(json.data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Уведомления</h1>
        <p className="text-fog">
          Оплаты, изменения расписания, отработки и важные сообщения студии.
        </p>
      </div>
      {loading ? <CabinetLoading label="Загружаем уведомления…" /> : null}
      {!loading ? (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="glass p-5">
              <p className="text-xs text-fog">
                {n.status === "sent" ? "отправлено" : "в очереди"} ·{" "}
                {new Date(n.created_at).toLocaleString("ru-RU")}
              </p>
              <p className="mt-2">{n.text}</p>
            </li>
          ))}
          {!notes.length ? (
            <li className="glass p-8 text-center text-fog">
              Новых уведомлений пока нет.
            </li>
          ) : null}
        </ul>
      ) : null}
      <Link href="/cabinet" className="btn btn-ghost">
        Назад
      </Link>
    </section>
  );
}
