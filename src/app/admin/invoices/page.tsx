"use client";

import { useEffect, useState } from "react";

type Invoice = {
  id: string;
  status: string;
  invoice_number?: string | null;
  pdf_url?: string | null;
  error_message?: string | null;
  payments?: {
    amount?: number;
    currency?: string;
    description?: string | null;
  } | null;
  persons?: { full_name?: string } | null;
};

const STATUS: Record<string, string> = {
  requested: "запрошена",
  queued: "в очереди",
  sent_to_saldeo: "отправлена в Saldeo",
  issued: "готова",
  failed: "ошибка",
  cancelled: "отменена",
};

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v1/admin/invoices");
    const json = await res.json();
    if (json.ok) setInvoices(json.data ?? []);
    else setMessage(json.error);
  }

  useEffect(() => {
    void load();
  }, []);

  async function retry(invoiceId: string) {
    setBusyId(invoiceId);
    setMessage("");
    const res = await fetch("/api/v1/admin/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId }),
    });
    const json = await res.json();
    setBusyId(null);
    setMessage(
      json.ok ? "Фактура отправлена в Saldeo" : json.error,
    );
    await load();
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-3xl">Фактуры</h1>
        <p className="mt-1 text-fog">
          Очередь Saldeo, готовые документы и ошибки, требующие внимания.
        </p>
      </div>
      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}
      <ul className="space-y-3">
        {invoices.map((invoice) => (
          <li
            key={invoice.id}
            className="card-quiet flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold">
                {invoice.invoice_number ||
                  invoice.persons?.full_name ||
                  "Фактура"}
              </p>
              <p className="mt-1 text-sm text-fog">
                {invoice.payments?.description || "Начисление"}
                {invoice.payments?.amount
                  ? ` · ${invoice.payments.amount} ${invoice.payments.currency || "PLN"}`
                  : ""}
              </p>
              <span
                className={`badge mt-2 ${
                  invoice.status === "failed"
                    ? "badge-danger"
                    : invoice.status === "issued" ||
                        invoice.status === "sent_to_saldeo"
                      ? "badge-ok"
                      : ""
                }`}
              >
                {STATUS[invoice.status] ?? invoice.status}
              </span>
              {invoice.error_message ? (
                <p className="mt-2 break-words text-xs text-danger">
                  {invoice.error_message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {invoice.pdf_url ? (
                <a
                  className="btn btn-ghost text-sm"
                  href={invoice.pdf_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть PDF
                </a>
              ) : null}
              {["failed", "queued", "requested"].includes(invoice.status) ? (
                <button
                  type="button"
                  className="btn btn-stage text-sm"
                  disabled={busyId === invoice.id}
                  onClick={() => retry(invoice.id)}
                >
                  {busyId === invoice.id ? "Отправляем…" : "Отправить снова"}
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {!invoices.length ? (
          <li className="glass p-6 text-center text-fog">
            Фактур пока нет.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
