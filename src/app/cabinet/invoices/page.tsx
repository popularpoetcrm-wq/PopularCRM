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
      setPayments((json.data.payments ?? []).filter((p: Payment) => ["paid", "partial"].includes(p.status)));
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
    setMessage(json.ok ? `Faktura: ${json.data.invoice_number}` : json.error);
    await load();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Faktury</h1>
        <p className="text-fog">Wniosek z panelu → Saldeo (MVP).</p>
      </div>

      <div className="card-quiet grid gap-3 p-5 md:grid-cols-2">
        <label className="text-sm font-semibold">
          Firma (opcjonalnie)
          <input className="input mt-2" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          NIP
          <input className="input mt-2" value={nip} onChange={(e) => setNip(e.target.value)} />
        </label>
      </div>

      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      <div className="space-y-3">
        <h2 className="font-display text-xl">Płatności do faktury</h2>
        {payments.map((p) => (
          <div key={p.id} className="card-quiet flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-semibold">{p.description}</p>
              <p className="text-sm text-fog">{p.amount} PLN · {p.status}</p>
            </div>
            <button className="btn btn-stage" onClick={() => requestInvoice(p.id)}>
              Wystaw fakturę
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl">Historia</h2>
        {invoices.map((i) => (
          <div key={i.id} className="card-quiet flex items-center justify-between p-5">
            <div>
              <p className="font-semibold">{i.invoice_number ?? i.id}</p>
              <p className="text-sm text-fog">{i.status}</p>
            </div>
            {i.pdf_url ? (
              <a className="btn btn-ghost" href={i.pdf_url}>
                PDF
              </a>
            ) : null}
          </div>
        ))}
        {!invoices.length ? <p className="text-fog">Brak faktur.</p> : null}
      </div>
    </section>
  );
}
