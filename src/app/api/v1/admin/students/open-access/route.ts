import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { openCabinetAccessDb } from "@/lib/supabase-onboarding";

const schema = z.object({
  sendTelegram: z.boolean().optional(),
  personIds: z.array(z.string()).optional(),
});

/** Bulk: activate email logins + push magic links to linked Telegram. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);
  if (!(hasSupabase() && user.mode === "supabase")) {
    return jsonError("Только в режиме Supabase", 501);
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid payload");

  try {
    const result = await openCabinetAccessDb({
      actorId: user.personId,
      sendTelegram: parsed.data.sendTelegram,
      onlyPersonIds: parsed.data.personIds,
    });
    return jsonOk(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 500);
  }
}
