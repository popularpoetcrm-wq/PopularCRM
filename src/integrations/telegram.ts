import { createHmac, createHash } from "crypto";
import { getEnv } from "@/lib/env";
import { renderTemplate } from "@/domain/notifications";

export async function sendTelegramMessage(params: {
  chatId: number | string;
  text: string;
  parseMode?: "HTML" | "Markdown";
}) {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.info("[telegram:dev]", params.chatId, params.text);
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
  return { ok: true, user };
}

export function verifyWebhookSecret(headerValue: string | null): boolean {
  const env = getEnv();
  if (!env.TELEGRAM_WEBHOOK_SECRET) return true;
  return headerValue === env.TELEGRAM_WEBHOOK_SECRET;
}

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}
