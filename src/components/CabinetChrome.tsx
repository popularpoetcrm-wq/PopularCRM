"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const DOCK = [
  { href: "/cabinet", label: "Домой" },
  { href: "/cabinet/schedule", label: "Занятия" },
  { href: "/cabinet/payments", label: "Оплата" },
  { href: "/cabinet/profile", label: "Профиль" },
] as const;

export function CabinetChrome({
  brandName,
  fullName,
  avatarUrl,
  children,
}: {
  brandName: string;
  fullName: string;
  avatarUrl: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const onWelcome = pathname === "/cabinet/welcome";

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-28 pt-5 md:px-6">
      <header className="glass-nav mb-6 flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3 px-1">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/15">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-xs text-fog">
                {fullName.slice(0, 1)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-lg">{brandName}</p>
            <p className="truncate text-xs text-fog">{fullName}</p>
          </div>
        </div>
        {!onWelcome ? (
          <Link href="/cabinet/profile" className="btn btn-ghost shrink-0 text-sm">
            Профиль
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-fog">Онбординг</span>
        )}
      </header>

      <div className="fade-up">{children}</div>

      {!onWelcome ? (
        <nav
          className="glass-nav fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 right-3 z-40 mx-auto flex max-w-3xl items-stretch gap-0 overflow-x-auto px-1 py-1.5 md:bottom-4"
          aria-label="Меню кабинета"
        >
          {DOCK.map((item) => (
            <Link key={item.href} href={item.href} className="nav-dock-link">
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
