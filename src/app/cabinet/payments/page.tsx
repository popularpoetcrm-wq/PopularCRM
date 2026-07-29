"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

type Payment = {
  id: string;
  amount: number;
  amount_paid: number;
  status: string;
  payment_method?: string | null;
  description?: string | null;
  payment_url?: string;
  paid_at?: string | null;
  created_at?: string;
};

type Money = {
  label: string;
  debt_open: number;
  credits_left: number | null;
  last_paid_at?: string | null;
  last_paid_amount?: number | null;
};

function statusRu(s: string) {
  if (s === "paid") return "оплачено";
  if (s === "pending") return "ждём оплату";
  if (s === "partial") return "частично";
  if (s === "failed") return "ошибка";
  return s;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [money, setMoney] = useState<Money | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch("/api/v1/me/dashboard");
    const json = await res.json();
    if (json.ok) {
      setPayments(json.data.payments ?? []);
      setMoney(json.data.money ?? null);
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
        amount: 400,
        description: "Пакет 4 занятий",
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      setMessage(json.error);
      return;
    }
    setMessage("Ссылка на оплату создана.");
    if (json.data.payment_url) window.open(json.data.payment_url, "_blank");
    await load();
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Оплаты</h1>
          <p className="text-fog">Пакет, долг, история. $ в таблице студии = оплата цикла.</p>
        </div>
        <button className="btn btn-primary" onClick={createLink}>
          Оплатить пакет (P24)
        </button>
      </div>
      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      {money ? (
        <div className="glass grid gap-3 p-5 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-fog">Сейчас</p>
            <p className="mt-1 font-semibold">{money.label}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-fog">Долг</p>
            <p className="mt-1 text-2xl font-semibold">
              {money.debt_open ? (
                <span className="text-warn">{money.debt_open} PLN</span>
              ) : (
                "0"
              )}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-fog">Последняя оплата</p>
            <p className="mt-1 font-semibold">
              {money.last_paid_at
                ? `${money.last_paid_amount ?? "—"} PLN · ${format(new Date(money.last_paid_at), "d MMM yyyy", { locale: ru })}`
                : "—"}
            </p>
            {money.credits_left != null ? (
              <p className="text-xs text-fog">в пакете ещё {money.credits_left}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {!payments.length ? (
          <li className="glass p-8 text-center text-fog">Пока нет платежей в кабинете.</li>
        ) : (
          payments.map((p) => (
            <li
              key={p.id}
              className="card-quiet flex flex-wrap items-center justify-between gap-3 p-5"
            >
              <div>
                <p className="font-semibold">{p.description || "Платёж"}</p>
                <p className="text-sm text-fog">
                  {statusRu(p.status)} · {p.amount_paid}/{p.amount} PLN
                  {p.payment_method ? ` · ${p.payment_method}` : ""}
                </p>
                {p.paid_at || p.created_at ? (
                  <p className="text-xs text-fog">
                    {format(new Date(p.paid_at || p.created_at!), "d MMMM yyyy", {
                      locale: ru,
                    })}
                  </p>
                ) : null}
              </div>
              {p.payment_url && ["pending", "partial"].includes(p.status) ? (
                <a className="btn btn-ghost text-sm" href={p.payment_url} target="_blank" rel="noreferrer">
                  Оплатить
                </a>
              ) : null}
            </li>
          ))
        )}
      </ul>

      <Link href="/cabinet" className="btn btn-ghost">
        Назад
      </Link>
    </section>
  );
}
