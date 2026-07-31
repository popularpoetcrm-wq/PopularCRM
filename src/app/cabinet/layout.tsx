import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getRequestBrand } from "@/lib/brand-server";
import { hasSupabase } from "@/lib/env";
import { getPersonAvatarUrl } from "@/lib/avatars";
import { CabinetChrome } from "@/components/CabinetChrome";

export default async function CabinetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const brand = await getRequestBrand();

  let avatarUrl: string | null = null;
  if (hasSupabase() && user.mode === "supabase") {
    try {
      avatarUrl = await getPersonAvatarUrl(user.personId);
    } catch {
      avatarUrl = null;
    }
  }

  return (
    <CabinetChrome
      brandName={brand.name}
      fullName={user.fullName}
      avatarUrl={avatarUrl}
    >
      {children}
    </CabinetChrome>
  );
}
