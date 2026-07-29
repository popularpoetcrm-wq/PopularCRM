import { verifyWebhookSecret, sendTelegramMessage } from "@/integrations/telegram";
import { jsonOk, jsonError } from "@/lib/api";
import { getEnv, hasSupabase } from "@/lib/env";
import { DEMO_TENANT_ID } from "@/lib/demo-store";

type TgUpdate = {
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
  };
};

export async function POST(req: Request) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyWebhookSecret(secret)) return jsonError("Unauthorized", 401);

  const update = (await req.json()) as TgUpdate;
  const text = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat.id;
  const from = update.message?.from;

  if (!chatId) return jsonOk({ ignored: true });

  if (text.startsWith("/start")) {
    const payload = text.replace(/^\/start(@\w+)?\s*/, "").trim();
    const linkMatch = payload.match(/^link[_-](.+)$/i);

    if (linkMatch && from && hasSupabase()) {
      try {
        const { confirmTelegramLinkDb } = await import("@/lib/supabase-onboarding");
        const result = await confirmTelegramLinkDb(linkMatch[1], {
          telegram_user_id: from.id,
          username: from.username,
          chat_id: chatId,
        });
        await sendTelegramMessage({
          chatId,
          text:
            `Готово — Telegram привязан к кабинету${result.username ? ` (@${result.username})` : ""}.\n` +
            `Напоминания о занятиях будут приходить сюда.`,
        });
        return jsonOk({ handled: "link", person_id: result.person_id });
      } catch (e) {
        await sendTelegramMessage({
          chatId,
          text:
            `Не удалось привязать: ${e instanceof Error ? e.message : "ошибка"}.\n` +
            `Открой свежую ссылку из личного кабинета.`,
        });
        return jsonOk({ handled: "link_failed" });
      }
    }

    if (linkMatch && from && !hasSupabase()) {
      try {
        const { confirmTelegramLink } = await import("@/lib/demo-onboarding");
        confirmTelegramLink(linkMatch[1], {
          telegram_user_id: from.id,
          username: from.username,
        });
        await sendTelegramMessage({
          chatId,
          text: "Telegram привязан (demo).",
        });
        return jsonOk({ handled: "link_demo" });
      } catch (e) {
        await sendTelegramMessage({
          chatId,
          text: e instanceof Error ? e.message : "link fail",
        });
        return jsonOk({ handled: "link_failed" });
      }
    }

    const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
    await sendTelegramMessage({
      chatId,
      text:
        `Привет! Это бот студии Popular Poet.\n` +
        `Кабинет: ${appUrl}/cabinet\n` +
        `Чтобы привязать аккаунт — нажми ссылку из ЛК (Профиль → Telegram).`,
    });
    return jsonOk({ handled: "start" });
  }

  if (text.startsWith("/balance") && from && hasSupabase()) {
    const { getAdminClient } = await import("@/lib/supabase/admin");
    const db = getAdminClient();
    const tenantId = getEnv().DEFAULT_TENANT_ID ?? DEMO_TENANT_ID;
    const { data: identity } = await db
      .from("telegram_identities")
      .select("person_id")
      .eq("tenant_id", tenantId)
      .eq("telegram_user_id", from.id)
      .maybeSingle();

    if (!identity) {
      await sendTelegramMessage({
        chatId,
        text: "Telegram ещё не привязан. Открой ссылку из личного кабинета.",
      });
      return jsonOk({ handled: "balance_unlinked" });
    }

    const { data: packages } = await db
      .from("student_packages")
      .select("id, status, lesson_credits(status)")
      .eq("status", "active");

    await sendTelegramMessage({
      chatId,
      text: `Активные пакеты: ${(packages ?? []).length}. Подробности в кабинете.`,
    });
    return jsonOk({ handled: "balance" });
  }

  await sendTelegramMessage({
    chatId,
    text: "Команды: /start · /balance. Основное — в веб-кабинете.",
  });
  return jsonOk({ handled: "fallback" });
}
