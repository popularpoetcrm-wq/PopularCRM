import { getSessionUser, isAdmin } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasSupabase } from "@/lib/env";
import { getExtendedDemo } from "@/lib/demo-ops";
import { renderTemplate } from "@/domain/notifications";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);

  if (!hasSupabase() || user.mode === "demo") {
    const state = getExtendedDemo();
    return jsonOk({
      audit: state.audit.slice(0, 100),
      notifications: state.notifications.slice(0, 100),
    });
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const [{ data: audit, error: auditError }, { data: notes, error: notesError }] =
    await Promise.all([
      db
        .from("audit_log")
        .select("*")
        .eq("tenant_id", user.tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("notifications")
        .select("*")
        .eq("tenant_id", user.tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
  if (auditError || notesError) {
    return jsonError(auditError?.message ?? notesError?.message ?? "fail", 500);
  }
  return jsonOk({
    audit: (audit ?? []).map((entry) => ({
      ...entry,
      actor: entry.actor_person_id,
    })),
    notifications: (notes ?? []).map((note) => ({
      ...note,
      text: renderTemplate(note.template_code, note.payload ?? {}),
    })),
  });
}
