"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeCabinetNext } from "@/lib/cabinet-next";

function MagicConsume() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const next = safeCabinetNext(params.get("next"));
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"working" | "done" | "fail">("working");

  useEffect(() => {
    if (!token) {
      setError("Нет токена в ссылке");
      setStatus("fail");
      return;
    }

    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/auth/magic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (cancelled) return;
      if (!json.ok) {
        setError(json.error ?? "Ссылка недействительна");
        setStatus("fail");
        return;
      }
      setStatus("done");
      const roles: string[] = json.data.roles ?? [];
      if (roles.includes("admin") || roles.includes("teacher")) {
        router.replace("/admin");
      } else if (json.data.needsWelcome) {
        // Finish onboarding first; after that user lands in cabinet.
        router.replace("/cabinet/welcome");
      } else {
        router.replace(next);
      }
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [token, next, router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 font-display text-2xl">
        Popular Poet
      </Link>
      <div className="glass glass-strong p-5 sm:p-8">
        <h1 className="font-display text-3xl">Вход по ссылке</h1>
        {status === "working" ? (
          <p className="mt-4 text-fog">Открываем кабинет…</p>
        ) : null}
        {status === "fail" ? (
          <>
            <p className="mt-4 text-sm text-warn">{error}</p>
            <Link href="/login" className="btn btn-stage mt-6 inline-flex">
              Войти по email
            </Link>
          </>
        ) : null}
        {status === "done" ? (
          <p className="mt-4 text-fog">Готово, переходим…</p>
        ) : null}
      </div>
    </main>
  );
}

export default function MagicLoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-6">
          <p className="text-fog">Загрузка…</p>
        </main>
      }
    >
      <MagicConsume />
    </Suspense>
  );
}
