import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasSupabase } from "@/lib/env";
import { getExtendedDemo } from "@/lib/demo-ops";
import { renderTemplate } from "@/domain/notifications";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  if (!hasSupabase() || user.mode === "demo") {
    return jsonOk(
      getExtendedDemo()
        .notifications.filter((note) => note.recipient_person_id === user.personId)
        .slice(0, 50),
    );
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await getAdminClient()
    .from("notifications")
    .select("*")
    .eq("tenant_id", user.tenantId)
    .eq("recipient_person_id", user.personId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return jsonError(error.message, 500);
  return jsonOk(
    (data ?? []).map((note) => ({
      ...note,
      text: renderTemplate(note.template_code, note.payload ?? {}),
    })),
  );
}
