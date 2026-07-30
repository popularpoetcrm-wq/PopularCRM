import Link from "next/link";

export default async function PayReturnPage({
  searchParams,
}: {
  searchParams: Promise<{
    sessionId?: string;
    payment_id?: string;
    kind?: string;
    ok?: string;
    magicUrl?: string;
    invited?: string;
  }>;
}) {
  const sp = await searchParams;
  const isTrialOrEvent = sp.kind === "trial" || sp.kind === "event";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <div className="glass glass-strong fade-up p-8 text-center">
        <p className="badge badge-ok mx-auto">
          {sp.ok === "1" ? "Оплата подтверждена" : "Проверяем оплату"}
        </p>
        <h1 className="mt-4 font-display text-3xl">Спасибо</h1>
        <p className="mt-3 text-fog">
          {sp.ok === "1"
            ? isTrialOrEvent
              ? "Оплата прошла. Открой личный кабинет по ссылке."
              : "Платёж подтверждён. Абонемент активирован."
            : "Банк ещё подтверждает платёж. Обычно это занимает несколько секунд — обнови страницу платежей через минуту."}
        </p>
        {sp.payment_id ? (
          <p className="mt-2 text-xs text-fog">Платёж: {sp.payment_id}</p>
        ) : null}

        {sp.magicUrl ? (
          <div className="mt-6 space-y-3 text-left">
            <p className="text-sm font-semibold">Ссылка в личный кабинет:</p>
            <a href={sp.magicUrl} className="break-all text-sm underline">
              {sp.magicUrl}
            </a>
            <Link href={sp.magicUrl} className="btn btn-primary mt-2 w-full">
              Открыть кабинет
            </Link>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/cabinet/payments" className="btn btn-stage">
              К платежам
            </Link>
            <Link href="/login" className="btn btn-ghost">
              Войти
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
