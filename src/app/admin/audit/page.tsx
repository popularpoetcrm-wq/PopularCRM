"use client";

import { useEffect, useState } from "react";

type Audit = {
  id: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  actor?: string;
  created_at: string;
};

type Note = {
  id: string;
  template_code: string;
  text: string;
  channel: string;
  status: string;
  created_at: string;
};

export default function AdminAuditPage() {
  const [audit, setAudit] = useState<Audit[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  async function load() {
    const res = await fetch("/api/v1/admin/audit");
    const json = await res.json();
    if (json.ok) {
      setAudit(json.data.audit ?? []);
      setNotes(json.data.notifications ?? []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">История действий</h1>
          <p className="text-fog">
            Изменения в CRM и состояние отправленных уведомлений.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={load}>
          Обновить
        </button>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="glass p-5">
          <h2 className="font-display text-xl">Действия</h2>
          <ul className="mt-4 max-h-[28rem] space-y-3 overflow-auto text-sm">
            {audit.map((a) => (
              <li key={a.id} className="border-b border-white/10 pb-2">
                <p className="text-xs text-fog">
                  {new Date(a.created_at).toLocaleString("ru-RU")}
                </p>
                <p className="font-semibold">{a.action}</p>
                <p className="text-fog">
                  {a.entity_type} {a.entity_id ?? ""} · {a.actor}
                </p>
              </li>
            ))}
            {!audit.length ? <li className="text-fog">Пока пусто — сделай действие в админке.</li> : null}
          </ul>
        </div>
        <div className="glass p-5">
          <h2 className="font-display text-xl">Уведомления</h2>
          <ul className="mt-4 max-h-[28rem] space-y-3 overflow-auto text-sm">
            {notes.map((n) => (
              <li key={n.id} className="border-b border-white/10 pb-2">
                <p className="font-mono text-xs text-fog">
                  {n.channel} · {n.template_code}
                </p>
                <p>{n.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
