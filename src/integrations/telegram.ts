import { createHmac, createHash } from "crypto";
import { getEnv } from "@/lib/env";
import { renderTemplate } from "@/domain/notifications";

export type InlineKeyboard = {
  inline_keyboard: Array<
    Array<{ text: string; url?: string; callback_data?: string }>
  >;
};

export type ReplyKeyboard = {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
};

export type TelegramReplyMarkup =
  | InlineKeyboard
  | ReplyKeyboard
  | { remove_keyboard: true };

/** Labels for the persistent bottom menu (exact match). */
export const BOT_MENU = {
  home: "🏠 Главная",
  schedule: "📅 Занятия",
  balance: "💳 Баланс",
  groups: "🎭 Группы",
  cabinet: "🔑 Кабинет",
  help: "ℹ️ Помощь",
} as const;

export function mainReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: BOT_MENU.home }, { text: BOT_MENU.schedule }],
      [{ text: BOT_MENU.balance }, { text: BOT_MENU.groups }],
      [{ text: BOT_MENU.cabinet }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Выбери пункт меню…",
  };
}

/** Single deep-link — no duplicate «login page» / «cabinet» clutter. */
export function openCabinetKeyboard(magicUrl: string): InlineKeyboard {
  return {
    inline_keyboard: [[{ text: "Открыть кабинет →", url: magicUrl }]],
  };
}

export function openLoginKeyboard(loginUrl: string): InlineKeyboard {
  return {
    inline_keyboard: [[{ text: "Войти на сайте →", url: loginUrl }]],
  };
}

/** @deprecated Prefer mainReplyKeyboard + openCabinetKeyboard */
export function mainMenuKeyboard(opts?: {
  cabinetUrl?: string;
  loginUrl?: string;
}): InlineKeyboard {
  void opts;
  return {
    inline_keyboard: [
      [
        { text: "Главная", callback_data: "home" },
        { text: "Баланс", callback_data: "balance" },
      ],
      [
        { text: "Занятия", callback_data: "schedule" },
        { text: "Группы", callback_data: "groups" },
      ],
      [{ text: "Кабинет", callback_data: "login" }],
    ],
  };
}

export async function sendTelegramMessage(params: {
  chatId: number | string;
  text: string;
  parseMode?: "HTML" | "Markdown";
  replyMarkup?: TelegramReplyMarkup;
}) {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.info("[telegram:dev]", params.chatId, params.text, params.replyMarkup);
    return { ok: true, result: { message_id: 0 } };
  }

  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        disable_web_page_preview: true,
        reply_markup: params.replyMarkup,
        parse_mode: params.parseMode ?? "HTML",
      }),
    },
  );
  return res.json();
}

export async function answerCallbackQuery(params: {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}) {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.info("[telegram:callback]", params);
    return { ok: true };
  }
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: params.callbackQueryId,
        text: params.text,
        show_alert: params.showAlert,
      }),
    },
  );
  return res.json();
}

export async function sendTemplatedTelegram(params: {
  chatId: number | string;
  templateCode: string;
  payload?: Record<string, unknown>;
}) {
  const text = renderTemplate(params.templateCode, params.payload ?? {});
  return sendTelegramMessage({ chatId: params.chatId, text });
}

/** Validate Telegram Mini App initData (HMAC-SHA256). */
export function validateTelegramInitData(initData: string): {
  ok: boolean;
  authDate?: number;
  user?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
} {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(env.TELEGRAM_BOT_TOKEN)
    .digest();
  const calculated = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculated !== hash) return { ok: false };

  const userRaw = params.get("user");
  const user = userRaw ? JSON.parse(userRaw) : undefined;
  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : undefined;
  return {
    ok: true,
    user,
    authDate: Number.isFinite(authDate) ? authDate : undefined,
  };
}

export function verifyWebhookSecret(headerValue: string | null): boolean {
  const env = getEnv();
  const expected = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const isProd =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";
  // Missing secret must not open the webhook in production.
  if (!expected) return !isProd;
  return Boolean(headerValue) && headerValue === expected;
}

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
