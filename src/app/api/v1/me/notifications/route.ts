import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasSupabase } from "@/lib/env";
import { getExtendedDemo } from "@/lib/demo-ops";
import {
  getNotificationPresentation,
  renderTemplate,
} from "@/domain/notifications";

type NotificationRow = {
  id: string;
  template_code: string;
  payload?: Record<string, unknown> | null;
  text?: string;
  channel: string;
  status: string;
  read_at?: string | null;
  archived_at?: string | null;
  created_at: string;
};

function serializeNotification(note: NotificationRow) {
  const payload = note.payload ?? {};
  const presentation = getNotificationPresentation(note.template_code, payload);
  return {
    id: note.id,
    template_code: note.template_code,
    title: presentation.title,
    body: note.text || presentation.body,
    text: note.text || renderTemplate(note.template_code, payload),
    category: presentation.category,
    priority: presentation.priority,
    action: presentation.action,
    read_at: note.read_at ?? null,
    created_at: note.created_at,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  if (!hasSupabase() || user.mode === "demo") {
    const notes = getExtendedDemo()
        .notifications.filter((note) => note.recipient_person_id === user.personId)
        .filter((note) => !note.archived_at)
        .slice(0, 50)
        .map(serializeNotification);
    return jsonOk({ notifications: notes, unreadCount: notes.filter((n) => !n.read_at).length });
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await getAdminClient()
    .from("notifications")
    .select("*")
    .eq("tenant_id", user.tenantId)
    .eq("recipient_person_id", user.personId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return jsonError(error.message, 500);
  const notes = (data ?? []).map(serializeNotification);
  return jsonOk({
    notifications: notes,
    unreadCount: notes.filter((note) => !note.read_at).length,
  });
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), id: z.string().min(1) }),
  z.object({ action: z.literal("unread"), id: z.string().min(1) }),
  z.object({ action: z.literal("archive"), id: z.string().min(1) }),
  z.object({ action: z.literal("read_all") }),
]);

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid payload");
  const now = new Date().toISOString();

  if (!hasSupabase() || user.mode === "demo") {
    const notes = getExtendedDemo().notifications.filter(
      (note) => note.recipient_person_id === user.personId,
    );
    if (parsed.data.action === "read_all") {
      notes.forEach((note) => {
        note.read_at = note.read_at ?? now;
      });
    } else {
      const notificationId = parsed.data.id;
      const note = notes.find((item) => item.id === notificationId);
      if (!note) return jsonError("Not found", 404);
      if (parsed.data.action === "archive") note.archived_at = now;
      else note.read_at = parsed.data.action === "read" ? now : null;
    }
    return jsonOk({ updated: true });
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  let query = db
    .from("notifications")
    .update(
      parsed.data.action === "archive"
        ? { archived_at: now, read_at: now }
        : { read_at: parsed.data.action === "unread" ? null : now },
    )
    .eq("tenant_id", user.tenantId)
    .eq("recipient_person_id", user.personId);
  if (parsed.data.action !== "read_all") query = query.eq("id", parsed.data.id);
  const { error } = await query;
  if (error) return jsonError(error.message, 500);
  return jsonOk({ updated: true });
}
