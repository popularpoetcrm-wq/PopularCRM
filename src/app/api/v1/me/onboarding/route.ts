import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import {
  completeOnboarding,
  confirmTelegramLink,
  createTelegramLinkToken,
  getWelcomePayload,
} from "@/lib/demo-onboarding";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  try {
    return jsonOk(getWelcomePayload(user.personId));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}

const completeSchema = z.object({
  acceptRules: z.boolean().default(true),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));

  if (body?.action === "telegram-token") {
    try {
      return jsonOk(createTelegramLinkToken(user.personId));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  if (body?.action === "telegram-confirm") {
    const token = z.string().min(4).safeParse(body.token);
    if (!token.success) return jsonError("token required");
    try {
      return jsonOk(
        confirmTelegramLink(token.data, {
          username: typeof body.username === "string" ? body.username : undefined,
        }),
      );
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  if (body?.action === "complete") {
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");
    try {
      return jsonOk(completeOnboarding(user.personId, parsed.data.acceptRules));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  return jsonError("Unknown action");
}
