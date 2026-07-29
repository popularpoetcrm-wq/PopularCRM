"use client";

import { useEffect, useState } from "react";

type Offer = {
  id: string;
  product_kind: "trial" | "event";
  title: string;
  amount: number;
  starts_at: string;
  capacity: number;
  status: string;
};

export default function AdminOffersPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    product_kind: "trial" as "trial" | "event",
    title: "",
    amount: "70",
    starts_at: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16),
  });

  async function load() {
    const res = await fetch("/api/v1/offers");
    const json = await res.json();
    if (json.ok) setOffers(json.data);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        amount: Number(form.amount),
        starts_at: new Date(form.starts_at).toISOString(),
      }),
    });
    const json = await res.json();
    setMessage(json.ok ? `Создано: ${json.data.title}` : json.error);
    await load();
  }

  async function buy(offerId: string) {
    const res = await fetch("/api/v1/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "buy", offer_id: offerId }),
    });
    const json = await res.json();
    if (!json.ok) {
      setMessage(json.error);
      return;
    }
    setMessage(`Checkout: ${json.data.payment_url}`);
    if (json.data.payment_url) window.open(json.data.payment_url, "_blank");
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Пробные и ивенты</h1>
        <p className="text-fog">Оплата уходит на populartickets checkout (demo)</p>
      </div>

      <form onSubmit={create} className="glass grid gap-3 p-5 md:grid-cols-2">
        <select
          className="input"
          value={form.product_kind}
          onChange={(e) =>
            setForm({ ...form, product_kind: e.target.value as "trial" | "event" })
          }
        >
          <option value="trial">Пробное</option>
          <option value="event">Ивент</option>
        </select>
        <input
          className="input"
          placeholder="Название"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
        />
        <input
          className="input"
          placeholder="Цена PLN"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          required
        />
        <input
          className="input"
          type="datetime-local"
          value={form.starts_at}
          onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
          required
        />
        <button className="btn btn-primary md:col-span-2" type="submit">
          Создать offer
        </button>
      </form>

      {message ? <p className="text-sm text-stage-deep break-all">{message}</p> : null}

      <ul className="space-y-3">
        {offers.map((o) => (
          <li key={o.id} className="glass flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-semibold">{o.title}</p>
              <p className="text-sm text-fog">
                {o.product_kind} · {o.amount} PLN · {new Date(o.starts_at).toLocaleString()}
              </p>
            </div>
            <button className="btn btn-stage" onClick={() => buy(o.id)}>
              Ссылка оплаты
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
