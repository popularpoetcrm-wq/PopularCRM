import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { getGroupDetailDb, updateGroupDb } from "@/lib/supabase-data";
import { normalizeDirection } from "@/lib/group-display";
import {
  issueGroupTelegramBindTokenDb,
  unbindGroupTelegramDb,
  sendTelegramGroupInviteForPersonDb,
} from "@/lib/group-telegram";
import { getAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const { id } = await ctx.params;
  if (!(hasSupabase() && user.mode === "supabase")) {
    return jsonError("Нужен режим Supabase", 501);
  }
  try {
    return jsonOk(await getGroupDetailDb(id, user.tenantId));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 404);
  }
}

const patchSchema = z.object({
  title: z.string().min(2).optional(),
  direction: z
    .enum(["impro", "acting", "school", "kids", "show", "playback", "other"])
    .nullable()
    .optional(),
  status: z.enum(["active", "archived"]).optional(),
  capacity: z.coerce.number().int().positive().optional(),
  action: z
    .enum(["telegram_bind_token", "telegram_unbind", "telegram_invite_all"])
    .optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Неверные данные");
  if (!(hasSupabase() && user.mode === "supabase")) {
    return jsonError("Нужен режим Supabase", 501);
  }

  try {
    if (parsed.data.action === "telegram_bind_token") {
      return jsonOk(await issueGroupTelegramBindTokenDb(id, user.tenantId));
    }
    if (parsed.data.action === "telegram_unbind") {
      return jsonOk(await unbindGroupTelegramDb(id, user.tenantId));
    }
    if (parsed.data.action === "telegram_invite_all") {
      const db = getAdminClient();
      const { data: enrollments } = await db
        .from("enrollments")
        .select("student_person_id")
        .eq("group_id", id)
        .eq("tenant_id", user.tenantId)
        .eq("status", "active");
      let sent = 0;
      for (const e of enrollments ?? []) {
        const r = await sendTelegramGroupInviteForPersonDb(e.student_person_id, {
          groupId: id,
        });
        sent += r.sent;
      }
      return jsonOk({ sent, students: enrollments?.length ?? 0 });
    }

    const { action: _a, direction, ...rest } = parsed.data;
    const patch = {
      ...rest,
      ...(direction !== undefined
        ? {
            direction:
              direction === null
                ? null
                : normalizeDirection(direction) ?? direction,
          }
        : {}),
    };
    return jsonOk(await updateGroupDb(id, user.tenantId, patch));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
