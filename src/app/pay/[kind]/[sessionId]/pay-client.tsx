"use client";

export default function PayKindClientPage({
  kind,
  sessionId,
}: {
  kind: string;
  sessionId: string;
}) {
  const labels: Record<string, string> = {
    trial: "Пробное занятие",
    event: "Ивент",
    package: "Пакет занятий",
  };

  async function pay() {
    const res = await fetch("/api/v1/demo/complete-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId: sessionId }),
    });
    const json = await res.json();
    if (!json.ok) {
      alert(json.error ?? "Ошибка");
      return;
    }
    const invite = json.data.invite;
    const qs = new URLSearchParams({
      kind,
      sessionId,
      ok: "1",
    });
    if (invite?.magicUrl) qs.set("magicUrl", invite.magicUrl);
    if (invite?.invited) qs.set("invited", "1");
    window.location.href = `/pay/return?${qs.toString()}`;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <div className="glass glass-strong fade-up p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-fog">
          Popular Tickets · demo P24
        </p>
        <h1 className="mt-3 font-display text-3xl">{labels[kind] ?? kind}</h1>
        <p className="mt-3 text-fog">
          Без ключей: кнопка имитирует успешный webhook + verify.
        </p>
        <p className="mt-4 font-mono text-sm text-fog">{sessionId}</p>
        <button className="btn btn-primary mt-6 w-full" onClick={pay}>
          Оплатить (demo)
        </button>
      </div>
    </main>
  );
}
