"use client";

import { useEffect, useState } from "react";

type Payment = {
  id: string;
  description: string;
  amount: number;
  amount_paid: number;
  status: string;
  payment_method: string;
  payment_url?: string;
  product_kind?: string;
  enrollment_id?: string;
  payer_person_id: string;
};

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch("/api/v1/admin/payments");
    const json = await res.json();
    if (json.ok) setPayments(json.data);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createPackageLink() {
    const res = await fetch("/api/v1/admin/payments/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "link",
        enrollment_id: "22222222-2222-2222-2222-222222222222",
        payer_person_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        amount: 200,
        description: "Доплата пакета",
        product_kind: "package",
      }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Link: ${json.data.payment_url}` : json.error);
    await load();
  }

  async function createTrialLink() {
    const res = await fetch("/api/v1/admin/payments/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "link",
        payer_person_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        amount: 70,
        description: "Пробное занятие",
        product_kind: "trial",
      }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Trial link: ${json.data.payment_url}` : json.error);
    await load();
  }

  async function sendReminder(paymentId: string) {
    const res = await fetch("/api/v1/admin/payments/remind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId }),
    });
    const json = await res.json();
    setMessage(json.ok ? "Напоминание в outbox/Telegram log" : json.error);
  }

  async function markPaid(paymentId: string) {
    const res = await fetch("/api/v1/demo/complete-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Оплачено demo → ${json.data.status}` : json.error);
    await load();
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Оплаты</h1>
          <p className="text-fog">Partial / cash / online · demo complete без P24 ключей</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={createTrialLink}>
            Ссылка: пробное
          </button>
          <button className="btn btn-primary" onClick={createPackageLink}>
            Ссылка: пакет
          </button>
        </div>
      </div>
      {message ? <p className="text-sm text-stage-deep break-all">{message}</p> : null}
      <ul className="space-y-3">
        {payments.map((p) => (
          <li key={p.id} className="glass flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-semibold">{p.description}</p>
              <p className="text-sm text-fog">
                {p.amount_paid}/{p.amount} PLN · {p.payment_method}
                {p.product_kind ? ` · ${p.product_kind}` : ""}
              </p>
              {p.payment_url ? (
                <a className="text-xs text-stage-deep underline" href={p.payment_url}>
                  {p.payment_url}
                </a>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge">{p.status}</span>
              {["pending", "partial"].includes(p.status) ? (
                <>
                  <button className="btn btn-ghost" onClick={() => sendReminder(p.id)}>
                    Напомнить
                  </button>
                  <button className="btn btn-stage" onClick={() => markPaid(p.id)}>
                    Demo: оплачено
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
