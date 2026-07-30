"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Payment = {
  id: string;
  description?: string | null;
  amount: number;
  amount_paid: number;
  status: string;
  payment_method?: string | null;
  payment_url?: string | null;
};

const STATUS: Record<string, string> = {
  pending: "ждём оплату",
  partial: "оплачено частично",
  paid: "оплачено",
  failed: "ошибка оплаты",
  refunded: "возврат",
  cancelled: "отменено",
};

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v1/admin/payments");
    const json = await res.json();
    if (json.ok) setPayments(json.data ?? []);
    else setMessage(json.error);
  }

  useEffect(() => {
    void load();
  }, []);

  const open = payments.filter((payment) =>
    ["pending", "partial"].includes(payment.status),
  );
  const openTotal = open.reduce(
    (sum, payment) =>
      sum + Math.max(0, Number(payment.amount) - Number(payment.amount_paid)),
    0,
  );

  async function sendReminder(paymentId: string) {
    setBusyId(paymentId);
    const res = await fetch("/api/v1/admin/payments/remind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId }),
    });
    const json = await res.json();
    setBusyId(null);
    setMessage(
      json.ok
        ? "Напоминание поставлено в очередь"
        : json.error,
    );
  }

  async function recordPayment(payment: Payment) {
    const remaining = Math.max(
      0,
      Number(payment.amount) - Number(payment.amount_paid),
    );
    const addAmount = Number(amounts[payment.id] || remaining);
    if (!addAmount || addAmount < 0) {
      setMessage("Укажи полученную сумму");
      return;
    }
    setBusyId(payment.id);
    const res = await fetch("/api/v1/admin/payments/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "partial",
        payment_id: payment.id,
        add_amount: addAmount,
        method: "transfer",
      }),
    });
    const json = await res.json();
    setBusyId(null);
    setMessage(
      json.ok
        ? `Получено ${addAmount} PLN`
        : json.error,
    );
    if (json.ok) {
      setAmounts((current) => ({ ...current, [payment.id]: "" }));
      await load();
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">Оплаты</h1>
          <p className="mt-1 text-fog">
            Открытые начисления, напоминания и фактически полученные деньги.
          </p>
        </div>
        <Link href="/admin/invoices" className="btn btn-ghost text-sm">
          Перейти к фактурам
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="glass p-5">
          <p className="text-sm text-fog">Ожидаем оплату</p>
          <p className="mt-2 text-3xl font-semibold">{open.length}</p>
        </div>
        <div className="glass p-5">
          <p className="text-sm text-fog">Открытая сумма</p>
          <p className="mt-2 text-3xl font-semibold text-warn">
            {Math.round(openTotal)} PLN
          </p>
        </div>
      </div>

      {message ? <p className="text-sm text-stage-deep">{message}</p> : null}

      <ul className="space-y-3">
        {payments.map((payment) => {
          const remaining = Math.max(
            0,
            Number(payment.amount) - Number(payment.amount_paid),
          );
          const unpaid = ["pending", "partial"].includes(payment.status);
          return (
            <li key={payment.id} className="glass p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold">
                    {payment.description || "Начисление"}
                  </p>
                  <p className="mt-1 text-sm text-fog">
                    Получено {payment.amount_paid}/{payment.amount} PLN
                    {payment.payment_method
                      ? ` · ${payment.payment_method}`
                      : ""}
                  </p>
                  <span
                    className={`badge mt-2 ${
                      payment.status === "paid"
                        ? "badge-ok"
                        : unpaid
                          ? "badge-warn"
                          : ""
                    }`}
                  >
                    {STATUS[payment.status] ?? payment.status}
                  </span>
                </div>

                {unpaid ? (
                  <div className="grid gap-2 sm:min-w-72 sm:grid-cols-[1fr_auto]">
                    <label className="text-xs font-semibold text-fog">
                      Получено, PLN
                      <input
                        className="input mt-1"
                        inputMode="decimal"
                        placeholder={String(remaining)}
                        value={amounts[payment.id] ?? ""}
                        onChange={(event) =>
                          setAmounts((current) => ({
                            ...current,
                            [payment.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-stage self-end text-sm"
                      disabled={busyId === payment.id}
                      onClick={() => recordPayment(payment)}
                    >
                      Отметить оплату
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-sm sm:col-span-2"
                      disabled={busyId === payment.id}
                      onClick={() => sendReminder(payment.id)}
                    >
                      Отправить напоминание
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
        {!payments.length ? (
          <li className="glass p-6 text-center text-fog">
            Начислений пока нет.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
