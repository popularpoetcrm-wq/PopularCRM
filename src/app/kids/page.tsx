import Link from "next/link";

/** Soft entry for Kids — no own domain yet. */
export default function KidsEntryPage() {
  return (
    <main className="relative mx-auto min-h-screen max-w-3xl overflow-hidden px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 20% 10%, color-mix(in oklab, var(--stage) 35%, transparent), transparent 60%), radial-gradient(ellipse 60% 40% at 90% 80%, color-mix(in oklab, var(--accent, #7eb8ff) 25%, transparent), transparent 55%)",
        }}
      />
      <div className="glass glass-strong fade-up p-8 sm:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-fog">
          Popular Kids
        </p>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">Детская студия</h1>
        <p className="mt-4 max-w-xl text-fog">
          Отдельного домена пока нет — всё в той же CRM. Родители входят в ЛК,
          педагоги ведут группу на вкладке Kids.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-fog">
          <li>· Расписание и «ребёнок не придёт» из кабинета родителя</li>
          <li>· Пакеты и оплаты на email родителя</li>
          <li>· Админка: вкладка Kids · пара ребёнок + родитель</li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login" className="btn btn-stage" style={{ minHeight: 48 }}>
            Войти родителю
          </Link>
          <Link href="/admin" className="btn btn-ghost" style={{ minHeight: 48 }}>
            Админка
          </Link>
          <Link href="/" className="btn btn-ghost" style={{ minHeight: 48 }}>
            Popular Poet
          </Link>
        </div>
      </div>
    </main>
  );
}
