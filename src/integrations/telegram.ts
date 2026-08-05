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
  home: "🏠 Сводка",
  schedule: "📅 Занятия",
  makeups: "🔄 Отработки",
  pay: "💳 Оплатить",
  cabinet: "🔑 Кабинет",
} as const;

export function mainReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: BOT_MENU.home }, { text: BOT_MENU.schedule }],
      [{ text: BOT_MENU.makeups }, { text: BOT_MENU.pay }],
      [{ text: BOT_MENU.cabinet }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Меню внизу…",
  };
}

/** Single deep-link into a cabinet section. */
export function openLinkKeyboard(label: string, url: string): InlineKeyboard {
  return {
    inline_keyboard: [[{ text: label, url }]],
  };
}

/** @deprecated Prefer openLinkKeyboard */
export function openCabinetKeyboard(magicUrl: string): InlineKeyboard {
  return openLinkKeyboard("Открыть кабинет →", magicUrl);
}

export function openLoginKeyboard(loginUrl: string): InlineKeyboard {
  return openLinkKeyboard("Войти на сайте →", loginUrl);
}

/** @deprecated Prefer mainReplyKeyboard + openLinkKeyboard */
export function mainMenuKeyboard(_opts?: {
  cabinetUrl?: string;
  loginUrl?: string;
}): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Сводка", callback_data: "home" },
        { text: "Занятия", callback_data: "schedule" },
      ],
      [
        { text: "Отработки", callback_data: "makeups" },
        { text: "Оплатить", callback_data: "pay" },
      ],
      [{ text: "Кабинет", callback_data: "cabinet" }],
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

/** Send a PDF/file to Telegram. Prefers uploading bytes; falls back to public URL. */
export async function sendTelegramDocument(params: {
  chatId: number | string;
  filename: string;
  caption?: string;
  documentUrl?: string;
  documentBytes?: Uint8Array;
}) {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.info("[telegram:dev:document]", params.chatId, params.filename, params.documentUrl);
    return { ok: true, result: { message_id: 0 } };
  }

  const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
  const form = new FormData();
  form.append("chat_id", String(params.chatId));
  if (params.caption) form.append("caption", params.caption.slice(0, 1024));

  let bytes = params.documentBytes;
  if (!bytes && params.documentUrl) {
    try {
      const pdfRes = await fetch(params.documentUrl);
      if (pdfRes.ok) {
        bytes = new Uint8Array(await pdfRes.arrayBuffer());
      }
    } catch (e) {
      console.warn("[telegram] pdf download failed, trying URL pass-through", e);
    }
  }

  if (bytes) {
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    form.append(
      "document",
      new Blob([ab], { type: "application/pdf" }),
      params.filename.endsWith(".pdf") ? params.filename : `${params.filename}.pdf`,
    );
  } else if (params.documentUrl) {
    form.append("document", params.documentUrl);
  } else {
    throw new Error("Нет файла для отправки в Telegram");
  }

  const res = await fetch(endpoint, { method: "POST", body: form });
  const json = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.description || `Telegram sendDocument HTTP ${res.status}`);
  }
  return json;
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
  const payload = params.payload ?? {};
  const text = renderTemplate(params.templateCode, payload);

  // Invoice: send PDF as a document (not just a link)
  if (
    params.templateCode === "invoice.ready" &&
    typeof payload.pdfUrl === "string" &&
    payload.pdfUrl
  ) {
    const number =
      typeof payload.invoiceNumber === "string" && payload.invoiceNumber
        ? payload.invoiceNumber
        : "faktura";
    try {
      return await sendTelegramDocument({
        chatId: params.chatId,
        filename: `${number.replace(/[^\w.-]+/g, "_")}.pdf`,
        caption: text,
        documentUrl: payload.pdfUrl,
      });
    } catch (e) {
      console.warn("[telegram] document send failed, falling back to text", e);
    }
  }

  return sendTelegramMessage({ chatId: params.chatId, text });
}

/** Invite link into a Telegram group/supergroup (bot must be admin). */
export async function createTelegramChatInviteLink(params: {
  chatId: number | string;
  name?: string;
  memberLimit?: number;
  expireDate?: number;
}) {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    const fake = `https://t.me/+dev_${params.chatId}`;
    console.info("[telegram:inviteLink]", params, fake);
    return { ok: true as const, invite_link: fake };
  }
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/createChatInviteLink`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: params.chatId,
        name: params.name,
        member_limit: params.memberLimit,
        expire_date: params.expireDate,
      }),
    },
  );
  const json = (await res.json()) as {
    ok: boolean;
    result?: { invite_link?: string };
    description?: string;
  };
  if (!json.ok) {
    return {
      ok: false as const,
      invite_link: null,
      error: json.description ?? "createChatInviteLink failed",
    };
  }
  return {
    ok: true as const,
    invite_link: json.result?.invite_link ?? null,
  };
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
