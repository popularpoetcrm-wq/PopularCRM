"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Offer = {
  id: string;
  product_kind: "trial" | "event";
  title: string;
  amount: number;
  starts_at: string;
};

export default function PayHubPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState({ full_name: "", email: "", phone: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/checkout/guest")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) {
          setOffers(json.data);
          if (json.data[0]) setSelected(json.data[0].id);
        }
      });
  }, []);

  async function startCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/v1/checkout/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: selected, ...form }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMessage(json.error);
      return;
    }
    window.location.href = json.data.checkoutUrl;
  }

  const offer = offers.find((o) => o.id === selected);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10">
      <div className="glass glass-strong fade-up p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-fog">
          Popular Tickets
        </p>
        <h1 className="mt-3 font-display text-4xl">Пробные и ивенты</h1>
        <p className="mt-3 text-fog">
          Оплата без аккаунта. После оплаты придёт magic-link в личный кабинет.
        </p>

        <form onSubmit={startCheckout} className="mt-8 space-y-4">
          <label className="block text-sm font-semibold">
            Оффер
            <select
              className="input mt-2"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.product_kind === "trial" ? "Пробное" : "Ивент"} · {o.title} ·{" "}
                  {o.amount} PLN
                </option>
              ))}
            </select>
          </label>
          <input
            className="input"
            placeholder="Имя"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
          />
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            className="input"
            placeholder="Телефон (необязательно)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <button className="btn btn-primary w-full" disabled={busy || !offer}>
            {busy ? "…" : `К оплате${offer ? ` · ${offer.amount} PLN` : ""}`}
          </button>
        </form>

        {message ? <p className="mt-4 text-sm text-warn">{message}</p> : null}

        <p className="mt-6 text-xs text-fog">
          Уже есть кабинет?{" "}
          <Link href="/login" className="underline">
            Войти
          </Link>
        </p>
      </div>
    </main>
  );
}
