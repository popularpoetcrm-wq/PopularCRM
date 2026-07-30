"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

type Doc = {
  key: string;
  title: string;
  version: string;
  body: string;
  accepted: boolean;
  accepted_at?: string | null;
  needs_accept: boolean;
};

export default function ConsentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v1/me/consents");
    const json = await res.json();
    if (!json.ok) {
      setMessage(json.error ?? "Ошибка");
      return;
    }
    setDocs(json.data.docs ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function accept() {
    const keys = docs.filter((d) => checks[d.key] || d.accepted).map((d) => d.key);
    const missing = docs.filter((d) => d.needs_accept && !checks[d.key]);
    if (missing.length) {
      setMessage("Отметь оба документа");
      return;
    }
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/v1/me/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMessage(json.error);
      return;
    }
    setMessage("Согласия сохранены");
    setDocs(json.data.docs);
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-3xl">Согласия</h1>
        <p className="text-fog">
          Правила студии и отдельное разрешение на публикацию фото и видео с
          занятий.
        </p>
      </div>

      {docs.map((d) => (
        <article key={d.key} className="glass space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{d.title}</p>
              <p className="text-xs text-fog">
                v{d.version}
                {d.accepted && d.accepted_at
                  ? ` · принято ${format(new Date(d.accepted_at), "d MMM yyyy", { locale: ru })}`
                  : " · не принято"}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost text-sm"
              onClick={() => setOpen(open === d.key ? null : d.key)}
            >
              {open === d.key ? "Скрыть текст" : "Читать"}
            </button>
          </div>
          {open === d.key ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs leading-relaxed text-fog">
              {d.body}
            </pre>
          ) : null}
          {d.needs_accept ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!checks[d.key]}
                onChange={(e) =>
                  setChecks((c) => ({ ...c, [d.key]: e.target.checked }))
                }
              />
              <span>Принимаю «{d.title}» (v{d.version})</span>
            </label>
          ) : (
            <p className="text-sm text-stage-deep">Актуальная версия принята</p>
          )}
        </article>
      ))}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || docs.every((d) => !d.needs_accept)}
          onClick={accept}
        >
          Сохранить согласия
        </button>
        <Link href="/cabinet/profile" className="btn btn-ghost">
          В профиль
        </Link>
      </div>
      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}
    </section>
  );
}
