import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { getRequestBrand } from "@/lib/brand-server";
import { getDemoState } from "@/lib/demo-store";
import { hasSupabase } from "@/lib/env";
import { getPersonOnboardingStatus } from "@/lib/supabase-data";

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

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-24 pt-5 md:px-6">
      <header className="glass-nav mb-6 flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0 px-2">
          <p className="truncate font-display text-lg">{brand.name}</p>
          <p className="truncate text-xs text-fog">{user.fullName}</p>
        </div>
        <Link href="/cabinet" className="btn btn-ghost shrink-0 text-sm">
          Домой
        </Link>
      </header>

      <div className="fade-up">{children}</div>

      <nav className="glass-nav fixed bottom-3 left-3 right-3 z-40 mx-auto flex max-w-3xl justify-around gap-1 px-2 py-2 md:bottom-4">
        <Link href="/cabinet" className="nav-link text-xs sm:text-sm">
          Домой
        </Link>
        <Link href="/cabinet/schedule" className="nav-link text-xs sm:text-sm">
          Занятия
        </Link>
        <Link href="/cabinet/makeups" className="nav-link text-xs sm:text-sm">
          Отработки
        </Link>
        <Link href="/cabinet/payments" className="nav-link text-xs sm:text-sm">
          Оплата
        </Link>
        <Link href="/cabinet/profile" className="nav-link text-xs sm:text-sm">
          Профиль
        </Link>
        <Link href="/cabinet/consents" className="nav-link text-xs sm:text-sm">
          Согласия
        </Link>
      </nav>
    </div>
  );
}
