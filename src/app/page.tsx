import Link from "next/link";
import { getRequestBrand } from "@/lib/brand-server";
import { getTicketsPublicUrl, getPoetPublicUrl } from "@/lib/brands";

export default async function HomePage() {
  const brand = await getRequestBrand();
  const ticketsUrl = getTicketsPublicUrl();
  const poetUrl = getPoetPublicUrl();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
      <header className="glass-nav fade-up flex flex-wrap items-center justify-between gap-3 px-3 py-2">
        <div className="px-3">
          <p className="font-display text-xl">{brand.name}</p>
          <p className="text-xs text-fog">{brand.tagline}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/login" className="btn btn-ghost">
            Вход
          </Link>
          <Link href="/cabinet" className="btn btn-primary">
            Личный кабинет
          </Link>
        </div>
      </header>

      <section className="fade-up mt-20 grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:items-end">
        <div>
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-fog">
            {brand.shortName} · CRM
          </p>
          <h1 className="font-display text-5xl leading-[1.02] md:text-6xl">
            <span className="shine-text">Одна система.</span>
            <br />
            Нужные входы.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-fog">
            {brand.id === "poet" &&
              "Взрослая студия на popularpoet.pl — ЛК, пакеты, отработки. Kids пока без своего домена."}
            {brand.id === "kids" &&
              "Детская линейка без отдельного домена — управление во вкладке Kids админки."}
            {brand.id === "tickets" &&
              "Пробные занятия и ивенты — оплата через Przelewy24 на этом домене."}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="btn btn-stage">
              Войти
            </Link>
            <Link href="/admin" className="btn btn-ghost">
              Админка
            </Link>
            {brand.id === "poet" ? (
              <Link href="/kids" className="btn btn-ghost">
                Kids
              </Link>
            ) : null}
          </div>
        </div>

        <div className="glass glass-strong fade-up p-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-fog">Карта входов</p>
          <ul className="mt-4 space-y-3 text-sm">
            <li className="flex justify-between gap-3 border-b border-white/10 pb-3">
              <span>Взрослая</span>
              <span className="text-fog">{poetUrl.replace("https://", "")}</span>
            </li>
            <li className="flex justify-between gap-3 border-b border-white/10 pb-3">
              <span>Kids</span>
              <span className="text-fog">без домена · /kids</span>
            </li>
            <li className="flex justify-between gap-3 border-b border-white/10 pb-3">
              <span>Пробные / ивенты</span>
              <span className="text-fog">{ticketsUrl.replace("https://", "")}</span>
            </li>
            <li className="flex justify-between gap-3">
              <span>Админ</span>
              <span className="text-fog">вкладки Poet / Kids</span>
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
