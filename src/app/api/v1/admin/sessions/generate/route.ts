import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { generateSessionsFromRulesDb } from "@/domain/schedule";

const bodySchema = z.object({
  weeks: z.number().int().min(1).max(26).optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  if (!hasSupabase() || user.mode === "demo") {
    return jsonError("Generate sessions requires Supabase", 501);
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid payload");
  try {
    const result = await generateSessionsFromRulesDb(user.tenantId, {
      weeks: parsed.data.weeks ?? 8,
    });
    return jsonOk(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 500);
  }
}
