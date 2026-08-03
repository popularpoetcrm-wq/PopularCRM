"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CabinetLoading } from "@/components/CabinetLoading";

type Payment = {
  id: string;
  amount: number;
  amount_paid: number;
  status: string;
  payment_method?: string | null;
  description?: string | null;
  payment_url?: string;
  enrollment_id?: string;
  paid_at?: string | null;
  created_at?: string;
};

type Package = {
  id: string;
  enrollment_id: string;
  credits_available: number;
  credits_total: number;
  expires_at?: string | null;
  plan?: {
    id?: string;
    name?: string;
    price_gross?: number;
    currency?: string;
  } | null;
};

type Money = {
  label: string;
  debt_open: number;
  credits_left: number | null;
  last_paid_at?: string | null;
  last_paid_amount?: number | null;
};

function statusRu(status: string) {
  if (status === "paid") return "оплачено";
  if (status === "pending") return "ждёт оплаты";
  if (status === "partial") return "частично оплачено";
  if (status === "failed") return "не прошло";
  if (status === "refunded") return "возврат";
  return status;
}

function paymentTitle(payment: Payment) {
  const raw = payment.description?.trim() ?? "";
  if (/абонемент|pakiet/i.test(raw) && /4\s*(занят|zaję)/i.test(raw)) {
    return "Абонемент · 4 занятия";
  }
  return raw || "Платёж";
}

function paymentDate(payment: Payment) {
  return payment.paid_at ?? payment.created_at ?? null;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [money, setMoney] = useState<Money | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/v1/me/dashboard");
      const json = await res.json();
      if (json.ok) {
        setPayments(json.data.payments ?? []);
        setPackages(json.data.packages ?? []);
        setMoney(json.data.money ?? null);
      } else {
        setMessage(json.error ?? "Не удалось загрузить оплаты");
      }
    } catch {
      setMessage("Не удалось загрузить оплаты. Попробуй обновить страницу.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const duePayments = useMemo(
    () => payments.filter((payment) => ["pending", "partial"].includes(payment.status)),
    [payments],
  );
  const completedPayments = useMemo(
    () =>
      payments.filter(
        (payment) =>
          !["pending", "partial"].includes(payment.status) &&
          Number(payment.amount_paid) > 0,
      ),
    [payments],
  );
  const latestPaid = completedPayments[0];

  async function openPayment(input: {
    key: string;
    payment?: Payment;
    package?: Package;
  }) {
    const existing = input.payment;
    const pkg = input.package;
    if (!existing && !pkg) return;
    setBusyId(input.key);
    setMessage("");
    try {
      const res = await fetch("/api/v1/payments/p24/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          existing
            ? {
                paymentId: existing.id,
                enrollmentId: existing.enrollment_id,
                description: existing.description || "Абонемент",
              }
            : {
                enrollmentId: pkg!.enrollment_id,
                planId: pkg!.plan?.id,
                description: `Следующий пакет · ${pkg!.plan?.name ?? "абонемент"}`,
              },
        ),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error ?? "Не удалось создать оплату");
        return;
      }
      if (json.data.payment_url) {
        window.location.assign(json.data.payment_url);
        return;
      }
      setMessage("Ссылка на оплату создана.");
      await load();
    } catch {
      setMessage("Не удалось открыть оплату. Попробуй ещё раз.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Оплата</h1>
        <p className="mt-2 max-w-2xl text-fog">
          Здесь только то, что важно сейчас: текущий пакет, неоплаченные счета и следующий абонемент. Полная история — ниже.
        </p>
      </div>

      {message ? <p className="glass p-4 text-sm text-stage-deep">{message}</p> : null}
      {loading ? <CabinetLoading label="Загружаем оплаты…" /> : null}

      {!loading ? (
        <>
          <section className="glass grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Сейчас</p>
              <p className="mt-2 text-lg font-semibold">{money?.label ?? "—"}</p>
              {money?.credits_left != null ? (
                <p className="mt-1 text-sm text-fog">осталось занятий: {money.credits_left}</p>
              ) : null}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">К оплате</p>
              <p className="mt-2 text-2xl font-semibold">
                {money?.debt_open ? <span className="text-warn">{money.debt_open} PLN</span> : "0 PLN"}
              </p>
              <p className="mt-1 text-sm text-fog">
                {duePayments.length ? `счетов: ${duePayments.length}` : "всё оплачено"}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-fog">Последняя оплата</p>
              <p className="mt-2 text-lg font-semibold">
                {latestPaid
                  ? `${latestPaid.amount_paid} PLN`
                  : money?.last_paid_amount != null
                    ? `${money.last_paid_amount} PLN`
                    : "—"}
              </p>
              <p className="mt-1 text-sm text-fog">
                {paymentDate(latestPaid ?? ({} as Payment))
                  ? format(new Date(paymentDate(latestPaid ?? ({} as Payment))!), "d MMMM yyyy", { locale: ru })
                  : money?.last_paid_at
                    ? format(new Date(money.last_paid_at), "d MMMM yyyy", { locale: ru })
                    : "ещё нет"}
              </p>
            </div>
          </section>

          {duePayments.length ? (
            <section>
              <h2 className="font-display text-2xl">Ждут оплаты</h2>
              <ul className="mt-3 space-y-3">
                {duePayments.map((payment) => {
                  const remaining = Math.max(0, Number(payment.amount) - Number(payment.amount_paid));
                  return (
                    <li key={payment.id} className="glass flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">{paymentTitle(payment)}</p>
                        <p className="mt-1 text-sm text-fog">
                          Осталось оплатить: {remaining} PLN
                          {payment.amount_paid ? ` из ${payment.amount} PLN` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary w-full shrink-0 sm:w-auto"
                        disabled={busyId === payment.id}
                        onClick={() => void openPayment({ key: payment.id, payment })}
                      >
                        {busyId === payment.id ? "Открываем…" : `Оплатить ${remaining} PLN`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {packages.length ? (
            <section>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-display text-2xl">Следующий абонемент</h2>
                  <p className="mt-1 text-sm text-fog">
                    Можно оплатить заранее — ссылка откроется в PopularTickets / P24.
                  </p>
                </div>
              </div>
              <ul className="mt-3 space-y-3">
                {packages.map((pkg) => {
                  const price = pkg.plan?.price_gross;
                  return (
                    <li key={pkg.id} className="card-quiet flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">{pkg.plan?.name ?? "Абонемент"}</p>
                        <p className="mt-1 text-sm text-fog">
                          Сейчас осталось {pkg.credits_available} из {pkg.credits_total} занятий
                          {price ? ` · следующий пакет: ${price} ${pkg.plan?.currency ?? "PLN"}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-stage w-full shrink-0 sm:w-auto"
                        disabled={busyId === `next-${pkg.id}`}
                        onClick={() => void openPayment({ key: `next-${pkg.id}`, package: pkg })}
                      >
                        {busyId === `next-${pkg.id}`
                          ? "Открываем…"
                          : price
                            ? `Оплатить ${price} ${pkg.plan?.currency ?? "PLN"}`
                            : "Оплатить следующий"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <details className="glass group p-5">
            <summary className="cursor-pointer list-none font-display text-2xl marker:hidden">
              История оплат ({completedPayments.length})
              <span className="ml-2 text-base text-fog group-open:hidden">показать</span>
            </summary>
            {completedPayments.length ? (
              <ul className="mt-4 space-y-2">
                {completedPayments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-sm">
                    <div>
                      <p className="font-semibold">{paymentTitle(payment)}</p>
                      <p className="text-fog">
                        {statusRu(payment.status)}
                        {payment.payment_method ? ` · ${payment.payment_method}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{payment.amount_paid} PLN</p>
                      {paymentDate(payment) ? (
                        <p className="text-xs text-fog">
                          {format(new Date(paymentDate(payment)!), "d MMM yyyy", { locale: ru })}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-fog">Истории оплат пока нет.</p>
            )}
          </details>
        </>
      ) : null}

      <Link href="/cabinet" className="btn btn-ghost">
        На главную
      </Link>
    </section>
  );
}
