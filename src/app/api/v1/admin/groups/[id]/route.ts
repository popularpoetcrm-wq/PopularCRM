import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { getGroupDetailDb, updateGroupDb } from "@/lib/supabase-data";
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
    return jsonOk(await updateGroupDb(id, user.tenantId, parsed.data));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
