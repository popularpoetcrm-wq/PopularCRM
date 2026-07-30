import {
  verifyWebhookSecret,
  sendTelegramMessage,
  answerCallbackQuery,
  mainMenuKeyboard,
} from "@/integrations/telegram";
import { jsonOk, jsonError } from "@/lib/api";
import { getEnv, hasSupabase } from "@/lib/env";

type TgUser = { id: number; username?: string; first_name?: string };

type TgUpdate = {
  message?: {
    chat: { id: number; type: string };
    from?: TgUser;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: TgUser;
    data?: string;
    message?: { chat: { id: number } };
  };
};

function appUrl() {
  return (getEnv().NEXT_PUBLIC_APP_URL || "https://popularcrm.vercel.app").replace(
    /\/$/,
    "",
  );
}

function menu() {
  return mainMenuKeyboard({
    cabinetUrl: `${appUrl()}/cabinet`,
    loginUrl: `${appUrl()}/login`,
  });
}

function cmd(text: string) {
  return text.replace(/@\w+/g, "").trim().toLowerCase();
}

async function handleLogin(chatId: number, from: TgUser) {
  if (!hasSupabase()) {
    await sendTelegramMessage({
      chatId,
      text: "Нужен режим Supabase.",
      replyMarkup: menu(),
    });
    return "login_demo";
  }
  try {
    const { issueLoginLinkForTelegramUserDb } = await import(
      "@/lib/supabase-onboarding"
    );
    const inv = await issueLoginLinkForTelegramUserDb(from.id);
    await sendTelegramMessage({
      chatId,
      text:
        `Вход в кабинет (7 дней).\n` +
        (inv.person.email && !String(inv.person.email).endsWith("@cabinet.local")
          ? `Аккаунт: ${inv.person.email}\n`
          : "") +
        `Или открой страницу входа.`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: "Открыть кабинет", url: inv.magicUrl }],
          [
            { text: "Страница входа", url: `${appUrl()}/login` },
            { text: "Баланс", callback_data: "balance" },
          ],
        ],
      },
    });
    return "login";
  } catch (e) {
    await sendTelegramMessage({
      chatId,
      text:
        `${e instanceof Error ? e.message : "Ошибка"}\n` +
        `Сначала привяжи бота из кабинета (Профиль → Telegram) или зайди по email.`,
      replyMarkup: menu(),
    });
    return "login_failed";
  }
}

async function handleBalance(chatId: number, from: TgUser) {
  if (!hasSupabase()) {
    await sendTelegramMessage({ chatId, text: "Нужен режим Supabase.", replyMarkup: menu() });
    return "balance_demo";
  }
  try {
    const { getBotStatusForTelegramUserDb } = await import(
      "@/lib/supabase-onboarding"
    );
    const st = await getBotStatusForTelegramUserDb(from.id);
    if (!st) {
      await sendTelegramMessage({
        chatId,
        text: "Telegram ещё не привязан. Открой вход или привяжи из кабинета.",
        replyMarkup: menu(),
      });
      return "balance_unlinked";
    }
    const pkg = (st.packages as Array<{ credits_available: number; credits_total: number }>)[0];
    const pkgLine = pkg
      ? `Пакет: ${pkg.credits_available}/${pkg.credits_total}`
      : "Активного пакета нет";
    await sendTelegramMessage({
      chatId,
      text: `${st.money?.label ?? "—"}\n${pkgLine}`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: "Оплаты в кабинете", url: `${appUrl()}/cabinet/payments` }],
          [
            { text: "Войти", callback_data: "login" },
            { text: "Группы", callback_data: "groups" },
          ],
        ],
      },
    });
    return "balance";
  } catch (e) {
    await sendTelegramMessage({
      chatId,
      text: e instanceof Error ? e.message : "Ошибка баланса",
      replyMarkup: menu(),
    });
    return "balance_error";
  }
}

async function handleGroups(chatId: number, from: TgUser) {
  if (!hasSupabase()) {
    await sendTelegramMessage({ chatId, text: "Нужен режим Supabase.", replyMarkup: menu() });
    return "groups_demo";
  }
  try {
    const { getBotStatusForTelegramUserDb } = await import(
      "@/lib/supabase-onboarding"
    );
    const st = await getBotStatusForTelegramUserDb(from.id);
    if (!st) {
      await sendTelegramMessage({
        chatId,
        text: "Сначала войди или привяжи Telegram из кабинета.",
        replyMarkup: menu(),
      });
      return "groups_unlinked";
    }
    const lines = (st.groups as Array<{ title: string; subtitle?: string }>)
      .map((g) => `· ${g.subtitle ? `${g.title} — ${g.subtitle}` : g.title}`)
      .join("\n");
    await sendTelegramMessage({
      chatId,
      text: lines || "Пока нет активных групп.",
      replyMarkup: menu(),
    });
    return "groups";
  } catch (e) {
    await sendTelegramMessage({
      chatId,
      text: e instanceof Error ? e.message : "Ошибка групп",
      replyMarkup: menu(),
    });
    return "groups_error";
  }
}

async function handleStart(chatId: number, from: TgUser | undefined, raw: string) {
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
          `Готово — Telegram привязан${result.username ? ` (@${result.username})` : ""}.\n` +
          `Жми кнопки ниже.`,
        replyMarkup: menu(),
      });
      return "link";
    } catch (e) {
      await sendTelegramMessage({
        chatId,
        text:
          `Не удалось привязать: ${e instanceof Error ? e.message : "ошибка"}.\n` +
          `Открой свежую ссылку из кабинета (Профиль → Telegram).`,
        replyMarkup: menu(),
      });
      return "link_failed";
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
        replyMarkup: menu(),
      });
      return "link_demo";
    } catch (e) {
      await sendTelegramMessage({
        chatId,
        text: e instanceof Error ? e.message : "не удалось привязать",
        replyMarkup: menu(),
      });
      return "link_failed";
    }
  }

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
            `${st.money?.label ?? "—"}${next}\n` +
            (groups ? `\nГруппы:\n${groups}` : ""),
          replyMarkup: menu(),
        });
        return "start_linked";
      }
    } catch {
      /* fall through */
    }
  }

  await sendTelegramMessage({
    chatId,
    text:
      `Привет! Бот студии Popular Poet.\n\n` +
      `Если ты уже ученик — привяжи Telegram из кабинета (Профиль), ` +
      `потом здесь будут вход и напоминания.`,
    replyMarkup: menu(),
  });
  return "start";
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyWebhookSecret(secret)) return jsonError("Unauthorized", 401);

  const update = (await req.json()) as TgUpdate;

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    if (!chatId) return jsonOk({ ignored: true });
    const data = (cq.data ?? "").toLowerCase();
    await answerCallbackQuery({ callbackQueryId: cq.id });

    if (data === "login") {
      return jsonOk({ handled: await handleLogin(chatId, cq.from) });
    }
    if (data === "balance") {
      return jsonOk({ handled: await handleBalance(chatId, cq.from) });
    }
    if (data === "groups") {
      return jsonOk({ handled: await handleGroups(chatId, cq.from) });
    }
    await sendTelegramMessage({
      chatId,
      text: "Выбери действие на кнопках ниже.",
      replyMarkup: menu(),
    });
    return jsonOk({ handled: "callback_unknown" });
  }

  const raw = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat.id;
  const from = update.message?.from;
  if (!chatId) return jsonOk({ ignored: true });

  const text = cmd(raw);

  if (raw.startsWith("/start")) {
    return jsonOk({ handled: await handleStart(chatId, from, raw) });
  }

  if ((text.startsWith("/login") || text.startsWith("/kabinet")) && from) {
    return jsonOk({ handled: await handleLogin(chatId, from) });
  }

  if (text.startsWith("/balance") && from) {
    return jsonOk({ handled: await handleBalance(chatId, from) });
  }

  if ((text.startsWith("/groups") || text.startsWith("/group")) && from) {
    return jsonOk({ handled: await handleGroups(chatId, from) });
  }

  await sendTelegramMessage({
    chatId,
    text: "Жми кнопки ниже или команды /start · /login · /balance · /groups",
    replyMarkup: menu(),
  });
  return jsonOk({ handled: "fallback" });
}
