import { getAdminClient } from "@/lib/supabase/admin";
import {
  createTelegramChatInviteLink,
  sendTelegramMessage,
  escapeHtml,
} from "@/integrations/telegram";
import { getChildrenForParentDb } from "@/lib/supabase-data";
import { getEnv } from "@/lib/env";

function appBaseUrl() {
  return (getEnv().NEXT_PUBLIC_APP_URL || "https://popularcrm.vercel.app").replace(
    /\/$/,
    "",
  );
}

async function staffTelegramChatIds(tenantId: string, preferPersonId?: string) {
  const db = getAdminClient();
  const { data: roles } = await db
    .from("person_roles")
    .select("person_id, role")
    .eq("tenant_id", tenantId)
    .in("role", ["admin", "owner"])
    .is("revoked_at", null);
  const ids = [
    ...new Set(
      [
        ...(preferPersonId ? [preferPersonId] : []),
        ...(roles ?? []).map((r) => r.person_id as string),
      ].filter(Boolean),
    ),
  ];
  if (!ids.length) return [] as number[];

  const { data: identities } = await db
    .from("telegram_identities")
    .select("person_id, chat_id")
    .in("person_id", ids)
    .not("chat_id", "is", null);

  const byPerson = new Map(
    (identities ?? []).map((i) => [i.person_id as string, i.chat_id as number]),
  );

  // Prefer the actor who clicked the button, then other admins with TG.
  const ordered: number[] = [];
  const seen = new Set<number>();
  if (preferPersonId && byPerson.has(preferPersonId)) {
    const c = byPerson.get(preferPersonId)!;
    ordered.push(c);
    seen.add(c);
  }
  for (const id of ids) {
    const c = byPerson.get(id);
    if (c != null && !seen.has(c)) {
      ordered.push(c);
      seen.add(c);
    }
  }
  return ordered;
}

async function notifyStaffBindInstructions(params: {
  tenantId: string;
  actorPersonId?: string;
  groupId: string;
  groupTitle: string;
  command: string;
  expiresAt: string;
}) {
  const chats = await staffTelegramChatIds(
    params.tenantId,
    params.actorPersonId,
  );
  if (!chats.length) {
    return { dm_sent: 0, dm_hint: "нет админов с привязанным Telegram" };
  }

  const when = new Date(params.expiresAt).toLocaleString("ru-RU", {
    timeZone: "Europe/Warsaw",
  });
  const adminUrl = `${appBaseUrl()}/admin/groups/${params.groupId}`;
  const text =
    `<b>Привязка Telegram-группы</b>\n` +
    `CRM: <b>${escapeHtml(params.groupTitle)}</b>\n\n` +
    `1. Добавь бота в нужный TG-чат <b>админом</b>\n` +
    `2. В этом чате отправь команду:\n` +
    `<code>${escapeHtml(params.command)}</code>\n\n` +
    `Код действует до ${escapeHtml(when)}\n` +
    `<a href="${escapeHtml(adminUrl)}">Карточка группы в CRM →</a>`;

  let dm_sent = 0;
  for (const chatId of chats) {
    try {
      await sendTelegramMessage({
        chatId,
        text,
        parseMode: "HTML",
      });
      dm_sent += 1;
    } catch (e) {
      console.error("[group-telegram] dm bind", chatId, e);
    }
  }
  return {
    dm_sent,
    dm_hint:
      dm_sent > 0
        ? `инструкция ушла в Telegram (${dm_sent})`
        : "не удалось отправить в Telegram",
  };
}

/** Create a short-lived /bind token for linking a TG group chat to a CRM group. */
export async function issueGroupTelegramBindTokenDb(
  groupId: string,
  tenantId: string,
  opts?: { actorPersonId?: string },
) {
  const db = getAdminClient();
  const token = `g${Math.random().toString(36).slice(2, 10)}`;
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("groups")
    .update({
      telegram_bind_token: token,
      telegram_bind_expires_at: expires,
    })
    .eq("id", groupId)
    .eq("tenant_id", tenantId)
    .select("id, title, telegram_chat_id, telegram_bind_token, telegram_bind_expires_at")
    .single();
  if (error) {
    if (/telegram_bind_token|schema cache|does not exist/i.test(error.message)) {
      throw new Error(
        "Нужна миграция 010_group_telegram.sql в Supabase SQL Editor",
      );
    }
    throw new Error(error.message);
  }

  const command = `/bind ${token}`;
  const dm = await notifyStaffBindInstructions({
    tenantId,
    actorPersonId: opts?.actorPersonId,
    groupId: data.id as string,
    groupTitle: data.title as string,
    command,
    expiresAt: expires,
  });

  return {
    group_id: data.id as string,
    title: data.title as string,
    token,
    expires_at: expires,
    command,
    telegram_chat_id: (data.telegram_chat_id as number | null) ?? null,
    ...dm,
  };
}

/** Consume /bind <token> from a Telegram group/supergroup. */
export async function confirmGroupTelegramBindDb(
  token: string,
  chat: { id: number; type?: string; title?: string },
) {
  if (chat.type && chat.type !== "group" && chat.type !== "supergroup") {
    throw new Error("Команду /bind нужно отправить в группе Telegram, не в личке");
  }
  const db = getAdminClient();
  const { data: group, error } = await db
    .from("groups")
    .select("id, title, tenant_id, telegram_bind_token, telegram_bind_expires_at")
    .eq("telegram_bind_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!group) throw new Error("Неверный или просроченный код привязки");
  if (
    group.telegram_bind_expires_at &&
    new Date(group.telegram_bind_expires_at as string) < new Date()
  ) {
    throw new Error("Код привязки истёк — сгенерируй новый в админке");
  }

  // One TG chat → one CRM group
  await db
    .from("groups")
    .update({ telegram_chat_id: null })
    .eq("telegram_chat_id", chat.id)
    .neq("id", group.id);

  const { error: upErr } = await db
    .from("groups")
    .update({
      telegram_chat_id: chat.id,
      telegram_bind_token: null,
      telegram_bind_expires_at: null,
    })
    .eq("id", group.id);
  if (upErr) throw new Error(upErr.message);

  const result = {
    group_id: group.id as string,
    title: group.title as string,
    telegram_chat_id: chat.id,
    chat_title: chat.title ?? null,
  };

  try {
    const chats = await staffTelegramChatIds(group.tenant_id as string);
    const chatLabel = chat.title
      ? escapeHtml(chat.title)
      : `chat_id ${chat.id}`;
    const text =
      `<b>Готово</b> — Telegram привязан\n` +
      `CRM: <b>${escapeHtml(result.title)}</b>\n` +
      `Чат: ${chatLabel}`;
    for (const dmChatId of chats) {
      await sendTelegramMessage({ chatId: dmChatId, text, parseMode: "HTML" });
    }
  } catch (e) {
    console.error("[group-telegram] dm bind ok", e);
  }

  return result;
}

export async function unbindGroupTelegramDb(groupId: string, tenantId: string) {
  const db = getAdminClient();
  const { data, error } = await db
    .from("groups")
    .update({
      telegram_chat_id: null,
      telegram_bind_token: null,
      telegram_bind_expires_at: null,
    })
    .eq("id", groupId)
    .eq("tenant_id", tenantId)
    .select("id, title, telegram_chat_id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function resolveNotifyChatIds(personId: string): Promise<number[]> {
  const db = getAdminClient();
  const { data: person } = await db
    .from("persons")
    .select("id, is_minor")
    .eq("id", personId)
    .maybeSingle();
  if (!person) return [];

  const targets: string[] = [personId];
  if (person.is_minor) {
    const { data: links } = await db
      .from("student_contacts")
      .select("contact_person_id")
      .eq("student_person_id", personId)
      .in("relation_type", ["parent", "guardian"]);
    for (const l of links ?? []) targets.push(l.contact_person_id);
  } else {
    // Parent completing: also cover themselves (already in list)
    const kids = await getChildrenForParentDb(personId);
    // invite is for parent's groups / child's groups separately
    void kids;
  }

  const { data: identities } = await db
    .from("telegram_identities")
    .select("chat_id, person_id")
    .in("person_id", [...new Set(targets)])
    .not("chat_id", "is", null);
  return [
    ...new Set(
      (identities ?? [])
        .map((i) => i.chat_id as number | null)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
}

/** Send TG group invite link to person's (or parent's) DM with the bot. */
export async function sendTelegramGroupInviteForPersonDb(
  personId: string,
  opts?: { groupId?: string },
) {
  const db = getAdminClient();

  const personIds = [personId];
  const kids = await getChildrenForParentDb(personId);
  for (const kid of kids) personIds.push(kid.id);

  let enrQuery = db
    .from("enrollments")
    .select("group_id, student_person_id")
    .in("student_person_id", personIds)
    .eq("status", "active");
  if (opts?.groupId) enrQuery = enrQuery.eq("group_id", opts.groupId);

  const { data: enrollments, error } = await enrQuery;
  if (error) throw new Error(error.message);

  const groupIds = [
    ...new Set((enrollments ?? []).map((e) => e.group_id as string)),
  ];
  if (!groupIds.length) return { sent: 0, groups: [] as string[] };

  const { data: groupRows, error: gErr } = await db
    .from("groups")
    .select("id, title, telegram_chat_id, status")
    .in("id", groupIds)
    .eq("status", "active")
    .not("telegram_chat_id", "is", null);
  if (gErr) throw new Error(gErr.message);

  const groups = (groupRows ?? []).filter((g) => g.telegram_chat_id);
  if (!groups.length) return { sent: 0, groups: [] as string[] };

  const chatIds = await resolveNotifyChatIds(personId);
  if (!chatIds.length) {
    return { sent: 0, groups: groups.map((g) => g.title as string) };
  }

  let sent = 0;
  const titles: string[] = [];
  for (const g of groups) {
    const link = await createTelegramChatInviteLink({
      chatId: g.telegram_chat_id as number,
      name: `PCRM ${g.title}`.slice(0, 32),
      memberLimit: 1,
    });
    if (!link.ok || !link.invite_link) continue;
    for (const chatId of chatIds) {
      await sendTelegramMessage({
        chatId,
        text:
          `<b>Группа в Telegram</b>\n` +
          `${escapeHtml(g.title as string)}\n\n` +
          `<a href="${escapeHtml(link.invite_link)}">Вступить в чат группы →</a>`,
        parseMode: "HTML",
      });
      sent += 1;
    }
    titles.push(g.title as string);
  }
  return { sent, groups: titles };
}
