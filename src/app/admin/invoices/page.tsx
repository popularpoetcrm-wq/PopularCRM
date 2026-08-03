"use client";

import { useCallback, useEffect, useState } from "react";

type Invoice = {
  id: string;
  status: string;
  invoice_number?: string | null;
  pdf_url?: string | null;
  error_message?: string | null;
  payments?: {
    amount?: number;
    currency?: string;
    description?: string | null;
  } | null;
  persons?: { full_name?: string } | null;
};

const STATUS: Record<string, string> = {
  requested: "запрошена",
  queued: "в очереди",
  sent_to_saldeo: "отправлена в Saldeo",
  issued: "готова",
  failed: "ошибка",
  cancelled: "отменена",
};

type SaldeoSetup = {
  configured: boolean;
  missing: string[];
  environment: "test" | "production";
};

type Action = "send" | "refresh";

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [setup, setSetup] = useState<SaldeoSetup | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [invoicesResponse, setupResponse] = await Promise.all([
        fetch("/api/v1/admin/invoices"),
        fetch("/api/v1/admin/saldeo/status"),
      ]);
      const [invoicesResult, setupResult] = await Promise.all([
        invoicesResponse.json(),
        setupResponse.json(),
      ]);
      if (invoicesResult.ok) setInvoices(invoicesResult.data ?? []);
      else setMessage(invoicesResult.error ?? "Не удалось загрузить фактуры");
      if (setupResult.ok) setSetup(setupResult.data);
    } catch {
      setMessage("Не удалось загрузить фактуры. Проверьте соединение и обновите страницу.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(invoiceId: string, action: Action) {
    setBusyId(invoiceId);
    setMessage("");
    try {
      const res = await fetch("/api/v1/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, action }),
      });
      const json = await res.json();
      setMessage(
        json.ok
          ? action === "refresh"
            ? json.data.status === "issued"
              ? "PDF готов — фактура доступна клиенту."
              : "Saldeo ещё готовит PDF. Проверьте чуть позже."
            : "Фактура отправлена в Saldeo. PDF может появиться не сразу."
          : json.error ?? "Не удалось выполнить действие",
      );
      if (json.saldeo) setSetup(json.saldeo);
      await load();
    } catch {
      setMessage("Не удалось связаться с CRM. Попробуйте ещё раз.");
    } finally {
      setBusyId(null);
    }
  }

  const setupLabel = setup?.configured
    ? `Saldeo подключен · ${setup.environment === "test" ? "тестовый" : "боевой"} контур`
    : "Saldeo: ждём API-аккаунт";

  return (
    <section className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">Фактуры</h1>
          <p className="mt-1 max-w-2xl text-fog">
            Контролируйте очередь, выпуск документов и ошибки. Клиент увидит
            фактуру только после появления PDF.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost w-full text-sm sm:w-auto"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Обновляем…" : "Обновить"}
        </button>
      </div>

      <div
        className={`glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${
          setup?.configured ? "" : "border-warn/40"
        }`}
      >
        <div>
          <p className="font-semibold">{setup ? setupLabel : "Проверяем Saldeo…"}</p>
          <p className="mt-1 text-sm text-fog">
            {setup?.configured
              ? "Новые запросы отправляются автоматически, а PDF проверяется отдельно."
              : "Новые запросы остаются в очереди и не получают фейковый номер или PDF."}
          </p>
        </div>
        {setup && !setup.configured ? (
          <span className="badge badge-warn self-start sm:self-auto">
            Не хватает: {setup.missing.join(", ")}
          </span>
        ) : setup?.configured ? (
          <span className="badge badge-ok self-start sm:self-auto">Готово к работе</span>
        ) : null}
      </div>

      {message ? (
        <p className="glass border-stage/40 px-4 py-3 text-sm text-stage-deep" role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <ul className="space-y-3" aria-label="Загружаем фактуры">
          {[0, 1, 2].map((item) => (
            <li key={item} className="card-quiet animate-pulse p-5">
              <div className="h-5 w-2/5 rounded bg-white/15" />
              <div className="mt-3 h-4 w-3/5 rounded bg-white/10" />
              <div className="mt-4 h-6 w-28 rounded-full bg-white/10" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-3">
        {invoices.map((invoice) => (
          <li
            key={invoice.id}
            className="card-quiet flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold">
                {invoice.invoice_number ||
                  invoice.persons?.full_name ||
                  "Фактура"}
              </p>
              <p className="mt-1 text-sm text-fog">
                {invoice.payments?.description || "Начисление"}
                {invoice.payments?.amount
                  ? ` · ${invoice.payments.amount} ${invoice.payments.currency || "PLN"}`
                  : ""}
              </p>
              <span
                className={`badge mt-2 ${
                  invoice.status === "failed"
                    ? "badge-danger"
                    : invoice.status === "issued"
                      ? "badge-ok"
                      : invoice.status === "sent_to_saldeo"
                        ? "badge-warn"
                      : ""
                }`}
              >
                {STATUS[invoice.status] ?? invoice.status}
              </span>
              {invoice.error_message ? (
                <p className="mt-2 break-words text-xs text-danger">
                  {invoice.error_message}
                </p>
              ) : null}
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
              {invoice.pdf_url ? (
                <a
                  className="btn btn-ghost flex-1 text-sm sm:flex-none"
                  href={invoice.pdf_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть PDF
                </a>
              ) : null}
              {["failed", "queued", "requested"].includes(invoice.status) ? (
                <button
                  type="button"
                  className="btn btn-stage flex-1 text-sm sm:flex-none"
                  disabled={busyId === invoice.id || !setup?.configured}
                  onClick={() => void runAction(invoice.id, "send")}
                >
                  {busyId === invoice.id
                    ? "Отправляем…"
                    : setup?.configured
                      ? "Отправить в Saldeo"
                      : "Ждём Saldeo"}
                </button>
              ) : null}
              {invoice.status === "sent_to_saldeo" && !invoice.pdf_url ? (
                <button
                  type="button"
                  className="btn btn-stage flex-1 text-sm sm:flex-none"
                  disabled={busyId === invoice.id || !setup?.configured}
                  onClick={() => void runAction(invoice.id, "refresh")}
                >
                  {busyId === invoice.id ? "Проверяем…" : "Проверить PDF"}
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {!invoices.length ? (
          <li className="glass p-8 text-center text-fog">
            Фактур пока нет. Когда клиент запросит документ, он появится здесь
            со статусом очереди.
          </li>
        ) : null}
        </ul>
      )}
    </section>
  );
}
