import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { validateTelegramInitData } from "@/integrations/telegram";
import { hasSupabase } from "@/lib/env";
import { getDemoState, DEMO_TENANT_ID } from "@/lib/demo-store";
import { applySessionCookies } from "@/lib/session";

const bodySchema = z.object({
  initData: z.string().min(10),
});

const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid initData");

  const result = validateTelegramInitData(parsed.data.initData);
  if (!result.ok || !result.user) {
    return jsonError("Invalid Telegram initData", 401);
  }
  if (
    result.authDate != null &&
    Math.floor(Date.now() / 1000) - result.authDate > INIT_DATA_MAX_AGE_SEC
  ) {
    return jsonError("Telegram initData expired", 401);
  }

  if (!hasSupabase()) {
    const person = getDemoState().persons[1];
    const res = jsonOk({
      personId: person.id,
      telegramUserId: result.user.id,
      mode: "demo",
    });
    return applySessionCookies(res, {
      personId: person.id,
      tenantId: DEMO_TENANT_ID,
    });
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const { getEnv } = await import("@/lib/env");
  const db = getAdminClient();
  const tenantId = getEnv().DEFAULT_TENANT_ID ?? DEMO_TENANT_ID;

  const { data: identity } = await db
    .from("telegram_identities")
    .select("*, persons(*)")
    .eq("tenant_id", tenantId)
    .eq("telegram_user_id", result.user.id)
    .maybeSingle();

  if (!identity) {
    return jsonError("Telegram account not linked. Complete registration first.", 404);
  }

  const res = jsonOk({
    personId: identity.person_id,
    telegramUserId: result.user.id,
  });
  return applySessionCookies(res, {
    personId: identity.person_id,
    tenantId,
  });
}
