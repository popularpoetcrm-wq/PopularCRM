import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser, isStaff, isTeacherOnly, isAdmin } from "@/lib/auth";
import { BrandTabs } from "@/components/BrandTabs";
import { BRANDS, type BrandId } from "@/lib/brands";

const allLinks = [
  { href: "/admin", label: "Сегодня", roles: "staff" as const },
  { href: "/admin/insights", label: "Сводка", roles: "admin" as const },
  { href: "/admin/groups", label: "Группы", roles: "staff" as const },
  { href: "/admin/students", label: "Ученики", roles: "staff" as const },
  { href: "/admin/sessions", label: "Журнал", roles: "staff" as const },
  { href: "/admin/attendance", label: "Посещаемость", roles: "staff" as const },
  { href: "/admin/payments", label: "Оплаты", roles: "admin" as const },
  { href: "/admin/offers", label: "Календарь", roles: "admin" as const },
  { href: "/admin/invoices", label: "Фактуры", roles: "admin" as const },
  { href: "/admin/exports", label: "Экспорт", roles: "staff" as const },
  { href: "/admin/audit", label: "История", roles: "admin" as const },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isStaff(user.roles)) redirect("/cabinet");

  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  const brand = BRANDS[tab] ?? BRANDS.poet;
  const teacher = isTeacherOnly(user.roles);
  const links = allLinks.filter((l) =>
    l.roles === "admin" ? isAdmin(user.roles) : true,
  );

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:px-6">
      <header className="fade-up mb-6 space-y-4">
        <div className="glass-nav flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <div className="px-3">
            <p className="font-display text-xl">Управление студией</p>
            <p className="text-xs text-fog">
              {user.fullName} · {teacher ? "педагог" : "админ"} · сейчас:{" "}
              <strong>{brand.name}</strong>
            </p>
          </div>
          {!teacher ? <BrandTabs active={tab} /> : null}
        </div>
        <nav className="glass admin-nav-scroll px-2 py-2 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link">
              {l.label}
            </Link>
          ))}
          <Link href="/cabinet" className="nav-link">
            ЛК
          </Link>
        </nav>
      </header>
      <div className="fade-up">{children}</div>
    </div>
  );
}
