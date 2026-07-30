import { createHmac, createHash } from "crypto";
import { getEnv } from "@/lib/env";
import { renderTemplate } from "@/domain/notifications";

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
};

export function mainMenuKeyboard(opts?: { cabinetUrl?: string; loginUrl?: string }): InlineKeyboard {
  const cabinet = opts?.cabinetUrl;
  const login = opts?.loginUrl;
  const rows: InlineKeyboard["inline_keyboard"] = [
    [
      { text: "Войти", callback_data: "login" },
      { text: "Баланс", callback_data: "balance" },
      { text: "Группы", callback_data: "groups" },
    ],
  ];
  const links: Array<{ text: string; url: string }> = [];
  if (cabinet) links.push({ text: "Кабинет", url: cabinet });
  if (login) links.push({ text: "Страница входа", url: login });
  if (links.length) rows.push(links);
  return { inline_keyboard: rows };
}

export async function sendTelegramMessage(params: {
  chatId: number | string;
  text: string;
  parseMode?: "HTML" | "Markdown";
  replyMarkup?: InlineKeyboard;
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
        parse_mode: params.parseMode,
        disable_web_page_preview: true,
        reply_markup: params.replyMarkup,
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
  user?: { id: number; username?: string; first_name?: string; last_name?: string };
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
