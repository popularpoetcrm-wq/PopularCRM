import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDemoState } from "@/lib/demo-store";
import { hasSupabase } from "@/lib/env";
import { getPersonOnboardingStatus } from "@/lib/supabase-data";

/** Gated cabinet routes — incomplete onboarding goes to /cabinet/welcome. */
export default async function CabinetAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

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

  return children;
}
