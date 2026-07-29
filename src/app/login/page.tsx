"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("anna@example.com");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [message, setMessage] = useState("");
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

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    setLoading(false);
    if (!json.ok) {
      setMessage(json.error ?? "Ошибка");
      return;
    }
    if (json.data.mode === "demo") {
      goAfterLogin(json.data);
      return;
    }
    setStep("code");
    if (json.data.debugCode) {
      setCode(String(json.data.debugCode));
      setMessage(`Код (dev, из БД): ${json.data.debugCode}`);
    } else {
      setMessage(json.data.message);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/v1/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const json = await res.json();
    setLoading(false);
    if (!json.ok) {
      setMessage(json.error ?? "Ошибка");
      return;
    }
    goAfterLogin(json.data ?? {});
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 font-display text-2xl fade-up">
        Popular
      </Link>
      <div className="glass glass-strong fade-up p-8">
        <h1 className="font-display text-3xl">Вход</h1>
        <p className="mt-2 text-sm text-fog">
          Уже в студии, но без входа?{" "}
          <Link href="/join" className="underline">
            Оставь email на /join
          </Link>
          . Если email уже в CRM — код придёт сюда. Telegram: /login в боте.
        </p>

        {step === "email" ? (
          <form onSubmit={submitEmail} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold">
              Email
              <input
                className="input mt-2"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button className="btn btn-primary w-full" disabled={loading}>
              {loading ? "…" : "Продолжить"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold">
              Код
              <input
                className="input mt-2"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
            <button className="btn btn-primary w-full" disabled={loading}>
              {loading ? "…" : "Войти"}
            </button>
          </form>
        )}

        {message ? <p className="mt-4 text-sm text-warn">{message}</p> : null}

        <div className="mt-6 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="badge"
            onClick={() => setEmail("anna@example.com")}
          >
            anna@example.com
          </button>
          <button
            type="button"
            className="badge"
            onClick={() => setEmail("maria@example.com")}
          >
            maria@example.com
          </button>
          <button
            type="button"
            className="badge"
            onClick={() => setEmail("teacher@studio.local")}
          >
            teacher@studio.local
          </button>
          <button
            type="button"
            className="badge"
            onClick={() => setEmail("admin@studio.local")}
          >
            admin@studio.local
          </button>
        </div>
      </div>
    </main>
  );
}
