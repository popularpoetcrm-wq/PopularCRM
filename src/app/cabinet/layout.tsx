import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getRequestBrand } from "@/lib/brand-server";
import { getDemoState } from "@/lib/demo-store";
import { hasSupabase } from "@/lib/env";
import { getPersonOnboardingStatus } from "@/lib/supabase-data";
import { getPersonAvatarUrl } from "@/lib/avatars";

const DOCK = [
  { href: "/cabinet", label: "Домой" },
  { href: "/cabinet/schedule", label: "Занятия" },
  { href: "/cabinet/payments", label: "Оплата" },
  { href: "/cabinet/profile", label: "Профиль" },
] as const;

export default async function CabinetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const brand = await getRequestBrand();

  const hdrs = await headers();
  const path = hdrs.get("x-pathname") ?? hdrs.get("x-invoke-path") ?? "";
  const onWelcome = path.includes("/cabinet/welcome");
  const onConsents = path.includes("/cabinet/consents");

  if (!onWelcome && !onConsents) {
    let status = "complete";
    if (hasSupabase() && user.mode === "supabase") {
      try {
        status = await getPersonOnboardingStatus(user.personId);
      } catch {
        status = "complete";
      }
    } else if (user.mode === "demo") {
      const person = getDemoState().persons.find((p) => p.id === user.personId);
      status = person?.onboarding_status ?? "complete";
    }
    if (status === "draft" || status === "invited" || status === "activated") {
      redirect("/cabinet/welcome");
    }
  }

  let avatarUrl: string | null = null;
  if (hasSupabase() && user.mode === "supabase") {
    try {
      avatarUrl = await getPersonAvatarUrl(user.personId);
    } catch {
      avatarUrl = null;
    }
  }

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
                {user.fullName.slice(0, 1)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-lg">{brand.name}</p>
            <p className="truncate text-xs text-fog">{user.fullName}</p>
          </div>
        </div>
        <Link href="/cabinet/profile" className="btn btn-ghost shrink-0 text-sm">
          Профиль
        </Link>
      </header>

      <div className="fade-up">{children}</div>

      <nav
        className="glass-nav fixed bottom-3 left-3 right-3 z-40 mx-auto flex max-w-3xl items-stretch gap-0 overflow-x-auto px-1 py-1.5 md:bottom-4"
        aria-label="Меню кабинета"
      >
        {DOCK.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="nav-dock-link"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
