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

export async function resolveNotificationRecipient(
  db: SupabaseClient,
  personId: string,
) {
  const { data: person } = await db
    .from("persons")
    .select("id, email, is_minor")
    .eq("id", personId)
    .maybeSingle();

  let recipient = person;
  if (person?.is_minor) {
    const { data: contact } = await db
      .from("student_contacts")
      .select("contact_person_id, persons:contact_person_id(id, email, is_minor)")
      .eq("student_person_id", personId)
      .eq("can_receive_notifications", true)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    const linked = Array.isArray(contact?.persons)
      ? contact?.persons[0]
      : contact?.persons;
    if (linked) recipient = linked;
  }

  if (!recipient) throw new Error("Получатель уведомления не найден");
  const { data: telegram } = await db
    .from("telegram_identities")
    .select("chat_id")
    .eq("person_id", recipient.id)
    .not("chat_id", "is", null)
    .maybeSingle();

  return {
    personId: recipient.id as string,
    channel: telegram?.chat_id ? ("telegram" as const) : ("email" as const),
    email: recipient.email as string | null,
  };
}

export async function enqueueBestNotification(
  db: SupabaseClient,
  params: {
    tenantId: string;
    recipientPersonId: string;
    templateCode: string;
    payload?: Record<string, unknown>;
    scheduledAt?: Date;
  },
) {
  const recipient = await resolveNotificationRecipient(
    db,
    params.recipientPersonId,
  );
  if (recipient.channel === "email" && !recipient.email) {
    throw new Error("У получателя нет Telegram или email");
  }
  return enqueueNotification(db, {
    ...params,
    recipientPersonId: recipient.personId,
    channel: recipient.channel,
  });
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
      return `Создана отработка. Действует до: ${payload.validUntil ?? "—"}.\nЗабронируй группу или пробное: ${payload.cabinetUrl ?? "https://popularcrm.vercel.app/cabinet/makeups"}`;
    case "makeup.planned_absence":
      return `Отсутствие отмечено. Создано отработок: ${payload.count ?? 0}.\nВыбери новую дату: ${payload.cabinetUrl ?? "https://popularcrm.vercel.app/cabinet/makeups"}`;
    case "makeup.expiring":
      return `Отработка скоро сгорит (${payload.validUntil ?? "—"}).\n${payload.cabinetUrl ?? "https://popularcrm.vercel.app/cabinet/makeups"}`;
    case "attendance.remind_cutoff":
      return `Скоро занятие${payload.title ? ` «${payload.title}»` : ""}${payload.startsAt ? ` (${payload.startsAt})` : ""}. Если не придёшь — отметь в ЛК минимум за ${payload.cutoffHours ?? 6} ч:\n${payload.cabinetUrl ?? "https://popularcrm.vercel.app/cabinet/schedule"}`;
    case "invoice.ready":
      return `Счёт готов${payload.invoiceNumber ? `: ${payload.invoiceNumber}` : ""}.${payload.pdfUrl ? `\n${payload.pdfUrl}` : ""}`;
    case "schedule.changed":
      return `Изменение в расписании: ${payload.message ?? "проверь кабинет."}`;
    case "birthdays.digest":
      return `Ближайшие дни рождения:\n${payload.list ?? "—"}`;
    default:
      return `Уведомление: ${code}`;
  }
}
