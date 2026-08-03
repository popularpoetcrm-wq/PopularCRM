import { nanoid } from "nanoid";
import { getAdminClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { STUDIO_POLICY } from "@/lib/studio-policy";
import {
  getCabinetDashboardDb,
  getChildrenForParentDb,
  getPersonRoles,
  markPersonActivated,
} from "@/lib/supabase-data";

function appBaseUrl() {
  return getEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
}

function telegramBotUsername() {
  return process.env.TELEGRAM_BOT_USERNAME || "PopularPoetBot";
}

export type ProfilePatch = {
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  birth_date?: string | null;
  tshirt_size?: string | null;
  telegram_username?: string | null;
};

function cleanTg(raw?: string | null) {
  if (!raw) return null;
  const s = raw.trim().replace(/^@+/, "");
  return s || null;
}

export async function getPersonProfileDb(personId: string) {
  const db = getAdminClient();
  const { data: person, error } = await db
    .from("persons")
    .select(
      "id, tenant_id, full_name, email, phone, birth_date, tshirt_size, is_minor, onboarding_status, accepted_rules_at, activated_at, invited_at",
    )
    .eq("id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!person) throw new Error("Person not found");

  let avatarPath: string | null = null;
  const avRes = await db
    .from("persons")
    .select("avatar_path")
    .eq("id", personId)
    .maybeSingle();
  if (!avRes.error) {
    avatarPath = (avRes.data as { avatar_path?: string | null } | null)?.avatar_path ?? null;
  }

  const roles = await getPersonRoles(personId);
  const { data: tg } = await db
    .from("telegram_identities")
    .select("username, telegram_user_id, verified_at")
    .eq("person_id", personId)
    .maybeSingle();

  const children = await getChildrenForParentDb(personId);
  const { data: parentLinks } = await db
    .from("student_contacts")
    .select("contact_person_id, relation_type")
    .eq("student_person_id", personId)
    .in("relation_type", ["parent", "guardian"]);
  let parents: Array<Record<string, unknown>> = [];
  if (parentLinks?.length) {
    const ids = parentLinks.map((l) => l.contact_person_id);
    const { data } = await db
      .from("persons")
      .select("id, full_name, email, phone")
      .in("id", ids);
    const parentProfiles = [];
    for (const p of data ?? []) {
      const { data: ptg } = await db
        .from("telegram_identities")
        .select("username")
        .eq("person_id", p.id)
        .maybeSingle();
      parentProfiles.push({
        ...p,
        telegram_username: ptg?.username ?? null,
      });
    }
    parents = parentProfiles;
  }

  const dashboard = await getCabinetDashboardDb(personId, person.tenant_id);
  let avatar_url: string | null = null;
  try {
    const { signedAvatarUrl } = await import("@/lib/avatars");
    avatar_url = await signedAvatarUrl(avatarPath);
  } catch {
    avatar_url = null;
  }

  return {
    person: {
      ...person,
      roles,
      avatar_url,
      telegram_linked: Boolean(tg?.verified_at),
      telegram_username_linked: tg?.username ?? null,
      telegram_username: tg?.username ?? null,
    },
    children: await Promise.all(
      children.map(async (c) => {
        const { data: ctg } = await db
          .from("telegram_identities")
          .select("username")
          .eq("person_id", c.id)
          .maybeSingle();
        return { ...c, telegram_username: ctg?.username ?? null };
      }),
    ),
    parents,
    groups: dashboard.groups,
    packages: dashboard.packages,
    schedule: dashboard.schedule,
  };
}

function pendingTelegramUserId(personId: string) {
  const n = Number.parseInt(personId.replace(/-/g, "").slice(0, 8), 16);
  return -Math.max(1, n % 2_000_000_000);
}

async function upsertPreferredTelegram(
  personId: string,
  tenantId: string,
  username: string | null,
) {
  const db = getAdminClient();
  const clean = cleanTg(username);
  const { data: existing } = await db
    .from("telegram_identities")
    .select("id, verified_at, telegram_user_id")
    .eq("person_id", personId)
    .maybeSingle();

  if (!clean) {
    // only clear unverified preferred row
    if (existing && !existing.verified_at) {
      await db.from("telegram_identities").delete().eq("id", existing.id);
    }
    return;
  }

  if (existing?.verified_at) {
    await db
      .from("telegram_identities")
      .update({ username: clean })
      .eq("id", existing.id);
    return;
  }

  if (existing) {
    await db
      .from("telegram_identities")
      .update({ username: clean })
      .eq("id", existing.id);
    return;
  }

  await db.from("telegram_identities").insert({
    tenant_id: tenantId,
    person_id: personId,
    telegram_user_id: pendingTelegramUserId(personId),
    username: clean,
    verified_at: null,
  });
}

export async function updatePersonProfileDb(personId: string, patch: ProfilePatch) {
  const db = getAdminClient();
  const { data: current } = await db
    .from("persons")
    .select("tenant_id")
    .eq("id", personId)
    .single();
  if (!current) throw new Error("Person not found");

  const payload: Record<string, unknown> = {};
  if (patch.full_name !== undefined) {
    const name = patch.full_name.trim();
    if (name.length < 2) throw new Error("Имя слишком короткое");
    payload.full_name = name;
  }
  if (patch.phone !== undefined) payload.phone = patch.phone?.trim() || null;
  if (patch.email !== undefined) {
    payload.email = patch.email?.trim().toLowerCase() || null;
  }
  if (patch.birth_date !== undefined) {
    payload.birth_date = patch.birth_date || null;
  }
  if (patch.tshirt_size !== undefined) {
    payload.tshirt_size = patch.tshirt_size?.trim().toUpperCase() || null;
  }
  if (Object.keys(payload).length) {
    const { error } = await db.from("persons").update(payload).eq("id", personId);
    if (error) throw new Error(error.message);
  }
  if (patch.telegram_username !== undefined) {
    await upsertPreferredTelegram(
      personId,
      current.tenant_id,
      patch.telegram_username,
    );
  }
  return getPersonProfileDb(personId);
}

export async function invitePersonDb(
  personId: string,
  opts?: { actorId?: string; email?: string },
) {
  const db = getAdminClient();
  const { data: person, error } = await db
    .from("persons")
    .select("*")
    .eq("id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!person) throw new Error("Person not found");

  let target = person;
  if (person.is_minor) {
    const { data: link } = await db
      .from("student_contacts")
      .select("contact_person_id")
      .eq("student_person_id", person.id)
      .in("relation_type", ["parent", "guardian"])
      .eq("is_primary", true)
      .maybeSingle();
    const parentId = link?.contact_person_id;
    if (!parentId) {
      const { data: anyParent } = await db
        .from("student_contacts")
        .select("contact_person_id")
        .eq("student_person_id", person.id)
        .in("relation_type", ["parent", "guardian"])
        .limit(1)
        .maybeSingle();
      if (!anyParent) throw new Error("У ребёнка нет родителя — пригласи родителя");
      const { data: parent } = await db
        .from("persons")
        .select("*")
        .eq("id", anyParent.contact_person_id)
        .single();
      target = parent;
    } else {
      const { data: parent } = await db
        .from("persons")
        .select("*")
        .eq("id", parentId)
        .single();
      target = parent;
    }
  }

  if (opts?.email) {
    const email = opts.email.trim().toLowerCase();
    await db.from("persons").update({ email }).eq("id", target.id);
    target.email = email;
  }
  if (!target.email) {
    // Synthetic email so TG-linked students can get a magic link without real mail
    const synthetic = `tg.${String(target.id).replace(/-/g, "").slice(0, 12)}@cabinet.local`;
    await db.from("persons").update({ email: synthetic }).eq("id", target.id);
    target.email = synthetic;
  }

  const token = nanoid(24);
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: invite, error: invErr } = await db
    .from("person_invites")
    .insert({
      tenant_id: target.tenant_id,
      person_id: target.id,
      email: target.email,
      token,
      expires_at: expires,
      created_by: opts?.actorId ?? null,
    })
    .select("*")
    .single();
  if (invErr) throw new Error(invErr.message);

  // Never downgrade someone who already finished welcome.
  const prev = (target.onboarding_status as string) ?? "draft";
  const nextStatus = prev === "complete" ? "complete" : "invited";
  await db
    .from("persons")
    .update({
      onboarding_status: nextStatus,
      invited_at: new Date().toISOString(),
    })
    .eq("id", target.id);

  const magicUrl = `${appBaseUrl()}/login/magic?token=${token}`;
  const env = getEnv();
  let emailed = false;
  const realEmail =
    Boolean(target.email) && !String(target.email).endsWith("@cabinet.local");
  if (env.RESEND_API_KEY && realEmail) {
    const { Resend } = await import("resend");
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: env.EMAIL_FROM!,
      to: target.email,
      subject: "Zaproszenie do kabinetu — Popular Poet",
      text: `Cześć ${target.full_name}!\n\nTwój link: ${magicUrl}\nLub zaloguj się kodem na ${appBaseUrl()}/login\n`,
    });
    emailed = true;
  }

  return {
    invite,
    magicUrl,
    emailed,
    person: {
      id: target.id,
      full_name: target.full_name,
      email: target.email,
      onboarding_status: nextStatus,
    },
  };
}

export async function inviteManyDb(personIds: string[], actorId?: string) {
  const results = [];
  for (const id of personIds) {
    try {
      results.push({ ok: true as const, ...(await invitePersonDb(id, { actorId })) });
    } catch (e) {
      results.push({
        ok: false as const,
        personId: id,
        error: e instanceof Error ? e.message : "fail",
      });
    }
  }
  return results;
}

export async function inviteGroupDb(groupId: string, actorId?: string) {
  const db = getAdminClient();
  const { data: enrollments } = await db
    .from("enrollments")
    .select("student_person_id")
    .eq("group_id", groupId)
    .eq("status", "active");
  const ids = [...new Set((enrollments ?? []).map((e) => e.student_person_id))];
  return inviteManyDb(ids, actorId);
}

/**
 * Open cabinet without hand-sending invites one by one:
 * - activate everyone who already has a real email (OTP login works)
 * - optionally create magic links + push to Telegram for linked accounts
 */
export async function openCabinetAccessDb(opts?: {
  actorId?: string;
  sendTelegram?: boolean;
  onlyPersonIds?: string[];
}) {
  const db = getAdminClient();
  const sendTg = opts?.sendTelegram !== false;
  const { sendTelegramMessage } = await import("@/integrations/telegram");

  let query = db
    .from("persons")
    .select("id, full_name, email, onboarding_status, tenant_id")
    .eq("status", "active");
  if (opts?.onlyPersonIds?.length) {
    query = query.in("id", opts.onlyPersonIds);
  }
  const { data: persons, error } = await query;
  if (error) throw new Error(error.message);

  const { data: identities } = await db
    .from("telegram_identities")
    .select("person_id, chat_id, username")
    .not("chat_id", "is", null);
  const tgByPerson = new Map(
    (identities ?? []).map((i) => [i.person_id as string, i]),
  );

  let activatedEmail = 0;
  let linksCreated = 0;
  let tgSent = 0;
  const samples: Array<{ name: string; magicUrl?: string; via: string }> = [];

  for (const p of persons ?? []) {
    const email = (p.email as string | null) ?? null;
    const isRealEmail = Boolean(email && !email.endsWith("@cabinet.local"));
    const tg = tgByPerson.get(p.id);

    if (isRealEmail) {
      const st = p.onboarding_status as string;
      if (st === "draft" || st === "invited") {
        await db
          .from("persons")
          .update({
            onboarding_status: "activated",
            activated_at: new Date().toISOString(),
          })
          .eq("id", p.id);
        activatedEmail += 1;
      }
    }

    if (tg?.chat_id || opts?.onlyPersonIds?.length) {
      try {
        const inv = await invitePersonDb(p.id, { actorId: opts?.actorId });
        linksCreated += 1;
        if (sendTg && tg?.chat_id) {
          await sendTelegramMessage({
            chatId: tg.chat_id as number,
            text:
              `Привет, ${p.full_name}!\n\n` +
              `Вход в кабинет студии:\n${inv.magicUrl}\n\n` +
              (isRealEmail
                ? `Или ${appBaseUrl()}/login → ${email}`
                : `Ссылка действует 7 дней.`),
          });
          tgSent += 1;
          if (samples.length < 5) {
            samples.push({ name: p.full_name, magicUrl: inv.magicUrl, via: "telegram" });
          }
        } else if (samples.length < 5) {
          samples.push({ name: p.full_name, magicUrl: inv.magicUrl, via: "link" });
        }
      } catch {
        /* skip broken rows */
      }
    }
  }

  return {
    persons: (persons ?? []).length,
    activated_email: activatedEmail,
    links_created: linksCreated,
    telegram_sent: tgSent,
    samples,
    note:
      "У кого есть настоящий email — можно просто /login. Кому привязан TG — ушла ссылка в бота.",
  };
}

export async function issueLoginLinkForTelegramUserDb(telegramUserId: number) {
  const db = getAdminClient();
  const { data: identity } = await db
    .from("telegram_identities")
    .select("person_id, chat_id, username")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (!identity) throw new Error("Telegram не привязан к кабинету");
  const inv = await invitePersonDb(identity.person_id);
  return {
    ...inv,
    chat_id: identity.chat_id as number | null,
    username: identity.username as string | null,
  };
}

export async function getBotStatusForTelegramUserDb(telegramUserId: number) {
  const db = getAdminClient();
  const { data: identity } = await db
    .from("telegram_identities")
    .select("person_id, chat_id, username")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (!identity) return null;

  const { data: person } = await db
    .from("persons")
    .select("id, full_name, email, tenant_id")
    .eq("id", identity.person_id)
    .maybeSingle();
  if (!person) return null;

  const dash = await getCabinetDashboardDb(person.id, person.tenant_id);
  const schedule = [...(dash.schedule ?? [])]
    .filter((s: { status: string }) => s.status === "scheduled")
    .sort((a: { starts_at: string }, b: { starts_at: string }) =>
      a.starts_at.localeCompare(b.starts_at),
    )
    .slice(0, 6) as Array<{
    title: string;
    starts_at: string;
    myStatus?: string | null;
  }>;
  const next = schedule[0];
  const makeupsAvailable = ((dash.makeups ?? []) as Array<{ status: string }>).filter(
    (m) => m.status === "available",
  ).length;

  return {
    person,
    username: identity.username,
    groups: dash.groups ?? [],
    money: dash.money,
    packages: dash.packages ?? [],
    schedule,
    makeupsAvailable,
    nextSession: next ?? null,
  };
}

export async function consumeInviteTokenDb(token: string) {
  const db = getAdminClient();
  const { data: invite, error } = await db
    .from("person_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invite) throw new Error("Invalid invite token");
  if (invite.consumed_at) throw new Error("Invite already used");
  if (new Date(invite.expires_at) < new Date()) throw new Error("Invite expired");

  await db
    .from("person_invites")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", invite.id);

  await markPersonActivated(invite.person_id);
  const { data: person } = await db
    .from("persons")
    .select("id, tenant_id, full_name, email, onboarding_status")
    .eq("id", invite.person_id)
    .single();
  if (!person) throw new Error("Person not found");
  const roles = await getPersonRoles(person.id);
  return { ...person, roles };
}

export async function getWelcomePayloadDb(personId: string) {
  const profile = await getPersonProfileDb(personId);
  const nextSession = [...(profile.schedule ?? [])]
    .filter((s: { status: string; starts_at: string }) => s.status === "scheduled")
    .sort(
      (a: { starts_at: string }, b: { starts_at: string }) =>
        +new Date(a.starts_at) - +new Date(b.starts_at),
    )[0];

  return {
    person: {
      id: profile.person.id,
      full_name: profile.person.full_name,
      email: profile.person.email,
      phone: profile.person.phone,
      birth_date: profile.person.birth_date,
      tshirt_size: profile.person.tshirt_size,
      telegram_username: profile.person.telegram_username,
      is_minor: profile.person.is_minor,
      roles: profile.person.roles,
    },
    onboarding_status: profile.person.onboarding_status,
    groups: profile.groups,
    packages: profile.packages,
    nextSession: nextSession
      ? { title: nextSession.title, starts_at: nextSession.starts_at }
      : undefined,
    children: profile.children,
    parents: profile.parents,
    telegram_linked: profile.person.telegram_linked,
    policy: {
      absentNotifyCutoffHours: STUDIO_POLICY.absentNotifyCutoffHours,
      minAttendeesToHold: STUDIO_POLICY.minAttendeesToHold,
    },
  };
}

export async function completeOnboardingDb(
  personId: string,
  input: {
    acceptRules: boolean;
    acceptPhoto?: boolean;
    profile?: ProfilePatch;
    children?: Array<{ id: string } & ProfilePatch>;
    ip?: string | null;
    userAgent?: string | null;
  },
) {
  if (!input.acceptRules) throw new Error("Нужно принять оферту и правила студии");
  if (input.acceptPhoto === false) {
    throw new Error("Нужно принять согласие на фото (или отметьте чекбокс)");
  }

  const db = getAdminClient();
  const { data: person } = await db
    .from("persons")
    .select("tenant_id")
    .eq("id", personId)
    .maybeSingle();
  if (!person) throw new Error("Person not found");

  // Mark complete FIRST so a later consent/profile glitch can't trap the user.
  const now = new Date().toISOString();
  const { error: statusErr } = await db
    .from("persons")
    .update({
      onboarding_status: "complete",
      accepted_rules_at: now,
    })
    .eq("id", personId);
  if (statusErr) throw new Error(statusErr.message);

  if (input.profile) {
    try {
      await updatePersonProfileDb(personId, input.profile);
    } catch (e) {
      console.error("[onboarding] profile update", e);
    }
  }
  if (input.children?.length) {
    const kids = await getChildrenForParentDb(personId);
    const allowed = new Set(kids.map((k) => k.id));
    for (const child of input.children) {
      if (!allowed.has(child.id)) continue;
      const { id, ...patch } = child;
      try {
        await updatePersonProfileDb(id, patch);
      } catch (e) {
        console.error("[onboarding] child profile", id, e);
      }
    }
  }

  try {
    const { acceptConsentsDb } = await import("@/lib/consents");
    const { REQUIRED_CONSENT_KEYS } = await import("@/lib/legal");
    await acceptConsentsDb({
      personId,
      tenantId: person.tenant_id,
      keys: [...REQUIRED_CONSENT_KEYS],
      acceptedByPersonId: personId,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    const kids = await getChildrenForParentDb(personId);
    for (const child of kids) {
      await acceptConsentsDb({
        personId: child.id,
        tenantId: person.tenant_id,
        keys: [...REQUIRED_CONSENT_KEYS],
        acceptedByPersonId: personId,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
  } catch (e) {
    // Consents table may be missing (migration 007) — status already complete.
    console.error("[onboarding] consents", e);
  }

  try {
    const { sendTelegramGroupInviteForPersonDb } = await import(
      "@/lib/group-telegram"
    );
    await sendTelegramGroupInviteForPersonDb(personId);
  } catch (e) {
    console.error("[onboarding] tg group invite", e);
  }

  return getWelcomePayloadDb(personId);
}

export async function createTelegramLinkTokenDb(personId: string) {
  const db = getAdminClient();
  const { data: person } = await db
    .from("persons")
    .select("id, tenant_id")
    .eq("id", personId)
    .maybeSingle();
  if (!person) throw new Error("Person not found");

  const token = nanoid(16);
  const { error } = await db.from("telegram_link_tokens").insert({
    tenant_id: person.tenant_id,
    person_id: personId,
    token,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);

  const deepLink = `https://t.me/${telegramBotUsername()}?start=link_${token}`;
  return { token, deepLink };
}

export async function confirmTelegramLinkDb(
  token: string,
  opts?: {
    telegram_user_id?: number;
    username?: string;
    chat_id?: number;
  },
) {
  const db = getAdminClient();
  const { data: row, error } = await db
    .from("telegram_link_tokens")
    .select("*")
    .eq("token", token)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Invalid or expired telegram token");

  await db
    .from("telegram_link_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);

  const username = cleanTg(opts?.username);
  const telegramUserId =
    opts?.telegram_user_id ?? Math.floor(1e9 + Math.random() * 1e9);

  await db.from("telegram_identities").delete().eq("person_id", row.person_id);
  // also clear same telegram_user_id on other persons
  await db
    .from("telegram_identities")
    .delete()
    .eq("telegram_user_id", telegramUserId);

  const { error: tgErr } = await db.from("telegram_identities").insert({
    tenant_id: row.tenant_id,
    person_id: row.person_id,
    telegram_user_id: telegramUserId,
    chat_id: opts?.chat_id ?? null,
    username,
    verified_at: new Date().toISOString(),
  });
  if (tgErr) throw new Error(tgErr.message);

  try {
    const { sendTelegramGroupInviteForPersonDb } = await import(
      "@/lib/group-telegram"
    );
    await sendTelegramGroupInviteForPersonDb(row.person_id);
  } catch (e) {
    console.error("[telegram-link] group invite", e);
  }

  return { person_id: row.person_id, username, chat_id: opts?.chat_id ?? null };
}

export async function getStudentCardDb(personId: string, tenantId: string) {
  const profile = await getPersonProfileDb(personId);
  if (profile.person.tenant_id !== tenantId) throw new Error("Not found");
  const db = getAdminClient();

  const { data: enrollments } = await db
    .from("enrollments")
    .select("id")
    .eq("student_person_id", personId);
  const enrIds = (enrollments ?? []).map((e) => e.id);

  let payments: Array<Record<string, unknown>> = [];
  if (enrIds.length) {
    const { data } = await db
      .from("payments")
      .select("*")
      .or(`payer_person_id.eq.${personId},enrollment_id.in.(${enrIds.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(20);
    payments = data ?? [];
  } else {
    const { data } = await db
      .from("payments")
      .select("*")
      .eq("payer_person_id", personId)
      .order("created_at", { ascending: false })
      .limit(20);
    payments = data ?? [];
  }

  const { data: invites } = await db
    .from("person_invites")
    .select("email, created_at, consumed_at, expires_at")
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: makeups } = await db
    .from("makeup_credits")
    .select("status, valid_until")
    .eq("student_person_id", personId)
    .limit(20);

  const { data: attendanceRows } = await db
    .from("attendance")
    .select("id, status, attendance_type, session_id, marked_at")
    .eq("student_person_id", personId)
    .order("marked_at", { ascending: false })
    .limit(200);

  const sessionIds = [
    ...new Set((attendanceRows ?? []).map((a) => a.session_id).filter(Boolean)),
  ];
  const { data: sessionRows } = sessionIds.length
    ? await db
        .from("sessions")
        .select("id, starts_at, group_id, status")
        .in("id", sessionIds)
    : { data: [] as Array<{ id: string; starts_at: string; group_id: string; status: string }> };

  const groupIds = [
    ...new Set((sessionRows ?? []).map((s) => s.group_id).filter(Boolean)),
  ];
  const { data: groupRows } = groupIds.length
    ? await db.from("groups").select("id, title").in("id", groupIds)
    : { data: [] as Array<{ id: string; title: string }> };

  const sessionMap = new Map((sessionRows ?? []).map((s) => [s.id, s]));
  const groupMap = new Map((groupRows ?? []).map((g) => [g.id, g.title]));

  const attendance = (attendanceRows ?? []).map((a) => {
    const session = sessionMap.get(a.session_id);
    return {
      status: a.status as string,
      attendance_type: a.attendance_type as string,
      session_id: a.session_id as string,
      starts_at: session?.starts_at ?? a.marked_at,
      session_title: session
        ? groupMap.get(session.group_id) ?? "Занятие"
        : "Занятие",
      group_title: session ? groupMap.get(session.group_id) ?? null : null,
    };
  });

  // Sort by session time desc for display
  attendance.sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)));

  const summary = {
    total: attendance.length,
    present: attendance.filter((a) => a.status === "present").length,
    absent: attendance.filter((a) => a.status === "absent").length,
    absent_notified: attendance.filter((a) => a.status === "absent_notified").length,
    cancelled_by_studio: attendance.filter((a) => a.status === "cancelled_by_studio")
      .length,
    makeup: attendance.filter((a) => a.attendance_type === "makeup").length,
  };

  return {
    person: profile.person,
    groups: profile.groups,
    packages: profile.packages,
    payments,
    attendance: attendance.slice(0, 30),
    attendance_summary: summary,
    invites: invites ?? [],
    parents: profile.parents,
    children: profile.children,
    makeups: makeups ?? [],
  };
}
