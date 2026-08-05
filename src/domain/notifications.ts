import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationCategory =
  | "payment"
  | "attendance"
  | "makeup"
  | "schedule"
  | "document"
  | "system";

export type NotificationPriority = "urgent" | "high" | "normal" | "low";

export type NotificationPresentation = {
  title: string;
  body: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  action: { label: string; href: string } | null;
};

function value(payload: Record<string, unknown>, key: string) {
  const raw = payload[key];
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
}

function formattedDate(raw: unknown, withTime = false) {
  if (typeof raw !== "string") return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Warsaw",
    day: "numeric",
    month: "long",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function internalAction(
  label: string,
  href: string,
): NotificationPresentation["action"] {
  return { label, href };
}

export function getNotificationPresentation(
  code: string,
  payload: Record<string, unknown>,
): NotificationPresentation {
  const amount = value(payload, "amount");
  const dueAt = formattedDate(payload.dueAt);
  const isOverdue = payload.isOverdue === true;

  switch (code) {
    case "payment.reminder":
      return {
        title: isOverdue ? "Оплата уже ждёт" : "Пора продлить абонемент",
        body: `${amount ? `К оплате ${amount} PLN. ` : ""}${
          isOverdue
            ? "Оплати сейчас, чтобы занятия продолжились без паузы."
            : dueAt
              ? `Срок оплаты — ${dueAt}.`
              : "Оплати до следующего занятия."
        }`,
        category: "payment",
        priority: isOverdue ? "urgent" : "high",
        action: internalAction("Оплатить", "/cabinet/payments"),
      };
    case "payment.paid":
      return {
        title: "Оплата получена",
        body: "Спасибо! Абонемент активирован, можно спокойно идти на занятия.",
        category: "payment",
        priority: "normal",
        action: internalAction("Посмотреть абонемент", "/cabinet/package"),
      };
    case "credits.low_balance":
      return {
        title: "Осталось одно занятие",
        body: "Самое время продлить абонемент, чтобы не делать паузу.",
        category: "payment",
        priority: "high",
        action: internalAction("Продлить абонемент", "/cabinet/payments"),
      };
    case "makeup.created":
      return {
        title: "Отработка готова",
        body: `Мы сохранили пропущенное занятие${formattedDate(payload.validUntil) ? ` до ${formattedDate(payload.validUntil)}` : ""}. Выбери удобную новую дату.`,
        category: "makeup",
        priority: "normal",
        action: internalAction("Выбрать дату", "/cabinet/makeups"),
      };
    case "makeup.planned_absence":
      return {
        title: "Отсутствие отмечено",
        body: `Занятия перенесены, доступно отработок: ${value(payload, "count") || "0"}. Осталось выбрать новые даты.`,
        category: "makeup",
        priority: "normal",
        action: internalAction("Выбрать даты", "/cabinet/makeups"),
      };
    case "makeup.expiring": {
      const daysLeft = Number(payload.daysLeft);
      const dayText = Number.isFinite(daysLeft)
        ? daysLeft <= 1
          ? "остался последний день"
          : `осталось ${daysLeft} дн.`
        : "срок скоро закончится";
      return {
        title: "Отработка скоро сгорит",
        body: `Не потеряй занятие: ${dayText}${formattedDate(payload.validUntil) ? `, использовать можно до ${formattedDate(payload.validUntil)}` : ""}.`,
        category: "makeup",
        priority: "urgent",
        action: internalAction("Записаться на отработку", "/cabinet/makeups"),
      };
    }
    case "attendance.remind_cutoff":
      return {
        title: "Ты придёшь на занятие?",
        body: `${value(payload, "title") || "Занятие"}${formattedDate(payload.startsAt, true) ? ` — ${formattedDate(payload.startsAt, true)}` : ""}. Если планы изменились, отметь «не приду» минимум за ${value(payload, "cutoffHours") || "6"} ч — тогда занятие сохранится как отработка.`,
        category: "attendance",
        priority: "high",
        action: internalAction("Открыть занятие", "/cabinet/schedule"),
      };
    case "invoice.ready":
      return {
        title: "Фактура готова",
        body: value(payload, "invoiceNumber")
          ? `Документ ${value(payload, "invoiceNumber")} уже в кабинете.`
          : "Документ уже в кабинете.",
        category: "document",
        priority: "low",
        action: internalAction("Открыть фактуры", "/cabinet/invoices"),
      };
    case "schedule.changed":
      return {
        title: "Расписание изменилось",
        body: value(payload, "message") || "Проверь время ближайшего занятия.",
        category: "schedule",
        priority: "urgent",
        action: internalAction("Проверить расписание", "/cabinet/schedule"),
      };
    case "birthdays.digest":
      return {
        title: "Ближайшие дни рождения",
        body: value(payload, "list") || "Список пока пуст.",
        category: "system",
        priority: "low",
        action: null,
      };
    default:
      return {
        title: "Сообщение от студии",
        body: value(payload, "message") || "В кабинете появилось новое сообщение.",
        category: "system",
        priority: "normal",
        action: null,
      };
  }
}

export async function enqueueNotification(
  db: SupabaseClient,
  params: {
    tenantId: string;
    recipientPersonId: string;
    channel: "telegram" | "email";
    templateCode: string;
    payload?: Record<string, unknown>;
    scheduledAt?: Date;
    dedupeKey?: string;
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
      dedupe_key: params.dedupeKey ?? null,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505" && params.dedupeKey) {
      const { data: existing, error: existingError } = await db
        .from("notifications")
        .select("*")
        .eq("tenant_id", params.tenantId)
        .eq("recipient_person_id", params.recipientPersonId)
        .eq("dedupe_key", params.dedupeKey)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return existing;
    }
    throw error;
  }

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
    dedupeKey?: string;
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
  const presentation = getNotificationPresentation(code, payload);
  const externalUrl = value(payload, "paymentUrl") || value(payload, "cabinetUrl");
  return `${presentation.title}\n${presentation.body}${externalUrl ? `\n\n${presentation.action?.label ?? "Открыть"}: ${externalUrl}` : ""}`;
}

export function notificationEmailSubject(
  code: string,
  payload: Record<string, unknown>,
) {
  return getNotificationPresentation(code, payload).title;
}
