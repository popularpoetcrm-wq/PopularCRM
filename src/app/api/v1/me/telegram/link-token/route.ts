import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import {
  confirmTelegramLink,
  createTelegramLinkToken,
} from "@/lib/demo-onboarding";
import {
  confirmTelegramLinkDb,
  createTelegramLinkTokenDb,
} from "@/lib/supabase-onboarding";

/** Issue deep-link token to bind Telegram. */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  try {
    if (hasSupabase() && user.mode === "supabase") {
      return jsonOk(await createTelegramLinkTokenDb(user.personId));
    }
    return jsonOk(createTelegramLinkToken(user.personId));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}

const confirmSchema = z.object({
  token: z.string().min(4),
  telegram_user_id: z.number().optional(),
  username: z.string().optional(),
  chat_id: z.number().optional(),
});

/** Confirm bind (dev / fallback without webhook). */
export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const parsed = confirmSchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");
  try {
    if (hasSupabase() && user.mode === "supabase") {
      return jsonOk(await confirmTelegramLinkDb(parsed.data.token, parsed.data));
    }
    return jsonOk(confirmTelegramLink(parsed.data.token, parsed.data));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
