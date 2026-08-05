"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CabinetLoading } from "@/components/CabinetLoading";

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
  sent_to_saldeo: "в обработке",
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
  const [billingComplete, setBillingComplete] = useState(true);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [dashRes, profileRes] = await Promise.all([
      fetch("/api/v1/me/dashboard"),
      fetch("/api/v1/me/profile"),
    ]);
    const [dash, profile] = await Promise.all([
      dashRes.json(),
      profileRes.json(),
    ]);
    if (dash.ok) {
      setPayments(
        (dash.data.payments ?? []).filter((p: Payment) =>
          ["pending", "paid", "partial"].includes(p.status),
        ),
      );
      setInvoices(dash.data.invoices ?? []);
    }
    if (profile.ok) {
      setBillingComplete(Boolean(profile.data.person?.billing_complete));
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function requestInvoice(paymentId: string) {
    setMessage("");
    if (!billingComplete) {
      setMessage("Сначала заполни адрес для фактуры в профиле");
      return;
    }
    const res = await fetch("/api/v1/invoices/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId }),
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
          Фактура выставляется после оплаты (VAT 0%). В позиции: «Kurs aktorski —
          4 zajęcia». PDF придёт в Telegram и будет здесь.
        </p>
      </div>

      {!billingComplete ? (
        <div className="glass border-warn/40 p-5">
          <p className="font-semibold text-warn">Нужны данные для фактуры</p>
          <p className="mt-1 text-sm text-fog">
            Укажи улицу, индекс и город покупателя — без этого фактуру не
            выставим.
          </p>
          <Link href="/cabinet/profile" className="btn btn-stage mt-3 inline-flex">
            Заполнить в профиле
          </Link>
        </div>
      ) : null}

      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      {loading ? <CabinetLoading label="Загружаем фактуры…" /> : null}

      {!loading ? (
        <>
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
                <button
                  className="btn btn-stage"
                  disabled={!billingComplete}
                  onClick={() => requestInvoice(p.id)}
                >
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
                  <p className="font-semibold">
                    {i.invoice_number ?? "Запрос на фактуру"}
                  </p>
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
        </>
      ) : null}
    </section>
  );
}
