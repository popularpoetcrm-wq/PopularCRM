"use client";

import { useEffect, useState } from "react";

type Payment = { id: string; description: string; status: string; amount: number };
type Invoice = {
  id: string;
  payment_id: string;
  status: string;
  invoice_number?: string;
  pdf_url?: string;
};

const INVOICE_STATUS: Record<string, string> = {
  requested: "запрошена",
  queued: "в очереди",
  sent_to_saldeo: "отправлена в Saldeo",
  issued: "готова",
  failed: "ошибка",
  cancelled: "отменена",
};

const PAYMENT_STATUS: Record<string, string> = {
  pending: "ждём оплату",
  partial: "оплачено частично",
  paid: "оплачено",
};

export default function InvoicesPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [message, setMessage] = useState("");
  const [nip, setNip] = useState("");
  const [companyName, setCompanyName] = useState("");

  async function load() {
    const res = await fetch("/api/v1/me/dashboard");
    const json = await res.json();
    if (json.ok) {
      setPayments(
        (json.data.payments ?? []).filter((p: Payment) =>
          ["pending", "paid", "partial"].includes(p.status),
        ),
      );
      setInvoices(json.data.invoices ?? []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function requestInvoice(paymentId: string) {
    setMessage("");
    const res = await fetch("/api/v1/invoices/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentId,
        buyerType: companyName || nip ? "company" : "person",
        companyName: companyName || undefined,
        nip: nip || undefined,
      }),
    });
    const json = await res.json();
    setMessage(
      json.ok
        ? json.data.invoice_number
          ? `Фактура ${json.data.invoice_number} готова`
          : "Фактура поставлена в очередь"
        : json.error,
    );
    await load();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Фактуры</h1>
        <p className="text-fog">
          Выбери начисление — фактура будет создана в Saldeo.
        </p>
      </div>

      <div className="card-quiet grid gap-3 p-5 md:grid-cols-2">
        <label className="text-sm font-semibold">
          Компания (необязательно)
          <input className="input mt-2" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          NIP
          <input className="input mt-2" value={nip} onChange={(e) => setNip(e.target.value)} />
        </label>
      </div>

      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      <div className="space-y-3">
        <h2 className="font-display text-xl">Начисления</h2>
        {payments
          .filter((payment) =>
            !invoices.some(
              (invoice) =>
                invoice.payment_id === payment.id &&
                invoice.status !== "cancelled",
            ),
          )
          .map((p) => (
          <div key={p.id} className="card-quiet flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-semibold">{p.description}</p>
              <p className="text-sm text-fog">
                {p.amount} PLN · {PAYMENT_STATUS[p.status] ?? p.status}
              </p>
            </div>
            <button className="btn btn-stage" onClick={() => requestInvoice(p.id)}>
              Выставить фактуру
            </button>
          </div>
          ))}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl">История</h2>
        {invoices.map((i) => (
          <div key={i.id} className="card-quiet flex items-center justify-between p-5">
            <div>
              <p className="font-semibold">{i.invoice_number ?? i.id}</p>
              <p className="text-sm text-fog">
                {INVOICE_STATUS[i.status] ?? i.status}
              </p>
            </div>
            {i.pdf_url ? (
              <a className="btn btn-ghost" href={i.pdf_url}>
                PDF
              </a>
            ) : null}
          </div>
        ))}
        {!invoices.length ? <p className="text-fog">Пока нет фактур.</p> : null}
      </div>
    </section>
  );
}
