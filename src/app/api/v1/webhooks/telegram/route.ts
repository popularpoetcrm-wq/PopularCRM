import { verifyWebhookSecret, sendTelegramMessage } from "@/integrations/telegram";
import { jsonOk, jsonError } from "@/lib/api";
import { getEnv, hasSupabase } from "@/lib/env";

type TgUpdate = {
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
  };
};

function appUrl() {
  return (getEnv().NEXT_PUBLIC_APP_URL || "https://popularcrm.vercel.app").replace(
    /\/$/,
    "",
  );
}

function cmd(text: string) {
  return text.replace(/@\w+/g, "").trim().toLowerCase();
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyWebhookSecret(secret)) return jsonError("Unauthorized", 401);

  const update = (await req.json()) as TgUpdate;
  const raw = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat.id;
  const from = update.message?.from;
  if (!chatId) return jsonOk({ ignored: true });

  const text = cmd(raw);

  if (raw.startsWith("/start")) {
    const payload = raw.replace(/^\/start(@\w+)?\s*/, "").trim();
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
            `Готово — Telegram привязан${result.username ? ` (@${result.username})` : ""}.\n\n` +
            `Команды:\n/login — ссылка в кабинет\n/balance — пакет и долг\n/groups — мои группы\n/start — статус`,
        });
        return jsonOk({ handled: "link", person_id: result.person_id });
      } catch (e) {
        await sendTelegramMessage({
          chatId,
          text:
            `Не удалось привязать: ${e instanceof Error ? e.message : "ошибка"}.\n` +
            `Открой свежую ссылку из ЛК (Профиль → Telegram).`,
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
        await sendTelegramMessage({ chatId, text: "Telegram привязан (demo)." });
        return jsonOk({ handled: "link_demo" });
      } catch (e) {
        await sendTelegramMessage({
          chatId,
          text: e instanceof Error ? e.message : "link fail",
        });
        return jsonOk({ handled: "link_failed" });
      }
    }

    // Linked user → personal status; else generic help with PROD cabinet URL
    if (from && hasSupabase()) {
      try {
        const { getBotStatusForTelegramUserDb } = await import(
          "@/lib/supabase-onboarding"
        );
        const st = await getBotStatusForTelegramUserDb(from.id);
        if (st) {
          const groups = (st.groups as Array<{ subtitle?: string; title: string }>)
            .map((g) => `· ${g.subtitle || g.title}`)
            .join("\n");
          const next = st.nextSession
            ? `\nБлижайшее: ${st.nextSession.title}`
            : "";
          await sendTelegramMessage({
            chatId,
            text:
              `Привет, ${st.person.full_name}!\n` +
              `Кабинет: ${appUrl()}/cabinet\n\n` +
              `${st.money?.label ?? "—"}${next}\n\n` +
              (groups ? `Группы:\n${groups}\n\n` : "") +
              `/login — войти по ссылке\n/balance · /groups`,
          });
          return jsonOk({ handled: "start_linked" });
        }
      } catch {
        /* fall through */
      }
    }

    await sendTelegramMessage({
      chatId,
      text:
        `Привет! Бот студии Popular Poet.\n\n` +
        `Кабинет: ${appUrl()}/cabinet\n` +
        `Вход: ${appUrl()}/login\n\n` +
        `Если ты уже ученик — привяжи Telegram из ЛК (Профиль), ` +
        `потом здесь будут /login и напоминания.`,
    });
    return jsonOk({ handled: "start" });
  }

  if ((text.startsWith("/login") || text.startsWith("/kabinet")) && from) {
    if (!hasSupabase()) {
      await sendTelegramMessage({ chatId, text: "Нужен режим Supabase." });
      return jsonOk({ handled: "login_demo" });
    }
    try {
      const { issueLoginLinkForTelegramUserDb } = await import(
        "@/lib/supabase-onboarding"
      );
      const inv = await issueLoginLinkForTelegramUserDb(from.id);
      await sendTelegramMessage({
        chatId,
        text:
          `Вход в кабинет (7 дней):\n${inv.magicUrl}\n\n` +
          `Или ${appUrl()}/login` +
          (inv.person.email && !String(inv.person.email).endsWith("@cabinet.local")
            ? ` → ${inv.person.email}`
            : ""),
      });
      return jsonOk({ handled: "login" });
    } catch (e) {
      await sendTelegramMessage({
        chatId,
        text:
          `${e instanceof Error ? e.message : "Ошибка"}\n` +
          `Сначала привяжи бота из ЛК или зайди по email: ${appUrl()}/login`,
      });
      return jsonOk({ handled: "login_failed" });
    }
  }

  if (text.startsWith("/balance") && from && hasSupabase()) {
    try {
      const { getBotStatusForTelegramUserDb } = await import(
        "@/lib/supabase-onboarding"
      );
      const st = await getBotStatusForTelegramUserDb(from.id);
      if (!st) {
        await sendTelegramMessage({
          chatId,
          text: `Telegram не привязан. Кабинет: ${appUrl()}/login`,
        });
        return jsonOk({ handled: "balance_unlinked" });
      }
      const pkg = (st.packages as Array<{ credits_available: number; credits_total: number }>)[0];
      const pkgLine = pkg
        ? `Пакет: ${pkg.credits_available}/${pkg.credits_total}`
        : "Активного пакета нет";
      await sendTelegramMessage({
        chatId,
        text:
          `${st.money?.label ?? "—"}\n${pkgLine}\n\n` +
          `Подробнее: ${appUrl()}/cabinet/payments`,
      });
      return jsonOk({ handled: "balance" });
    } catch (e) {
      await sendTelegramMessage({
        chatId,
        text: e instanceof Error ? e.message : "balance fail",
      });
      return jsonOk({ handled: "balance_error" });
    }
  }

  if ((text.startsWith("/groups") || text.startsWith("/group")) && from && hasSupabase()) {
    try {
      const { getBotStatusForTelegramUserDb } = await import(
        "@/lib/supabase-onboarding"
      );
      const st = await getBotStatusForTelegramUserDb(from.id);
      if (!st) {
        await sendTelegramMessage({
          chatId,
          text: "Сначала /login или привязка из ЛК.",
        });
        return jsonOk({ handled: "groups_unlinked" });
      }
      const lines = (st.groups as Array<{ title: string; subtitle?: string }>)
        .map((g) => `· ${g.subtitle || g.title}`)
        .join("\n");
      await sendTelegramMessage({
        chatId,
        text: lines || "Пока нет активных групп.",
      });
      return jsonOk({ handled: "groups" });
    } catch (e) {
      await sendTelegramMessage({
        chatId,
        text: e instanceof Error ? e.message : "groups fail",
      });
      return jsonOk({ handled: "groups_error" });
    }
  }

  await sendTelegramMessage({
    chatId,
    text:
      `Команды:\n/start — статус\n/login — ссылка в кабинет\n` +
      `/balance — пакет/долг\n/groups — группы\n\n` +
      `Ве: ${appUrl()}/cabinet`,
  });
  return jsonOk({ handled: "fallback" });
}
