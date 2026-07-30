import type { SupabaseClient } from "@supabase/supabase-js";

export async function enqueueNotification(
  db: SupabaseClient,
  params: {
    tenantId: string;
    recipientPersonId: string;
    channel: "telegram" | "email";
    templateCode: string;
    payload?: Record<string, unknown>;
    scheduledAt?: Date;
  },
) {
  const { data, error } = await db
    .from("notifications")
    .insert({
      tenant_id: params.tenantId,
      recipient_person_id: params.recipientPersonId,
      channel: params.channel,
      template_code: params.templateCode,
      payload: params.payload ?? {},
      status: "queued",
      scheduled_at: (params.scheduledAt ?? new Date()).toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;

  await db.from("outbox").insert({
    tenant_id: params.tenantId,
    event_type: "notification.dispatch",
    payload: { notificationId: data.id },
    status: "pending",
  });

  return data;
}

export function renderTemplate(
  code: string,
  payload: Record<string, unknown>,
): string {
  switch (code) {
    case "payment.reminder":
      return `Привет! Напоминание об оплате${payload.amount ? ` — ${payload.amount} PLN` : ""}.${payload.paymentUrl ? `\nОплатить: ${payload.paymentUrl}` : ""}`;
    case "payment.paid":
      return `Спасибо! Оплата получена. Пакет активирован.`;
    case "credits.low_balance":
      return `В пакете осталось только ${payload.remaining ?? 1} занятие.`;
    case "makeup.created":
      return `Создана отработка. Действует до: ${payload.validUntil ?? "—"}. Забронируй в кабинете.`;
    case "makeup.expiring":
      return `Отработка скоро сгорит (${payload.validUntil ?? "—"}).`;
    case "invoice.ready":
      return `Счёт готов${payload.invoiceNumber ? `: ${payload.invoiceNumber}` : ""}.${payload.pdfUrl ? `\n${payload.pdfUrl}` : ""}`;
    case "schedule.changed":
      return `Изменение в расписании: ${payload.message ?? "проверь кабинет."}`;
    default:
      return `Уведомление: ${code}`;
  }
}
