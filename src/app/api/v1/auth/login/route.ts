import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getDemoState, DEMO_TENANT_ID } from "@/lib/demo-store";
import { getEnv, hasSupabase } from "@/lib/env";
import { markActivatedOnLogin } from "@/lib/demo-onboarding";
import { sendTelegramMessage } from "@/integrations/telegram";
import {
  findPersonByEmail,
  getPersonRoles,
  issueMagicCode,
  tenantIdOrDefault,
} from "@/lib/supabase-data";
import { getAdminClient } from "@/lib/supabase/admin";
import { applySessionCookies, clearSessionCookies } from "@/lib/session";

const bodySchema = z.object({
  email: z.string().email(),
  /** If both are linked, the client must explicitly choose a delivery channel. */
  delivery: z.enum(["email", "telegram"]).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Неверный email");

  const email = parsed.data.email.toLowerCase();

  if (!hasSupabase()) {
    const person = getDemoState().persons.find((p) => p.email.toLowerCase() === email);
    if (!person) {
      return jsonError(
        "Нет такого email в системе. Вход только по инвайту / для существующих клиентов.",
        404,
      );
    }
    markActivatedOnLogin(person.id);
    const needsWelcome =
      person.onboarding_status === "draft" ||
      person.onboarding_status === "invited" ||
      person.onboarding_status === "activated";

    const res = jsonOk({
      mode: "demo",
      message: "Demo: вход без кода",
      personId: person.id,
      roles: person.roles,
      onboarding_status: person.onboarding_status ?? "complete",
      needsWelcome,
    });
    return applySessionCookies(res, {
      personId: person.id,
      tenantId: DEMO_TENANT_ID,
    });
  }

  try {
    const env = getEnv();
    const tenantId = tenantIdOrDefault(env.DEFAULT_TENANT_ID);
    const person = await findPersonByEmail(email, tenantId);
    if (!person) {
      return jsonError("Нет аккаунта с этим email. Нужен инвайт от студии.", 404);
    }

    const roles = await getPersonRoles(person.id);
    const db = getAdminClient();
    const { data: tg } = await db
      .from("telegram_identities")
      .select("chat_id")
      .eq("person_id", person.id)
      .maybeSingle();

    const availableChannels: Array<"email" | "telegram"> = [];
    if (env.RESEND_API_KEY) availableChannels.push("email");
    if (tg?.chat_id && env.TELEGRAM_BOT_TOKEN) availableChannels.push("telegram");

    if (!parsed.data.delivery && availableChannels.length > 1) {
      return jsonOk({
        mode: "choose_delivery",
        message: "Куда прислать код?",
        availableChannels,
        personId: person.id,
        roles,
        onboarding_status: person.onboarding_status ?? "complete",
      });
    }

    if (
      parsed.data.delivery &&
      !availableChannels.includes(parsed.data.delivery)
    ) {
      return jsonError("Этот способ входа сейчас недоступен", 400);
    }

    const delivery = parsed.data.delivery ?? availableChannels[0];
    const allowDebugOtp =
      process.env.NODE_ENV !== "production" &&
      process.env.ALLOW_DEBUG_OTP === "true";
    if (!delivery) {
      const code = await issueMagicCode(email, person.tenant_id);
      return jsonOk({
        mode: "magic",
        message:
          "Не удалось отправить код: не настроены почта и Telegram. Попроси администратора помочь.",
        delivered: [],
        availableChannels,
        personId: person.id,
        roles,
        onboarding_status: person.onboarding_status ?? "complete",
        debugCode: allowDebugOtp ? code : undefined,
      });
    }

    const code = await issueMagicCode(email, person.tenant_id);

    const delivered: Array<"email" | "telegram"> = [];

    if (delivery === "email") {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({
          from: env.EMAIL_FROM!,
          to: email,
          subject: "Код входа — Popular Poet",
          text: `Твой код входа: ${code}\n\nДействует 15 минут. Если ты не запрашивал вход — просто проигнорируй.`,
        });
        delivered.push("email");
      } catch (e) {
        console.error("[auth/login] email send failed", e);
      }
    }

    if (delivery === "telegram" && tg?.chat_id && env.TELEGRAM_BOT_TOKEN) {
      try {
        await sendTelegramMessage({
          chatId: tg.chat_id as number,
          text:
            `Код входа в кабинет: ${code}\n` +
            `Действует 15 минут. Никому не пересылай.`,
        });
        delivered.push("telegram");
      } catch (e) {
        console.error("[auth/login] telegram send failed", e);
      }
    }

    const channels = delivered.includes("email") ? "почту" : "Telegram";

    const message = delivered.length
      ? `Код из 6 цифр отправлен в ${channels}. Введи его ниже.`
      : `Не удалось отправить код в ${delivery === "email" ? "почту" : "Telegram"}. Выбери другой способ или попробуй позже.`;

    if (!delivered.length && availableChannels.length > 1) {
      return jsonOk({
        mode: "choose_delivery",
        message,
        availableChannels: availableChannels.filter((channel) => channel !== delivery),
        personId: person.id,
        roles,
        onboarding_status: person.onboarding_status ?? "complete",
      });
    }

    return jsonOk({
      mode: "magic",
      message,
      delivered,
      availableChannels,
      personId: person.id,
      roles,
      onboarding_status: person.onboarding_status ?? "complete",
      // Never leak OTP in production / default deploys
      debugCode: allowDebugOtp && delivered.length === 0 ? code : undefined,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "login fail", 500);
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  return clearSessionCookies(res);
}
