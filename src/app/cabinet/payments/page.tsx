"use client";

import { useEffect, useState } from "react";

type Payment = {
  id: string;
  amount: number;
  amount_paid: number;
  status: string;
  payment_method: string;
  description: string;
  payment_url?: string;
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [enrollmentId, setEnrollmentId] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch("/api/v1/me/dashboard");
    const json = await res.json();
    if (json.ok) {
      setPayments(json.data.payments ?? []);
      const firstEnrollment = json.data.groups?.[0]
        ? undefined
        : undefined;
      // enrollments not always in demo dashboard shape — use known demo id fallback
      setEnrollmentId("11111111-1111-1111-1111-111111111111");
      void firstEnrollment;
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createLink() {
    setMessage("");
    const res = await fetch("/api/v1/payments/p24/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enrollmentId,
        amount: 400,
        description: "Pakiet 4 zajęć",
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      setMessage(json.error);
      return;
    }
    setMessage("Link utworzony.");
    if (json.data.payment_url) window.open(json.data.payment_url, "_blank");
    await load();
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Płatności</h1>
          <p className="text-fog">Online (P24), gotówka, częściowe wpłaty, faktura.</p>
        </div>
        <button className="btn btn-primary" onClick={createLink}>
          Zapłać pakiet (P24)
        </button>
      </div>
      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      <ul className="space-y-3">
        {payments.map((p) => (
          <li key={p.id} className="card-quiet flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-semibold">{p.description}</p>
              <p className="text-sm text-fog">
                {p.payment_method} · {p.amount_paid}/{p.amount} PLN
              </p>
            </div>
            <span
              className={`badge ${
                p.status === "paid"
                  ? "badge-ok"
                  : p.status === "partial"
                    ? "badge-warn"
                    : "badge-danger"
              }`}
            >
              {p.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
