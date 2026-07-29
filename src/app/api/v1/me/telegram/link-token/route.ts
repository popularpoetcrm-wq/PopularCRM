import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import {
  confirmTelegramLink,
  createTelegramLinkToken,
} from "@/lib/demo-onboarding";

/** Issue deep-link token to bind Telegram. */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  try {
    return jsonOk(createTelegramLinkToken(user.personId));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}

const confirmSchema = z.object({
  token: z.string().min(4),
  telegram_user_id: z.number().optional(),
  username: z.string().optional(),
});

/** Demo: confirm bind without real bot webhook. */
export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const parsed = confirmSchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");
  try {
    return jsonOk(confirmTelegramLink(parsed.data.token, parsed.data));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
