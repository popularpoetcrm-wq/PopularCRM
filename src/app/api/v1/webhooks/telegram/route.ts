import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  verifyWebhookSecret,
  sendTelegramMessage,
  answerCallbackQuery,
  mainReplyKeyboard,
  openCabinetKeyboard,
  openLoginKeyboard,
  BOT_MENU,
  escapeHtml,
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

function kb() {
  return mainReplyKeyboard();
}

function cmd(text: string) {
  return text.replace(/@\w+/g, "").trim().toLowerCase();
}

function normBtn(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function matchMenu(raw: string): string | null {
  const n = normBtn(raw);
  const entries = Object.entries(BOT_MENU) as Array<[string, string]>;
  for (const [key, label] of entries) {
    if (n === normBtn(label)) return key;
  }
  // tolerate emoji-less / old labels
  if (n === "главная" || n === "меню" || n === "start") return "home";
  if (n === "занятия" || n === "расписание") return "schedule";
  if (n === "баланс" || n === "пакет") return "balance";
  if (n === "группы" || n === "группа") return "groups";
  if (n === "кабинет" || n === "войти" || n === "вход") return "cabinet";
  if (n === "помощь" || n === "help") return "help";
  return null;
}

function fmtWhen(iso: string) {
  try {
    return format(new Date(iso), "EEEE, d MMM · HH:mm", { locale: ru });
  } catch {
    return iso;
  }
}

function firstName(full: string) {
  return escapeHtml(full.split(/\s+/)[0] || full);
}

async function handleCabinet(chatId: number, from: TgUser) {
  if (!hasSupabase()) {
    await sendTelegramMessage({
      chatId,
      text: "Нужен режим Supabase.",
      replyMarkup: kb(),
    });
    return "cabinet_demo";
  }
  try {
    const { issueLoginLinkForTelegramUserDb } = await import(
      "@/lib/supabase-onboarding"
    );
    const inv = await issueLoginLinkForTelegramUserDb(from.id);
    const email =
      inv.person.email && !String(inv.person.email).endsWith("@cabinet.local")
        ? escapeHtml(String(inv.person.email))
        : null;
    await sendTelegramMessage({
      chatId,
      text:
        `<b>Вход в кабинет</b>\n` +
        `Ссылка действует 7 дней — сразу откроет личный кабинет.\n` +
        (email ? `\nАккаунт: <code>${email}</code>` : ""),
      parseMode: "HTML",
      replyMarkup: openCabinetKeyboard(inv.magicUrl),
    });
    return "cabinet";
  } catch (e) {
    await sendTelegramMessage({
      chatId,
      text:
        `<b>Telegram ещё не привязан</b>\n\n` +
        `${escapeHtml(e instanceof Error ? e.message : "Ошибка")}\n\n` +
        `1. Войди на сайте по email\n` +
        `2. Профиль → привяжи Telegram\n` +
        `3. Вернись сюда и жми «Кабинет»`,
      parseMode: "HTML",
      replyMarkup: openLoginKeyboard(`${appUrl()}/login`),
    });
    return "cabinet_unlinked";
  }
}

async function handleBalance(chatId: number, from: TgUser) {
  if (!hasSupabase()) {
    await sendTelegramMessage({
      chatId,
      text: "Нужен режим Supabase.",
      replyMarkup: kb(),
    });
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
        text:
          `<b>Баланс</b>\nTelegram не привязан.\n` +
          `Жми «Кабинет» или привяжи бота в профиле на сайте.`,
        replyMarkup: kb(),
      });
      return "balance_unlinked";
    }
    const pkg = (
      st.packages as Array<{ credits_available: number; credits_total: number }>
    )[0];
    const pkgLine = pkg
      ? `Пакет: <b>${pkg.credits_available}</b> из ${pkg.credits_total}`
      : "Активного пакета нет";
    const makeups =
      st.makeupsAvailable > 0
        ? `\nОтработки: <b>${st.makeupsAvailable}</b>`
        : "";
    await sendTelegramMessage({
      chatId,
      text:
        `<b>Баланс</b>\n` +
        `${escapeHtml(st.money?.label ?? "—")}\n` +
        `${pkgLine}${makeups}`,
      replyMarkup: kb(),
    });
    return "balance";
  } catch (e) {
    await sendTelegramMessage({
      chatId,
      text: escapeHtml(e instanceof Error ? e.message : "Ошибка баланса"),
      replyMarkup: kb(),
    });
    return "balance_error";
  }
}

async function handleGroups(chatId: number, from: TgUser) {
  if (!hasSupabase()) {
    await sendTelegramMessage({
      chatId,
      text: "Нужен режим Supabase.",
      replyMarkup: kb(),
    });
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
        text: `<b>Группы</b>\nСначала привяжи Telegram (Профиль на сайте).`,
        replyMarkup: kb(),
      });
      return "groups_unlinked";
    }
    const lines = (st.groups as Array<{ title: string; subtitle?: string }>)
      .map((g) =>
        g.subtitle && g.subtitle !== g.title
          ? `· <b>${escapeHtml(g.title)}</b>\n  <i>${escapeHtml(g.subtitle)}</i>`
          : `· <b>${escapeHtml(g.title)}</b>`,
      )
      .join("\n");
    await sendTelegramMessage({
      chatId,
      text: lines ? `<b>Твои группы</b>\n${lines}` : "<b>Группы</b>\nПока нет активных.",
      replyMarkup: kb(),
    });
    return "groups";
  } catch (e) {
    await sendTelegramMessage({
      chatId,
      text: escapeHtml(e instanceof Error ? e.message : "Ошибка групп"),
      replyMarkup: kb(),
    });
    return "groups_error";
  }
}

async function handleSchedule(chatId: number, from: TgUser) {
  if (!hasSupabase()) {
    await sendTelegramMessage({
      chatId,
      text: "Нужен режим Supabase.",
      replyMarkup: kb(),
    });
    return "schedule_demo";
  }
  try {
    const { getBotStatusForTelegramUserDb } = await import(
      "@/lib/supabase-onboarding"
    );
    const st = await getBotStatusForTelegramUserDb(from.id);
    if (!st) {
      await sendTelegramMessage({
        chatId,
        text: `<b>Занятия</b>\nСначала привяжи Telegram из кабинета.`,
        replyMarkup: kb(),
      });
      return "schedule_unlinked";
    }
    const items = (st.schedule ?? []) as Array<{
      title: string;
      starts_at: string;
      myStatus?: string | null;
    }>;
    if (!items.length) {
      await sendTelegramMessage({
        chatId,
        text: "<b>Занятия</b>\nПока нет ближайших в расписании.",
        replyMarkup: kb(),
      });
      return "schedule_empty";
    }
    const lines = items
      .map((s) => {
        const skipped =
          s.myStatus === "absent_notified" || s.myStatus === "absent";
        const mark = skipped ? " · <i>не приду</i>" : "";
        return `· <b>${escapeHtml(s.title)}</b>\n  ${escapeHtml(fmtWhen(s.starts_at))}${mark}`;
      })
      .join("\n\n");
    await sendTelegramMessage({
      chatId,
      text:
        `<b>Ближайшие занятия</b>\n\n${lines}\n\n` +
        `<i>«Не приду» и отработки — в кабинете.</i>`,
      replyMarkup: kb(),
    });
    return "schedule";
  } catch (e) {
    await sendTelegramMessage({
      chatId,
      text: escapeHtml(e instanceof Error ? e.message : "Ошибка расписания"),
      replyMarkup: kb(),
    });
    return "schedule_error";
  }
}

async function handleHelp(chatId: number) {
  await sendTelegramMessage({
    chatId,
    text:
      `<b>Как пользоваться ботом</b>\n\n` +
      `${BOT_MENU.home} — сводка\n` +
      `${BOT_MENU.schedule} — ближайшие занятия\n` +
      `${BOT_MENU.balance} — пакет и оплаты\n` +
      `${BOT_MENU.groups} — твои группы\n` +
      `${BOT_MENU.cabinet} — одна ссылка в личный кабинет\n\n` +
      `Если Telegram не привязан: зайди на сайт → Профиль → привяжи бота.`,
    replyMarkup: kb(),
  });
  return "help";
}

async function handleHome(chatId: number, from: TgUser | undefined) {
  if (from && hasSupabase()) {
    try {
      const { getBotStatusForTelegramUserDb } = await import(
        "@/lib/supabase-onboarding"
      );
      const st = await getBotStatusForTelegramUserDb(from.id);
      if (st) {
        const pkg = (
          st.packages as Array<{
            credits_available: number;
            credits_total: number;
          }>
        )[0];
        const pkgLine = pkg
          ? `Пакет: <b>${pkg.credits_available}</b> из ${pkg.credits_total}`
          : "Пакета пока нет";
        const next = st.nextSession
          ? `\n\n📅 <b>Ближайшее</b>\n${escapeHtml(st.nextSession.title)}\n${escapeHtml(fmtWhen(st.nextSession.starts_at))}`
          : "";
        const groups = (st.groups as Array<{ title: string; subtitle?: string }>)
          .map((g) => `· ${escapeHtml(g.subtitle || g.title)}`)
          .join("\n");
        const makeups =
          st.makeupsAvailable > 0
            ? `\nОтработки: <b>${st.makeupsAvailable}</b>`
            : "";
        await sendTelegramMessage({
          chatId,
          text:
            `<b>Привет, ${firstName(st.person.full_name)}!</b>\n\n` +
            `${escapeHtml(st.money?.label ?? "—")}\n` +
            `${pkgLine}${makeups}` +
            next +
            (groups ? `\n\n🎭 <b>Группы</b>\n${groups}` : "") +
            `\n\n<i>Меню внизу экрана</i>`,
          replyMarkup: kb(),
        });
        return "home_linked";
      }
    } catch {
      /* fall through */
    }
  }

  await sendTelegramMessage({
    chatId,
    text:
      `<b>Popular Poet</b>\n\n` +
      `Бот студии: баланс, занятия и быстрый вход в кабинет.\n\n` +
      `Если ты уже ученик — привяжи Telegram в кабинете (Профиль), ` +
      `потом жми кнопки внизу.`,
    replyMarkup: kb(),
  });
  return "home";
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
          `<b>Готово</b> — Telegram привязан` +
          `${result.username ? ` (@${escapeHtml(result.username)})` : ""}.\n` +
          `Пользуйся меню внизу 👇`,
        replyMarkup: kb(),
      });
      return "link";
    } catch (e) {
      await sendTelegramMessage({
        chatId,
        text:
          `Не удалось привязать: ${escapeHtml(e instanceof Error ? e.message : "ошибка")}.\n` +
          `Открой свежую ссылку из кабинета (Профиль → Telegram).`,
        replyMarkup: kb(),
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
        replyMarkup: kb(),
      });
      return "link_demo";
    } catch (e) {
      await sendTelegramMessage({
        chatId,
        text: escapeHtml(e instanceof Error ? e.message : "не удалось привязать"),
        replyMarkup: kb(),
      });
      return "link_failed";
    }
  }

  return handleHome(chatId, from);
}

async function dispatchAction(
  action: string,
  chatId: number,
  from: TgUser | undefined,
) {
  if (!from && action !== "help" && action !== "home") {
    await sendTelegramMessage({
      chatId,
      text: "Не вижу, кто пишет. Нажми /start.",
      replyMarkup: kb(),
    });
    return "no_from";
  }
  switch (action) {
    case "home":
      return handleHome(chatId, from);
    case "schedule":
      return handleSchedule(chatId, from!);
    case "balance":
      return handleBalance(chatId, from!);
    case "groups":
      return handleGroups(chatId, from!);
    case "cabinet":
    case "login":
      return handleCabinet(chatId, from!);
    case "help":
      return handleHelp(chatId);
    default:
      await sendTelegramMessage({
        chatId,
        text: "Выбери пункт в меню внизу 👇",
        replyMarkup: kb(),
      });
      return "unknown";
  }
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
    const mapped =
      data === "login"
        ? "cabinet"
        : data === "home" ||
            data === "balance" ||
            data === "groups" ||
            data === "schedule" ||
            data === "help"
          ? data
          : "unknown";
    return jsonOk({
      handled: await dispatchAction(mapped, chatId, cq.from),
    });
  }

  const raw = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat.id;
  const from = update.message?.from;
  if (!chatId) return jsonOk({ ignored: true });

  const text = cmd(raw);

  if (raw.startsWith("/start")) {
    return jsonOk({ handled: await handleStart(chatId, from, raw) });
  }

  const menuKey = matchMenu(raw);
  if (menuKey) {
    return jsonOk({
      handled: await dispatchAction(menuKey, chatId, from),
    });
  }

  if (
    (text.startsWith("/login") ||
      text.startsWith("/kabinet") ||
      text.startsWith("/cabinet")) &&
    from
  ) {
    return jsonOk({ handled: await handleCabinet(chatId, from) });
  }
  if (text.startsWith("/balance") && from) {
    return jsonOk({ handled: await handleBalance(chatId, from) });
  }
  if ((text.startsWith("/groups") || text.startsWith("/group")) && from) {
    return jsonOk({ handled: await handleGroups(chatId, from) });
  }
  if (
    (text.startsWith("/schedule") || text.startsWith("/zajecia")) &&
    from
  ) {
    return jsonOk({ handled: await handleSchedule(chatId, from) });
  }
  if (text.startsWith("/help") || text.startsWith("/menu")) {
    return jsonOk({ handled: await handleHelp(chatId) });
  }

  await sendTelegramMessage({
    chatId,
    text: "Жми кнопки меню внизу 👇\nИли /help",
    replyMarkup: kb(),
  });
  return jsonOk({ handled: "fallback" });
}
