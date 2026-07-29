import { nanoid } from "nanoid";
import { addDays, addHours } from "date-fns";
import type { BrandId } from "@/lib/brands";
import { checkoutUrl } from "@/lib/brands";
import {
  audit,
  notify,
  getExtendedDemo,
  createStudent,
  linkParentChild,
  activatePackageForEnrollment,
} from "@/lib/demo-ops";
import type { DemoPerson, OnboardingStatus } from "@/lib/demo-store";
import { getDemoState } from "@/lib/demo-store";
import { STUDIO_POLICY } from "@/lib/studio-policy";

export type DemoInvite = {
  id: string;
  person_id: string;
  email: string;
  token: string;
  expires_at: string;
  consumed_at?: string;
  created_at: string;
  created_by?: string;
};

export type DemoTelegramLinkToken = {
  id: string;
  person_id: string;
  token: string;
  expires_at: string;
  consumed_at?: string;
};

export type DemoTelegramIdentity = {
  person_id: string;
  telegram_user_id: number;
  username?: string;
  verified_at: string;
};

type OnboardingExt = ReturnType<typeof getExtendedDemo> & {
  invites: DemoInvite[];
  telegram_link_tokens: DemoTelegramLinkToken[];
  telegram_identities: DemoTelegramIdentity[];
};

function onb(): OnboardingExt {
  const state = getExtendedDemo() as OnboardingExt;
  if (!state.invites) state.invites = [];
  if (!state.telegram_link_tokens) state.telegram_link_tokens = [];
  if (!state.telegram_identities) state.telegram_identities = [];
  return state;
}

export function appBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function telegramBotUsername() {
  return process.env.TELEGRAM_BOT_USERNAME ?? "PopularPoetBot";
}

function setStatus(person: DemoPerson, status: OnboardingStatus) {
  person.onboarding_status = status;
  if (status === "invited") person.invited_at = new Date().toISOString();
  if (status === "activated") person.activated_at = new Date().toISOString();
  if (status === "complete") {
    person.accepted_rules_at = person.accepted_rules_at ?? new Date().toISOString();
  }
}

export function listStudentsWithOnboarding(brandId: BrandId) {
  const state = onb();
  const studentIds = new Set(
    state.enrollments.filter((e) => e.brand_id === brandId).map((e) => e.student_person_id),
  );
  // include parents paying for kids brand + students without enrollment yet (draft)
  const parents = state.contacts
    .filter((c) => studentIds.has(c.student_person_id))
    .map((c) => c.contact_person_id);

  return state.persons
    .filter(
      (p) =>
        studentIds.has(p.id) ||
        parents.includes(p.id) ||
        (p.roles.includes("student") && !p.is_minor),
    )
    .map((p) => {
      const tg = state.telegram_identities.find((t) => t.person_id === p.id);
      const lastInvite = state.invites.find((i) => i.person_id === p.id && !i.consumed_at);
      const enrollment = state.enrollments.find(
        (e) => e.student_person_id === p.id && e.brand_id === brandId,
      );
      const pkg = enrollment
        ? state.packages.find((x) => x.enrollment_id === enrollment.id && x.status === "active")
        : undefined;
      return {
        ...p,
        onboarding_status: p.onboarding_status ?? "draft",
        telegram_linked: Boolean(tg) || Boolean(p.telegram_linked),
        telegram_username: tg?.username,
        invite_pending: Boolean(lastInvite),
        invited_at: p.invited_at,
        credits_available: pkg?.credits_available,
        group_id: enrollment?.group_id,
      };
    });
}

/** Create or refresh invite; notify via email (+ inbox). */
export function invitePerson(
  personId: string,
  opts?: { actor?: string; silent?: boolean },
) {
  const state = onb();
  const person = state.persons.find((p) => p.id === personId);
  if (!person) throw new Error("Person not found");
  if (!person.email) throw new Error("Email required for invite");

  // invite goes to parent for minors
  let target = person;
  if (person.is_minor) {
    const contact = state.contacts.find(
      (c) => c.student_person_id === person.id && c.relation_type === "parent",
    );
    if (!contact) throw new Error("Minor has no parent contact — invite parent instead");
    const parent = state.persons.find((p) => p.id === contact.contact_person_id);
    if (!parent) throw new Error("Parent not found");
    target = parent;
  }

  const token = nanoid(24);
  const invite: DemoInvite = {
    id: `inv-${nanoid(8)}`,
    person_id: target.id,
    email: target.email,
    token,
    expires_at: addDays(new Date(), 7).toISOString(),
    created_at: new Date().toISOString(),
    created_by: opts?.actor,
  };
  state.invites.unshift(invite);
  setStatus(target, "invited");

  const magicUrl = `${appBaseUrl()}/login/magic?token=${token}`;
  if (!opts?.silent) {
    notify(
      target.id,
      "invite.sent",
      `Приглашение в личный кабинет: ${magicUrl}. «Не приду» — за ${STUDIO_POLICY.absentNotifyCutoffHours}+ ч.`,
      "email",
    );
    notify(
      target.id,
      "invite.sent",
      `Тебе открыли кабинет. Войди по ссылке из письма или: ${magicUrl}`,
      "inbox",
    );
  }

  audit("invite.sent", "person_invite", invite.id, { personId: target.id, magicUrl }, opts?.actor);
  return { invite, magicUrl, person: target };
}

export function inviteMany(personIds: string[], actor?: string) {
  const results = [];
  for (const id of personIds) {
    try {
      results.push({ ok: true as const, ...invitePerson(id, { actor }) });
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

export function consumeInviteToken(token: string) {
  const state = onb();
  const invite = state.invites.find((i) => i.token === token);
  if (!invite) throw new Error("Invalid invite token");
  if (invite.consumed_at) throw new Error("Invite already used");
  if (new Date(invite.expires_at) < new Date()) throw new Error("Invite expired");

  const person = state.persons.find((p) => p.id === invite.person_id);
  if (!person) throw new Error("Person not found");

  invite.consumed_at = new Date().toISOString();
  if (person.onboarding_status === "draft" || person.onboarding_status === "invited") {
    setStatus(person, "activated");
  }

  audit("invite.consumed", "person_invite", invite.id, { personId: person.id });
  return person;
}

export function createTelegramLinkToken(personId: string) {
  const state = onb();
  const person = state.persons.find((p) => p.id === personId);
  if (!person) throw new Error("Person not found");

  const token = nanoid(16);
  const row: DemoTelegramLinkToken = {
    id: `tglink-${nanoid(6)}`,
    person_id: personId,
    token,
    expires_at: addHours(new Date(), 2).toISOString(),
  };
  state.telegram_link_tokens.unshift(row);
  const deepLink = `https://t.me/${telegramBotUsername()}?start=link_${token}`;
  return { token, deepLink, expires_at: row.expires_at };
}

export function confirmTelegramLink(
  token: string,
  opts?: { telegram_user_id?: number; username?: string },
) {
  const state = onb();
  const row = state.telegram_link_tokens.find((t) => t.token === token);
  if (!row) throw new Error("Invalid telegram link token");
  if (row.consumed_at) throw new Error("Token already used");
  if (new Date(row.expires_at) < new Date()) throw new Error("Token expired");

  row.consumed_at = new Date().toISOString();
  const identity: DemoTelegramIdentity = {
    person_id: row.person_id,
    telegram_user_id: opts?.telegram_user_id ?? Math.floor(Math.random() * 1e9),
    username: opts?.username ?? "demo_user",
    verified_at: new Date().toISOString(),
  };
  state.telegram_identities = state.telegram_identities.filter(
    (t) => t.person_id !== row.person_id,
  );
  state.telegram_identities.push(identity);

  const person = state.persons.find((p) => p.id === row.person_id);
  if (person) person.telegram_linked = true;

  notify(row.person_id, "telegram.linked", "Telegram подключён. Будем присылать напоминания.", "inbox");
  audit("telegram.linked", "telegram_identity", row.person_id, identity);
  return identity;
}

export function completeOnboarding(personId: string, acceptRules = true) {
  const state = onb();
  const person = state.persons.find((p) => p.id === personId);
  if (!person) throw new Error("Person not found");
  if (acceptRules) {
    person.accepted_rules_at = new Date().toISOString();
  }
  setStatus(person, "complete");
  audit("onboarding.complete", "person", person.id, {
    onboarding_status: person.onboarding_status,
  });
  return person;
}

export function markActivatedOnLogin(personId: string) {
  const state = getDemoState();
  const person = state.persons.find((p) => p.id === personId);
  if (!person) return;
  const status = person.onboarding_status ?? "complete";
  if (status === "draft" || status === "invited") {
    setStatus(person, "activated");
  }
}

/** CSV: email,full_name,phone,group,credits_left,makeups_left,parent_email */
export function importStudentsCsv(
  csv: string,
  brandId: BrandId,
  actor?: string,
) {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("Empty CSV");

  const header = lines[0]!.toLowerCase();
  const hasHeader = header.includes("email") && header.includes("full_name");
  const rows = hasHeader ? lines.slice(1) : lines;
  const state = onb();
  const results: Array<{ ok: boolean; email?: string; error?: string; personId?: string }> =
    [];

  for (const line of rows) {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const [email, full_name, phone, groupTitle, creditsLeft, makeupsLeft, parentEmail] =
      cols;
    if (!email || !full_name) {
      results.push({ ok: false, error: "email and full_name required", email });
      continue;
    }

    try {
      const existing = state.persons.find(
        (p) => p.email.toLowerCase() === email.toLowerCase(),
      );
      let person = existing;
      let enrollmentId: string | undefined;

      const group = groupTitle
        ? state.groups.find(
            (g) =>
              g.brand_id === brandId &&
              g.title.toLowerCase() === groupTitle.toLowerCase(),
          )
        : undefined;

      if (!person) {
        const created = createStudent({
          full_name,
          email,
          phone,
          brand_id: brandId,
          group_id: group?.id,
          actor,
        });
        person = created.person;
        enrollmentId = created.enrollmentId;
        person.onboarding_status = "draft";
      } else if (group && !state.enrollments.some(
        (e) => e.student_person_id === person!.id && e.group_id === group.id,
      )) {
        enrollmentId = `enr-${nanoid(8)}`;
        state.enrollments.push({
          id: enrollmentId,
          brand_id: brandId,
          student_person_id: person.id,
          group_id: group.id,
          status: "active",
        });
      } else {
        enrollmentId = state.enrollments.find(
          (e) => e.student_person_id === person!.id && e.brand_id === brandId,
        )?.id;
      }

      const credits = creditsLeft ? Number(creditsLeft) : NaN;
      if (enrollmentId && Number.isFinite(credits) && credits > 0) {
        const pkg = activatePackageForEnrollment(enrollmentId);
        pkg.credits_available = Math.min(credits, pkg.credits_total);
        if (credits > pkg.credits_total) {
          pkg.credits_total = credits;
          pkg.credits_available = credits;
        }
      }

      const makeups = makeupsLeft ? Number(makeupsLeft) : 0;
      if (Number.isFinite(makeups) && makeups > 0 && person) {
        for (let i = 0; i < makeups; i++) {
          state.makeups.push({
            id: `makeup-${nanoid(6)}`,
            student_person_id: person.id,
            status: "available",
            valid_until: addDays(new Date(), STUDIO_POLICY.makeupValidityDays).toISOString(),
          });
        }
      }

      if (parentEmail && person) {
        let parent = state.persons.find(
          (p) => p.email.toLowerCase() === parentEmail.toLowerCase(),
        );
        if (!parent) {
          parent = {
            id: `person-${nanoid(8)}`,
            full_name: `Parent of ${full_name}`,
            email: parentEmail,
            roles: ["parent", "payer"],
            onboarding_status: "draft",
            is_minor: false,
          };
          state.persons.push(parent);
        }
        person.is_minor = true;
        if (!person.roles.includes("student")) person.roles.push("student");
        linkParentChild({
          student_person_id: person.id,
          contact_person_id: parent.id,
          relation_type: "parent",
          actor,
        });
      }

      results.push({ ok: true, email, personId: person!.id });
    } catch (e) {
      results.push({
        ok: false,
        email,
        error: e instanceof Error ? e.message : "fail",
      });
    }
  }

  audit("students.imported", "person", undefined, { count: results.length, brandId }, actor);
  return results;
}

/** Public trial/event checkout: find-or-create person + pending payment. */
export function startGuestCheckout(input: {
  offer_id: string;
  email: string;
  full_name: string;
  phone?: string;
}) {
  const state = onb();
  const offer = state.offers.find((o) => o.id === input.offer_id);
  if (!offer || offer.status !== "open") throw new Error("Offer not found");

  let person = state.persons.find(
    (p) => p.email.toLowerCase() === input.email.toLowerCase(),
  );
  if (!person) {
    const created = createStudent({
      full_name: input.full_name,
      email: input.email,
      phone: input.phone,
      brand_id: offer.brand_id,
      roles: ["student", "payer"],
    });
    person = created.person;
    person.onboarding_status = "draft";
  }

  const id = `pay-${nanoid(8)}`;
  const payment = {
    id,
    brand_id: offer.brand_id,
    payer_person_id: person.id,
    enrollment_id: "",
    amount: offer.amount,
    amount_paid: 0,
    status: "pending",
    payment_method: "online",
    description: offer.title,
    payment_url: checkoutUrl(offer.product_kind, id),
    product_kind: offer.product_kind,
    offer_id: offer.id,
    created_at: new Date().toISOString(),
  };
  state.payments.unshift(payment);
  audit("checkout.guest_started", "payment", payment.id, {
    offer_id: offer.id,
    email: input.email,
  });
  return { payment, person, checkoutUrl: payment.payment_url! };
}

/** After trial/event paid — auto-invite to LK + package offer for trials. */
export function afterTrialOrEventPaid(paymentId: string) {
  const state = onb();
  const payment = state.payments.find((p) => p.id === paymentId);
  if (!payment) return null;
  const kind = payment.product_kind ?? "package";
  if (kind !== "trial" && kind !== "event") return null;

  const person = state.persons.find((p) => p.id === payment.payer_person_id);
  if (!person) return null;

  if (kind === "trial") {
    const group = state.groups.find((g) => g.brand_id === payment.brand_id);
    if (
      group &&
      !state.enrollments.some(
        (e) => e.student_person_id === person.id && e.group_id === group.id,
      )
    ) {
      state.enrollments.push({
        id: `enr-${nanoid(8)}`,
        brand_id: payment.brand_id,
        student_person_id: person.id,
        group_id: group.id,
        status: "active",
      });
    }
  }

  let inviteResult: ReturnType<typeof invitePerson> | null = null;
  const status = person.onboarding_status ?? "draft";
  if (status === "draft") {
    inviteResult = invitePerson(person.id, { actor: "p24-auto" });
  } else {
    notify(
      person.id,
      "payment.paid",
      kind === "trial"
        ? "Пробное оплачено. Смотри расписание в кабинете."
        : "Ивент оплачен.",
      "inbox",
    );
  }

  if (kind === "trial") {
    notify(
      person.id,
      "package.offer",
      "Понравилось пробное? Оформи пакет 4 занятий в кабинете → Оплата.",
      "inbox",
    );
  }

  return {
    invited: Boolean(inviteResult),
    magicUrl: inviteResult?.magicUrl,
    invite: inviteResult?.invite,
    person,
  };
}

/** Invite all active students (or their parents) in a group. */
export function inviteGroup(groupId: string, actor?: string) {
  const state = onb();
  const ids = state.enrollments
    .filter((e) => e.group_id === groupId && e.status === "active")
    .map((e) => e.student_person_id);
  return inviteMany([...new Set(ids)], actor);
}

export function getWelcomePayload(personId: string) {
  const state = onb();
  const person = state.persons.find((p) => p.id === personId);
  if (!person) throw new Error("Person not found");

  const children = state.contacts
    .filter((c) => c.contact_person_id === personId)
    .map((c) => state.persons.find((p) => p.id === c.student_person_id))
    .filter(Boolean);

  const myIds = [personId, ...children.map((c) => c!.id)];
  const enrollments = state.enrollments.filter((e) =>
    myIds.includes(e.student_person_id),
  );
  const groups = state.groups.filter((g) =>
    enrollments.some((e) => e.group_id === g.id),
  );
  const packages = state.packages.filter((p) =>
    enrollments.some((e) => e.id === p.enrollment_id),
  );
  const nextSession = state.sessions
    .filter(
      (s) =>
        s.status === "scheduled" &&
        enrollments.some((e) => e.group_id === s.group_id),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];

  const tg = state.telegram_identities.find((t) => t.person_id === personId);

  return {
    person,
    onboarding_status: person.onboarding_status ?? "draft",
    groups,
    packages,
    nextSession,
    children,
    telegram_linked: Boolean(tg) || Boolean(person.telegram_linked),
    policy: {
      absentNotifyCutoffHours: STUDIO_POLICY.absentNotifyCutoffHours,
      minAttendeesToHold: STUDIO_POLICY.minAttendeesToHold,
    },
  };
}
