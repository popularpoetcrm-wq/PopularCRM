import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import {
  completeOnboarding,
  confirmTelegramLink,
  createTelegramLinkToken,
  getWelcomePayload,
} from "@/lib/demo-onboarding";
import {
  completeOnboardingDb,
  confirmTelegramLinkDb,
  createTelegramLinkTokenDb,
  getWelcomePayloadDb,
  updatePersonProfileDb,
} from "@/lib/supabase-onboarding";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  try {
    if (hasSupabase() && user.mode === "supabase") {
      return jsonOk(await getWelcomePayloadDb(user.personId));
    }
    return jsonOk(getWelcomePayload(user.personId));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const profileSchema = z.object({
  full_name: z.string().min(2).optional(),
  phone: z.preprocess(emptyToNull, z.string().nullable().optional()),
  email: z.preprocess(
    emptyToNull,
    z.string().email().nullable().optional(),
  ),
  birth_date: z.preprocess(emptyToNull, z.string().nullable().optional()),
  tshirt_size: z.preprocess(emptyToNull, z.string().nullable().optional()),
  telegram_username: z.preprocess(
    emptyToNull,
    z.string().nullable().optional(),
  ),
});

const completeSchema = z.object({
  action: z.literal("complete"),
  acceptRules: z.boolean().default(true),
  acceptPhoto: z.boolean().default(true),
  profile: profileSchema.optional(),
  children: z
    .array(
      profileSchema.extend({
        id: z.string().min(1),
        full_name: z.string().min(1).optional(),
      }),
    )
    .optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));
  const sb = hasSupabase() && user.mode === "supabase";

  if (body?.action === "telegram-token") {
    try {
      if (sb) return jsonOk(await createTelegramLinkTokenDb(user.personId));
      return jsonOk(createTelegramLinkToken(user.personId));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  if (body?.action === "telegram-confirm") {
    const token = z.string().min(4).safeParse(body.token);
    if (!token.success) return jsonError("token required");
    try {
      if (sb) {
        return jsonOk(
          await confirmTelegramLinkDb(token.data, {
            username:
              typeof body.username === "string" ? body.username : undefined,
          }),
        );
      }
      return jsonOk(
        confirmTelegramLink(token.data, {
          username: typeof body.username === "string" ? body.username : undefined,
        }),
      );
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  if (body?.action === "save-profile") {
    const parsed = profileSchema.safeParse(body.profile ?? body);
    if (!parsed.success) return jsonError("Invalid profile");
    try {
      if (sb) {
        const data = await updatePersonProfileDb(user.personId, parsed.data);
        return jsonOk(data.person);
      }
      return jsonError("Demo profile save not wired", 501);
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  if (body?.action === "complete") {
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip");
    const userAgent = req.headers.get("user-agent");
    try {
      if (sb) {
        return jsonOk(
          await completeOnboardingDb(user.personId, {
            acceptRules: parsed.data.acceptRules,
            acceptPhoto: parsed.data.acceptPhoto,
            profile: parsed.data.profile,
            children: parsed.data.children,
            ip,
            userAgent,
          }),
        );
      }
      return jsonOk(completeOnboarding(user.personId, parsed.data.acceptRules));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  return jsonError("Unknown action");
}
