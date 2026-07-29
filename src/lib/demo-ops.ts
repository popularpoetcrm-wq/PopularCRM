import { nanoid } from "nanoid";
import { addDays } from "date-fns";
import type { BrandId, ProductKind } from "@/lib/brands";
import { checkoutUrl } from "@/lib/brands";
import type { PackagePlanSnapshot } from "@/lib/types/domain";
import {
  getDemoState,
  touchDemoState,
  type DemoPerson,
  type DemoState,
} from "@/lib/demo-store";

export type DemoAudit = {
  id: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  actor?: string;
  after?: unknown;
  created_at: string;
};

export type DemoNotification = {
  id: string;
  recipient_person_id: string;
  channel: "telegram" | "email" | "inbox";
  template_code: string;
  text: string;
  status: "queued" | "sent" | "failed";
  created_at: string;
};

export type DemoContact = {
  id: string;
  student_person_id: string;
  contact_person_id: string;
  relation_type: "parent" | "guardian" | "payer";
  can_pay: boolean;
};

export type DemoEventOffer = {
  id: string;
  brand_id: BrandId;
  product_kind: ProductKind;
  title: string;
  amount: number;
  starts_at: string;
  capacity: number;
  status: "open" | "closed";
};

type ExtendedDemo = DemoState & {
  audit: DemoAudit[];
  notifications: DemoNotification[];
  contacts: DemoContact[];
  offers: DemoEventOffer[];
  payments: Array<
    DemoState["payments"][number] & {
      product_kind?: ProductKind;
    }
  >;
};

const DEFAULT_PLAN: PackagePlanSnapshot = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  name: "Pakiet 4 zajęć",
  lessons_count: 4,
  validity_days: 60,
  price_gross: 400,
  currency: "PLN",
  start_policy: "on_payment",
  makeup_policy: "ALWAYS_CREATE_ON_ABSENCE",
  makeup_validity_days: 30,
  booking_cutoff_minutes: 360,
};

function ext(): ExtendedDemo {
  const state = getDemoState() as ExtendedDemo;
  if (!state.audit) state.audit = [];
  if (!state.notifications) {
    state.notifications = [
      {
        id: "n-welcome",
        recipient_person_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        channel: "inbox",
        template_code: "system.welcome",
        text: "Добро пожаловать в Studio CRM (demo).",
        status: "sent",
        created_at: new Date().toISOString(),
      },
    ];
  }
  if (!state.contacts) {
    state.contacts = [
      {
        id: "contact-1",
        student_person_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        contact_person_id: "kidparent-0000-0000-0000-000000000001",
        relation_type: "parent",
        can_pay: true,
      },
    ];
  }
  if (!state.offers) {
    state.offers = [
      {
        id: "offer-trial-1",
        brand_id: "poet",
        product_kind: "trial",
        title: "Пробное: Импровизация",
        amount: 70,
        starts_at: addDays(new Date(), 2).toISOString(),
        capacity: 8,
        status: "open",
      },
      {
        id: "offer-event-1",
        brand_id: "poet",
        product_kind: "event",
        title: "Ивент: Open Stage",
        amount: 40,
        starts_at: addDays(new Date(), 10).toISOString(),
        capacity: 40,
        status: "open",
      },
    ];
  }
  return state;
}

export function audit(
  action: string,
  entityType: string,
  entityId?: string,
  after?: unknown,
  actor = "system",
) {
  const state = ext();
  state.audit.unshift({
    id: nanoid(8),
    action,
    entity_type: entityType,
    entity_id: entityId,
    actor,
    after,
    created_at: new Date().toISOString(),
  });
  touchDemoState();
}

export function notify(
  recipientPersonId: string,
  templateCode: string,
  text: string,
  channel: DemoNotification["channel"] = "inbox",
) {
  const state = ext();
  const row: DemoNotification = {
    id: nanoid(8),
    recipient_person_id: recipientPersonId,
    channel,
    template_code: templateCode,
    text,
    status: "sent",
    created_at: new Date().toISOString(),
  };
  state.notifications.unshift(row);
  console.info(`[notify:${channel}]`, recipientPersonId, text);
  touchDemoState();
  return row;
}

export function getExtendedDemo() {
  return ext();
}

export function createStudent(input: {
  full_name: string;
  email: string;
  phone?: string;
  tshirt_size?: string;
  birth_date?: string;
  brand_id: BrandId;
  group_id?: string;
  roles?: string[];
  actor?: string;
}) {
  const state = ext();
  const person: DemoPerson = {
    id: `person-${nanoid(8)}`,
    full_name: input.full_name,
    email: input.email,
    phone: input.phone,
    tshirt_size: input.tshirt_size,
    birth_date: input.birth_date,
    roles: input.roles ?? ["student"],
    onboarding_status: "draft",
  };
  state.persons.push(person);

  let enrollmentId: string | undefined;
  if (input.group_id) {
    enrollmentId = `enr-${nanoid(8)}`;
    state.enrollments.push({
      id: enrollmentId,
      brand_id: input.brand_id,
      student_person_id: person.id,
      group_id: input.group_id,
      status: "active",
    });
  }

  audit("student.created", "person", person.id, person, input.actor);
  return { person, enrollmentId };
}

export function createGroup(input: {
  brand_id: BrandId;
  title: string;
  capacity?: number;
  teacher_name?: string;
  actor?: string;
}) {
  const state = ext();
  const group = {
    id: `grp-${nanoid(8)}`,
    brand_id: input.brand_id,
    title: input.title,
    capacity: input.capacity ?? 12,
    teacher_name: input.teacher_name ?? "Admin Studio",
    status: "active" as const,
  };
  state.groups.push(group);
  audit("group.created", "group", group.id, group, input.actor);
  return group;
}

export function setDemoGroupStatus(
  groupId: string,
  status: "active" | "archived",
  actor?: string,
) {
  const state = ext();
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return null;
  group.status = status;
  audit("group.status", "group", group.id, { status }, actor);
  return group;
}

export function moveDemoEnrollment(input: {
  enrollmentId: string;
  toGroupId: string;
  actor?: string;
}) {
  const state = ext();
  const enr = state.enrollments.find((e) => e.id === input.enrollmentId);
  if (!enr || enr.status !== "active") throw new Error("Enrollment not found");
  if (enr.group_id === input.toGroupId) throw new Error("Already in this group");
  const target = state.groups.find((g) => g.id === input.toGroupId);
  if (!target) throw new Error("Target group not found");
  if ((target.status ?? "active") !== "active") throw new Error("Target group is not active");
  if (
    state.enrollments.some(
      (e) =>
        e.student_person_id === enr.student_person_id &&
        e.group_id === input.toGroupId &&
        e.status === "active",
    )
  ) {
    throw new Error("Student already active in target group");
  }

  enr.status = "ended";
  const newId = `enr-${nanoid(8)}`;
  state.enrollments.push({
    id: newId,
    brand_id: target.brand_id,
    student_person_id: enr.student_person_id,
    group_id: input.toGroupId,
    status: "active",
  });

  for (const pay of state.payments) {
    if (
      pay.enrollment_id === enr.id &&
      ["pending", "partial"].includes(pay.status)
    ) {
      pay.enrollment_id = newId;
    }
  }
  for (const pkg of state.packages) {
    if (pkg.enrollment_id === enr.id && pkg.status === "active") {
      pkg.enrollment_id = newId;
    }
  }

  audit(
    "enrollment.moved",
    "enrollment",
    newId,
    { from: enr.id, to_group_id: input.toGroupId },
    input.actor,
  );
  return {
    from_enrollment_id: enr.id,
    to_enrollment_id: newId,
    student_person_id: enr.student_person_id,
    from_group_id: enr.group_id,
    to_group_id: input.toGroupId,
  };
}

export function upsertPaymentAmount(input: {
  enrollment_id: string;
  amount: number;
  amount_paid?: number;
  payment_method?: string;
  description?: string;
  brand_id: BrandId;
  payer_person_id: string;
  actor?: string;
}) {
  const state = ext();
  let payment = state.payments.find((p) => p.enrollment_id === input.enrollment_id);
  const amountPaid = input.amount_paid ?? payment?.amount_paid ?? 0;
  const status =
    amountPaid >= input.amount ? "paid" : amountPaid > 0 ? "partial" : "pending";

  if (payment) {
    payment.amount = input.amount;
    payment.amount_paid = amountPaid;
    payment.status = status;
    if (input.payment_method) payment.payment_method = input.payment_method;
    if (input.description) payment.description = input.description;
  } else {
    payment = {
      id: `pay-${nanoid(8)}`,
      brand_id: input.brand_id,
      payer_person_id: input.payer_person_id,
      enrollment_id: input.enrollment_id,
      amount: input.amount,
      amount_paid: amountPaid,
      status,
      payment_method: input.payment_method ?? "cash",
      description: input.description ?? "Оплата пакета",
      product_kind: "package",
      created_at: new Date().toISOString(),
    };
    state.payments.unshift(payment);
  }

  audit("payment.upserted", "payment", payment.id, payment, input.actor);
  return payment;
}

export function recordPartialPayment(input: {
  payment_id: string;
  add_amount: number;
  method?: string;
  actor?: string;
}) {
  const state = ext();
  const payment = state.payments.find((p) => p.id === input.payment_id);
  if (!payment) throw new Error("Payment not found");
  payment.amount_paid = Math.min(payment.amount, payment.amount_paid + input.add_amount);
  payment.status =
    payment.amount_paid >= payment.amount
      ? "paid"
      : payment.amount_paid > 0
        ? "partial"
        : "pending";
  if (input.method) payment.payment_method = input.method;

  if (payment.status === "paid" && payment.enrollment_id) {
    activatePackageForEnrollment(payment.enrollment_id, payment.payer_person_id);
  }

  audit("payment.partial", "payment", payment.id, payment, input.actor);
  notify(
    payment.payer_person_id,
    "payment.updated",
    `Оплата обновлена: ${payment.amount_paid}/${payment.amount} PLN (${payment.status})`,
  );
  return payment;
}

export function createOnlinePaymentLink(input: {
  enrollment_id?: string;
  payer_person_id: string;
  brand_id: BrandId;
  amount: number;
  description?: string;
  product_kind?: ProductKind;
  offer_id?: string;
  actor?: string;
}) {
  const state = ext();
  const kind = input.product_kind ?? "package";
  const id = `pay-${nanoid(8)}`;
  const payment = {
    id,
    brand_id: input.brand_id,
    payer_person_id: input.payer_person_id,
    enrollment_id: input.enrollment_id ?? "",
    amount: input.amount,
    amount_paid: 0,
    status: "pending",
    payment_method: "online",
    description: input.description ?? kind,
    payment_url: checkoutUrl(kind, id),
    product_kind: kind,
    created_at: new Date().toISOString(),
  };
  state.payments.unshift(payment);
  audit("payment.link_created", "payment", payment.id, payment, input.actor);
  notify(
    input.payer_person_id,
    "payment.reminder",
    `Ссылка на оплату: ${payment.payment_url}`,
    "telegram",
  );
  return payment;
}

export function completeDemoPayment(paymentId: string, actor = "p24-demo") {
  const state = ext();
  const payment = state.payments.find((p) => p.id === paymentId);
  if (!payment) throw new Error("Payment not found");

  payment.status = "paid";
  payment.amount_paid = payment.amount;

  const kind = payment.product_kind ?? "package";
  if (kind === "package" && payment.enrollment_id) {
    activatePackageForEnrollment(payment.enrollment_id, payment.payer_person_id);
  }

  audit("payment.paid", "payment", payment.id, payment, actor);
  notify(
    payment.payer_person_id,
    "payment.paid",
    kind === "trial"
      ? "Пробное оплачено. Ждём вас на занятии!"
      : kind === "event"
        ? "Ивент оплачен. Билет в кабинете."
        : "Оплата получена. Пакет активирован.",
  );
  return payment;
}

export function activatePackageForEnrollment(
  enrollmentId: string,
  notifyPersonId?: string,
) {
  const state = ext();
  const existing = state.packages.find(
    (p) => p.enrollment_id === enrollmentId && p.status === "active",
  );
  if (existing) {
    existing.credits_available = existing.credits_total;
    existing.expires_at = addDays(new Date(), DEFAULT_PLAN.validity_days).toISOString();
    return existing;
  }

  const pkg = {
    id: `pkg-${nanoid(8)}`,
    enrollment_id: enrollmentId,
    status: "active",
    credits_available: DEFAULT_PLAN.lessons_count,
    credits_total: DEFAULT_PLAN.lessons_count,
    expires_at: addDays(new Date(), DEFAULT_PLAN.validity_days).toISOString(),
    plan: DEFAULT_PLAN,
  };
  state.packages.push(pkg);
  audit("package.activated", "student_package", pkg.id, pkg);
  if (notifyPersonId) {
    notify(
      notifyPersonId,
      "package.activated",
      `Пакет активирован: ${pkg.credits_available} занятий.`,
    );
  }
  return pkg;
}

export function linkParentChild(input: {
  student_person_id: string;
  contact_person_id: string;
  relation_type?: "parent" | "guardian" | "payer";
  actor?: string;
}) {
  const state = ext();
  const existing = state.contacts.find(
    (c) =>
      c.student_person_id === input.student_person_id &&
      c.contact_person_id === input.contact_person_id,
  );
  if (existing) return existing;
  const row: DemoContact = {
    id: `contact-${nanoid(6)}`,
    student_person_id: input.student_person_id,
    contact_person_id: input.contact_person_id,
    relation_type: input.relation_type ?? "parent",
    can_pay: true,
  };
  state.contacts.push(row);
  audit("student.contact.linked", "student_contact", row.id, row, input.actor);
  return row;
}

export function createOffer(input: {
  brand_id: BrandId;
  product_kind: "trial" | "event";
  title: string;
  amount: number;
  starts_at: string;
  capacity?: number;
  actor?: string;
}) {
  const state = ext();
  const offer: DemoEventOffer = {
    id: `offer-${nanoid(6)}`,
    brand_id: input.brand_id,
    product_kind: input.product_kind,
    title: input.title,
    amount: input.amount,
    starts_at: input.starts_at,
    capacity: input.capacity ?? 10,
    status: "open",
  };
  state.offers.unshift(offer);
  audit("offer.created", "offer", offer.id, offer, input.actor);
  return offer;
}

export function runDemoJobs() {
  const state = ext();
  const now = new Date();
  let expiredMakeups = 0;
  let expiredPackages = 0;
  let reminders = 0;

  for (const m of state.makeups) {
    if (m.status === "available" && new Date(m.valid_until) < now) {
      m.status = "expired";
      expiredMakeups += 1;
      notify(m.student_person_id, "makeup.expired", "Отработка истекла.");
    }
  }

  for (const p of state.packages) {
    if (p.status === "active" && new Date(p.expires_at) < now) {
      p.status = "expired";
      p.credits_available = 0;
      expiredPackages += 1;
    }
  }

  for (const pay of state.payments) {
    if (["pending", "partial"].includes(pay.status)) {
      reminders += 1;
      notify(
        pay.payer_person_id,
        "payment.reminder",
        `Напоминание об оплате: ${pay.amount - pay.amount_paid} PLN. ${pay.payment_url ?? ""}`,
        "telegram",
      );
    }
  }

  audit("jobs.tick", "system", undefined, {
    expiredMakeups,
    expiredPackages,
    reminders,
  });

  return { expiredMakeups, expiredPackages, reminders };
}

export function getChildrenForParent(parentId: string) {
  const state = ext();
  return state.contacts
    .filter((c) => c.contact_person_id === parentId)
    .map((c) => state.persons.find((p) => p.id === c.student_person_id))
    .filter(Boolean) as DemoPerson[];
}

export function createChildWithParent(input: {
  child_full_name: string;
  child_birth_date?: string;
  parent_full_name: string;
  parent_email: string;
  parent_phone?: string;
  brand_id: BrandId;
  group_id?: string;
  credits_left?: number;
  invite?: boolean;
  actor?: string;
}) {
  const state = ext();
  let parent = state.persons.find(
    (p) => p.email.toLowerCase() === input.parent_email.toLowerCase(),
  );
  if (!parent) {
    parent = {
      id: `person-${nanoid(8)}`,
      full_name: input.parent_full_name,
      email: input.parent_email,
      phone: input.parent_phone,
      roles: ["parent", "payer"],
      onboarding_status: "draft",
    };
    state.persons.push(parent);
  } else {
    if (!parent.roles.includes("parent")) parent.roles.push("parent");
    if (!parent.roles.includes("payer")) parent.roles.push("payer");
  }

  const child: DemoPerson = {
    id: `person-${nanoid(8)}`,
    full_name: input.child_full_name,
    email: `child+${nanoid(6)}@kids.local`,
    birth_date: input.child_birth_date,
    roles: ["student"],
    is_minor: true,
    onboarding_status: "complete",
  };
  state.persons.push(child);

  let enrollmentId: string | undefined;
  if (input.group_id) {
    enrollmentId = `enr-${nanoid(8)}`;
    state.enrollments.push({
      id: enrollmentId,
      brand_id: input.brand_id,
      student_person_id: child.id,
      group_id: input.group_id,
      status: "active",
    });
  }

  linkParentChild({
    student_person_id: child.id,
    contact_person_id: parent.id,
    relation_type: "parent",
    actor: input.actor,
  });

  if (enrollmentId && input.credits_left && input.credits_left > 0) {
    const pkg = activatePackageForEnrollment(enrollmentId, parent.id);
    pkg.credits_available = input.credits_left;
    pkg.credits_total = Math.max(pkg.credits_total, input.credits_left);
  }

  audit("child_parent.created", "person", child.id, { child, parent }, input.actor);
  touchDemoState();
  return { child, parent, enrollmentId };
}

export function remindAllDebtors(actor?: string) {
  const state = ext();
  let count = 0;
  for (const pay of state.payments) {
    if (!["pending", "partial"].includes(pay.status)) continue;
    const due = pay.amount - pay.amount_paid;
    notify(
      pay.payer_person_id,
      "payment.reminder",
      `Напоминание об оплате: ${due} PLN. ${pay.description}. Кабинет → Оплата.`,
      "inbox",
    );
    count += 1;
  }
  audit("payments.remind_all", "payment", undefined, { count }, actor);
  return { reminded: count };
}

export function getStudentCard(personId: string) {
  const state = ext();
  const person = state.persons.find((p) => p.id === personId);
  if (!person) throw new Error("Person not found");

  const enrollments = state.enrollments.filter((e) => e.student_person_id === personId);
  const groups = enrollments
    .map((e) => state.groups.find((g) => g.id === e.group_id))
    .filter(Boolean);
  const packages = state.packages.filter((p) =>
    enrollments.some((e) => e.id === p.enrollment_id),
  );
  const payments = state.payments.filter(
    (p) =>
      p.payer_person_id === personId ||
      enrollments.some((e) => e.id === p.enrollment_id),
  );
  const attendance = state.attendance
    .filter((a) => a.student_person_id === personId)
    .map((a) => {
      const session = state.sessions.find((s) => s.id === a.session_id);
      return { ...a, session_title: session?.title, starts_at: session?.starts_at };
    })
    .sort((a, b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? ""));
  const makeups = state.makeups.filter((m) => m.student_person_id === personId);
  const parents = state.contacts
    .filter((c) => c.student_person_id === personId)
    .map((c) => state.persons.find((p) => p.id === c.contact_person_id))
    .filter(Boolean);
  const children = getChildrenForParent(personId);
  const invites =
    (
      state as typeof state & {
        invites?: Array<{
          id: string;
          person_id: string;
          email: string;
          token: string;
          expires_at: string;
          consumed_at?: string;
          created_at: string;
        }>;
      }
    ).invites?.filter(
      (i) =>
        i.person_id === personId ||
        parents.some((p) => p && p.id === i.person_id),
    ) ?? [];

  return {
    person,
    groups,
    packages,
    payments,
    attendance: attendance.slice(0, 30),
    attendance_summary: {
      total: attendance.length,
      present: attendance.filter((a) => a.status === "present").length,
      absent: attendance.filter((a) => a.status === "absent").length,
      absent_notified: attendance.filter((a) => a.status === "absent_notified").length,
      cancelled_by_studio: attendance.filter((a) => a.status === "cancelled_by_studio")
        .length,
      makeup: attendance.filter((a) => a.attendance_type === "makeup").length,
    },
    invites,
    parents,
    children,
    makeups,
  };
}
