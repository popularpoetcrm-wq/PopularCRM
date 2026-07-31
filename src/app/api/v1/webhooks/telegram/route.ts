import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  verifyWebhookSecret,
  sendTelegramMessage,
  answerCallbackQuery,
  mainReplyKeyboard,
  openLinkKeyboard,
  openLoginKeyboard,
  BOT_MENU,
  escapeHtml,
} from "@/integrations/telegram";
import { jsonOk, jsonError } from "@/lib/api";
import { withCabinetNext } from "@/lib/cabinet-next";
import { getEnv, hasSupabase } from "@/lib/env";

type TgUser = { id: number; username?: string; first_name?: string };

type TgUpdate = {
  message?: {
    chat: { id: number; type: string; title?: string };
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

type BotStatus = NonNullable<
  Awaited<
    ReturnType<
      typeof import("@/lib/supabase-onboarding").getBotStatusForTelegramUserDb
    >
  >
>;

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
  for (const [key, label] of Object.entries(BOT_MENU) as Array<[string, string]>) {
    if (n === normBtn(label)) return key;
  }
  if (n === "главная" || n === "сводка" || n === "меню" || n === "start") {
    return "home";
  }
  if (n === "занятия" || n === "расписание") return "schedule";
  if (n === "отработки" || n === "отработка" || n === "makeup") return "makeups";
  if (n === "оплатить" || n === "оплата" || n === "баланс" || n === "pay") {
    return "pay";
  }
  if (n === "кабинет" || n === "войти" || n === "вход") return "cabinet";
  if (n === "группы" || n === "группа") return "home";
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

async function magicLink(from: TgUser, next: string) {
  const { issueLoginLinkForTelegramUserDb } = await import(
    "@/lib/supabase-onboarding"
  );
  const inv = await issueLoginLinkForTelegramUserDb(from.id);
  return {
    url: withCabinetNext(inv.magicUrl, next),
    email:
      inv.person.email && !String(inv.person.email).endsWith("@cabinet.local")
        ? String(inv.person.email)
        : null,
  };
}

async function loadStatus(from: TgUser): Promise<BotStatus | null> {
  if (!hasSupabase()) return null;
  const { getBotStatusForTelegramUserDb } = await import(
    "@/lib/supabase-onboarding"
  );
  return getBotStatusForTelegramUserDb(from.id);
}

async function sendUnlinked(chatId: number, title: string) {
  await sendTelegramMessage({
    chatId,
    text:
      `<b>${title}</b>\n` +
      `Telegram ещё не привязан.\n\n` +
      `1. Войди на сайте по email\n` +
      `2. Профиль → привяжи Telegram\n` +
      `3. Вернись и жми кнопку снова`,
    parseMode: "HTML",
    replyMarkup: openLoginKeyboard(`${appUrl()}/login`),
  });
  await sendTelegramMessage({
    chatId,
    text: "Меню внизу 👇",
    replyMarkup: kb(),
  });
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
    const link = await magicLink(from, "/cabinet");
    await sendTelegramMessage({
      chatId,
      text:
        `<b>Кабинет</b>\n` +
        `Одна ссылка — сразу в личный кабинет (7 дней).` +
        (link.email ? `\n\nАккаунт: <code>${escapeHtml(link.email)}</code>` : ""),
      parseMode: "HTML",
      replyMarkup: openLinkKeyboard("Открыть кабинет →", link.url),
    });
    return "cabinet";
  } catch {
    await sendUnlinked(chatId, "Кабинет");
    return "cabinet_unlinked";
  }
}

async function handlePay(chatId: number, from: TgUser) {
  if (!hasSupabase()) {
    await sendTelegramMessage({
      chatId,
      text: "Нужен режим Supabase.",
      replyMarkup: kb(),
    });
    return "pay_demo";
  }
  try {
    const st = await loadStatus(from);
    if (!st) {
      await sendUnlinked(chatId, "Оплата");
      return "pay_unlinked";
    }
    const pkg = (
      st.packages as Array<{ credits_available: number; credits_total: number }>
    )[0];
    const debt = st.money?.debt_open ?? 0;
    const pkgLine = pkg
      ? `Пакет: <b>${pkg.credits_available}</b> из ${pkg.credits_total}`
      : "Активного пакета нет";
    const debtLine = debt
      ? `\nК оплате: <b>${debt} PLN</b>`
      : "\nДолга нет ✅";
    const link = await magicLink(from, "/cabinet/payments");
    await sendTelegramMessage({
      chatId,
      text:
        `<b>Оплата</b>\n` +
        `${escapeHtml(st.money?.label ?? "—")}\n` +
        `${pkgLine}${debtLine}`,
      parseMode: "HTML",
      replyMarkup: openLinkKeyboard(
        debt ? "Оплатить в кабинете →" : "Открыть оплаты →",
        link.url,
      ),
    });
    return "pay";
  } catch (e) {
    await sendTelegramMessage({
      chatId,
      text: escapeHtml(e instanceof Error ? e.message : "Ошибка оплаты"),
      replyMarkup: kb(),
    });
    return "pay_error";
  }
}

async function handleMakeups(chatId: number, from: TgUser) {
  if (!hasSupabase()) {
    await sendTelegramMessage({
      chatId,
      text: "Нужен режим Supabase.",
      replyMarkup: kb(),
    });
    return "makeups_demo";
  }
  try {
    const st = await loadStatus(from);
    if (!st) {
      await sendUnlinked(chatId, "Отработки");
      return "makeups_unlinked";
    }
    const n = st.makeupsAvailable ?? 0;
    const link = await magicLink(from, "/cabinet/makeups");
    await sendTelegramMessage({
      chatId,
      text:
        `<b>Отработки</b>\n` +
        (n > 0
          ? `Доступно: <b>${n}</b>\nМожно прийти на другую группу или пробное.`
          : `Сейчас нет доступных.\nОтметь «не приду» заранее (≥6 ч) — появится отработка.`),
      parseMode: "HTML",
      replyMarkup: openLinkKeyboard(
        n > 0 ? "Забронировать в кабинете →" : "Открыть отработки →",
        link.url,
      ),
    });
    return "makeups";
  } catch (e) {
    await sendTelegramMessage({
      chatId,
      text: escapeHtml(e instanceof Error ? e.message : "Ошибка отработок"),
      replyMarkup: kb(),
    });
    return "makeups_error";
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
    const st = await loadStatus(from);
    if (!st) {
      await sendUnlinked(chatId, "Занятия");
      return "schedule_unlinked";
    }
    const items = (st.schedule ?? []) as Array<{
      title: string;
      starts_at: string;
      myStatus?: string | null;
    }>;
    const link = await magicLink(from, "/cabinet/schedule");
    if (!items.length) {
      await sendTelegramMessage({
        chatId,
        text: "<b>Занятия</b>\nПока нет ближайших в расписании.",
        parseMode: "HTML",
        replyMarkup: openLinkKeyboard("Открыть расписание →", link.url),
      });
      return "schedule_empty";
    }
    const lines = items
      .slice(0, 5)
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
        `<i>«Не приду» — в кабинете.</i>`,
      parseMode: "HTML",
      replyMarkup: openLinkKeyboard("Открыть занятия →", link.url),
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
      `<b>Меню бота</b>\n\n` +
      `${BOT_MENU.home} — пакет, долг, ближайшее\n` +
      `${BOT_MENU.schedule} — занятия + переход в ЛК\n` +
      `${BOT_MENU.makeups} — отработки + бронь в ЛК\n` +
      `${BOT_MENU.pay} — оплата + переход в ЛК\n` +
      `${BOT_MENU.cabinet} — сразу в кабинет\n\n` +
      `В Telegram смотришь статус, в кабинете делаешь действия.`,
    parseMode: "HTML",
    replyMarkup: kb(),
  });
  return "help";
}

async function handleHome(chatId: number, from: TgUser | undefined) {
  if (from && hasSupabase()) {
    try {
      const st = await loadStatus(from);
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
        const debt = st.money?.debt_open ?? 0;
        const debtLine = debt ? `\nК оплате: <b>${debt} PLN</b>` : "";
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
            `${pkgLine}${debtLine}${makeups}` +
            next +
            (groups ? `\n\n🎭 <b>Группы</b>\n${groups}` : "") +
            `\n\n<i>Действия — кнопками внизу</i>`,
          parseMode: "HTML",
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
      `Сводка, занятия, отработки и оплата — в меню внизу.\n` +
      `Действия (бронь, оплата) открываются в кабинете одной кнопкой.\n\n` +
      `Если ты уже ученик — привяжи Telegram в профиле на сайте.`,
    parseMode: "HTML",
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
          `Меню внизу 👇`,
        parseMode: "HTML",
        replyMarkup: kb(),
      });
      return "link";
    } catch (e) {
      await sendTelegramMessage({
        chatId,
        text:
          `Не удалось привязать: ${escapeHtml(e instanceof Error ? e.message : "ошибка")}.\n` +
          `Открой свежую ссылку из кабинета (Профиль → Telegram).`,
        parseMode: "HTML",
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
    case "makeups":
      return handleMakeups(chatId, from!);
    case "pay":
    case "balance":
      return handlePay(chatId, from!);
    case "cabinet":
    case "login":
      return handleCabinet(chatId, from!);
    case "groups":
      return handleHome(chatId, from);
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
    const mapped = [
      "home",
      "schedule",
      "makeups",
      "pay",
      "cabinet",
      "login",
      "balance",
      "groups",
      "help",
    ].includes(data)
      ? data
      : "unknown";
    return jsonOk({
      handled: await dispatchAction(mapped, chatId, cq.from),
    });
  }

  const raw = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat.id;
  const chat = update.message?.chat;
  const from = update.message?.from;
  if (!chatId || !chat) return jsonOk({ ignored: true });

  const text = cmd(raw);

  // Admin binds CRM group ↔ this Telegram group chat
  const bindMatch = raw.match(/^\/bind(?:@\w+)?\s+(\S+)/i);
  if (bindMatch && hasSupabase()) {
    try {
      const { confirmGroupTelegramBindDb } = await import("@/lib/group-telegram");
      const result = await confirmGroupTelegramBindDb(bindMatch[1], {
        id: chat.id,
        type: chat.type,
        title: chat.title,
      });
      await sendTelegramMessage({
        chatId,
        text:
          `<b>Готово</b> — чат привязан к группе CRM\n` +
          `${escapeHtml(result.title)}`,
        parseMode: "HTML",
      });
      return jsonOk({ handled: "group_bind", group_id: result.group_id });
    } catch (e) {
      await sendTelegramMessage({
        chatId,
        text: escapeHtml(e instanceof Error ? e.message : "Не удалось привязать"),
        parseMode: "HTML",
      });
      return jsonOk({ handled: "group_bind_failed" });
    }
  }

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
  if (
    (text.startsWith("/pay") || text.startsWith("/balance") || text.startsWith("/oplata")) &&
    from
  ) {
    return jsonOk({ handled: await handlePay(chatId, from) });
  }
  if (
    (text.startsWith("/makeup") || text.startsWith("/otrabot")) &&
    from
  ) {
    return jsonOk({ handled: await handleMakeups(chatId, from) });
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
