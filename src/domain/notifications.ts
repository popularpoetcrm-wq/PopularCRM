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
      return `Cześć! Przypomnienie o płatności${payload.amount ? ` — ${payload.amount} PLN` : ""}.${payload.paymentUrl ? `\nOpłać tutaj: ${payload.paymentUrl}` : ""}`;
    case "payment.paid":
      return `Dziękujemy! Płatność otrzymana. Pakiet aktywowany.`;
    case "credits.low_balance":
      return `Zostało Ci tylko ${payload.remaining ?? 1} zajęcie w pakiecie.`;
    case "makeup.created":
      return `Utworzono odrobienie. Ważne do: ${payload.validUntil ?? "—"}. Zarezerwuj w panelu.`;
    case "makeup.expiring":
      return `Twoje odrobienie wkrótce wygaśnie (${payload.validUntil ?? "—"}).`;
    case "invoice.ready":
      return `Faktura gotowa${payload.invoiceNumber ? `: ${payload.invoiceNumber}` : ""}.${payload.pdfUrl ? `\n${payload.pdfUrl}` : ""}`;
    case "schedule.changed":
      return `Zmiana w harmonogramie: ${payload.message ?? "sprawdź panel."}`;
    default:
      return `Powiadomienie: ${code}`;
  }
}
