"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "delivery" | "code">("email");
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [deliveredHint, setDeliveredHint] = useState("");
  const [loading, setLoading] = useState(false);

  function goAfterLogin(json: { roles?: string[]; needsWelcome?: boolean }) {
    const roles: string[] = json.roles ?? [];
    if (roles.includes("admin") || roles.includes("teacher")) {
      router.push("/admin");
    } else if (json.needsWelcome) {
      router.push("/cabinet/welcome");
    } else {
      router.push("/cabinet");
    }
    router.refresh();
  }

  async function requestCode(delivery?: "email" | "telegram") {
    setLoading(true);
    setMessage("");
    setDeliveredHint("");
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, delivery }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error ?? "Не удалось отправить код");
        return;
      }
      if (json.data.mode === "demo") {
        goAfterLogin(json.data);
        return;
      }
      if (json.data.mode === "choose_delivery") {
        setAvailableChannels(json.data.availableChannels ?? []);
        setStep("delivery");
        setMessage(json.data.message ?? "Куда прислать код?");
        return;
      }
      setStep("code");
      setCode("");
      setMessage(json.data.message ?? "");
      const d = (json.data.delivered as string[] | undefined) ?? [];
      if (d.includes("telegram") && d.includes("email")) {
        setDeliveredHint("Проверь Telegram и почту.");
      } else if (d.includes("telegram")) {
        setDeliveredHint("Код в боте @Popular_poet_bot.");
      } else if (d.includes("email")) {
        setDeliveredHint("Проверь входящие и спам.");
      } else if (json.data.debugCode) {
        setDeliveredHint(
          `Доставка не настроена — код для ручного ввода: ${json.data.debugCode}`,
        );
      }
    } catch {
      setMessage("Не удалось связаться с CRM. Проверь соединение и попробуй ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    await requestCode();
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error ?? "Не удалось проверить код");
        return;
      }
      goAfterLogin(json.data ?? {});
    } catch {
      setMessage("Не удалось связаться с CRM. Проверь соединение и попробуй ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 font-display text-2xl fade-up">
        Popular Poet
      </Link>
      <div className="glass glass-strong fade-up p-5 sm:p-8">
        <h1 className="font-display text-3xl">Вход</h1>
        <p className="mt-2 text-sm text-fog">
          Введи email. Если привязаны и почта, и Telegram, сам выберешь, куда
          прислать шестизначный код.
        </p>
        <p className="mt-2 text-sm text-fog">
          Ещё нет email в CRM?{" "}
          <Link href="/join" className="underline">
            /join
          </Link>
          . Уже в боте? Команда{" "}
          <code className="text-xs">/login</code> даст ссылку без кода.
        </p>

        {step === "email" ? (
          <form onSubmit={submitEmail} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold">
              Email
              <input
                className="input mt-2"
                type="email"
                autoComplete="email"
                placeholder="ты@почта.pl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button className="btn btn-primary w-full" disabled={loading}>
              {loading ? "Отправляем…" : "Получить код"}
            </button>
          </form>
        ) : step === "delivery" ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-fog">
              Куда прислать код для <strong>{email}</strong>?
            </p>
            {availableChannels.includes("telegram") ? (
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={loading}
                onClick={() => void requestCode("telegram")}
              >
                {loading ? "Отправляем…" : "В Telegram"}
              </button>
            ) : null}
            {availableChannels.includes("email") ? (
              <button
                type="button"
                className="btn btn-ghost w-full"
                disabled={loading}
                onClick={() => void requestCode("email")}
              >
                {loading ? "Отправляем…" : "На email"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost w-full text-sm"
              onClick={() => {
                setStep("email");
                setAvailableChannels([]);
                setMessage("");
              }}
            >
              Другой email
            </button>
          </div>
        ) : (
          <form onSubmit={submitCode} className="mt-6 space-y-4">
            <p className="break-words text-sm text-fog">
              Код для <strong>{email}</strong>
            </p>
            {deliveredHint ? (
              <p className="text-sm text-stage-deep">{deliveredHint}</p>
            ) : null}
            <label className="block text-sm font-semibold">
              Код из 6 цифр
              <input
                className="input mt-2 tracking-[0.35em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
              />
            </label>
            <button className="btn btn-primary w-full" disabled={loading || code.length < 6}>
              {loading ? "Проверяем…" : "Войти"}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-full text-sm"
              onClick={() => {
                setStep("email");
                setCode("");
                setMessage("");
                setDeliveredHint("");
                setAvailableChannels([]);
              }}
            >
              Другой email
            </button>
          </form>
        )}

        {message ? (
          <p className="mt-4 break-words text-sm text-fog" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
