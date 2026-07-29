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
    const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
    await sendTelegramMessage({
      chatId,
      text: `Witaj w Studio CRM!\nTwój panel: ${appUrl}/cabinet\nLogowanie: ${appUrl}/login`,
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
        text: "Konto Telegram nie jest powiązane. Wejdź do panelu i połącz konto.",
      });
      return jsonOk({ handled: "balance_unlinked" });
    }

    const { data: packages } = await db
      .from("student_packages")
      .select("id, status, lesson_credits(status)")
      .eq("status", "active");

    // simplified response
    await sendTelegramMessage({
      chatId,
      text: `Aktywne pakiety: ${(packages ?? []).length}. Szczegóły w panelu.`,
    });
    return jsonOk({ handled: "balance" });
  }

  await sendTelegramMessage({
    chatId,
    text: "Dostępne: /start — panel webowy jest głównym miejscem obsługi.",
  });
  return jsonOk({ handled: "fallback" });
}
