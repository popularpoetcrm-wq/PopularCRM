import { nanoid } from "nanoid";
import { addDays, differenceInMinutes } from "date-fns";
import { audit, notify, getExtendedDemo } from "@/lib/demo-ops";
import { getDemoState } from "@/lib/demo-store";
import { STUDIO_POLICY, cutoffMinutes } from "@/lib/studio-policy";

const ABSENT_CUTOFF = cutoffMinutes(STUDIO_POLICY.absentNotifyCutoffHours);
const MAKEUP_CUTOFF = cutoffMinutes(STUDIO_POLICY.makeupCutoffHours);

function isWontCome(status: string | null | undefined) {
  return status === "absent" || status === "absent_notified";
}

/** Expected attendees = active roster minus explicit "won't come". Default = coming. */
export function countExpectedAttendees(sessionId: string) {
  const state = getDemoState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { total: 0, coming: 0, wontCome: 0 };

  const roster = state.enrollments.filter(
    (e) => e.group_id === session.group_id && e.status === "active",
  );
  let wontCome = 0;
  for (const e of roster) {
    const att = state.attendance.find(
      (a) => a.session_id === sessionId && a.student_person_id === e.student_person_id,
    );
    if (isWontCome(att?.status)) wontCome += 1;
  }
  const total = roster.length;
  return { total, coming: total - wontCome, wontCome };
}

/**
 * If fewer than minAttendeesToHold will come → cancel class.
 * Credits not consumed for "would-be present"; won't-come keep their makeup.
 */
export function maybeCancelSessionIfTooFew(sessionId: string, actor = "system") {
  const state = getDemoState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session || session.status !== "scheduled") return null;

  const { coming, total, wontCome } = countExpectedAttendees(sessionId);
  if (total === 0) return null;
  if (coming >= STUDIO_POLICY.minAttendeesToHold) {
    return { cancelled: false, coming, total, wontCome };
  }

  session.status = "cancelled_by_studio";
  const roster = state.enrollments.filter(
    (e) => e.group_id === session.group_id && e.status === "active",
  );

  for (const e of roster) {
    const att = state.attendance.find(
      (a) => a.session_id === sessionId && a.student_person_id === e.student_person_id,
    );
    if (!isWontCome(att?.status)) {
      // mark cancelled for those who didn't opt out — no credit burn
      if (!att) {
        state.attendance.push({
          id: nanoid(8),
          session_id: sessionId,
          student_person_id: e.student_person_id,
          status: "cancelled_by_studio",
        });
      } else {
        att.status = "cancelled_by_studio";
      }
    }
    notify(
      e.student_person_id,
      "session.cancelled",
      `Занятие «${session.title}» отменено: придёт меньше ${STUDIO_POLICY.minAttendeesToHold} человек.`,
      "telegram",
    );
  }

  audit("session.cancelled_low_attendance", "session", sessionId, {
    coming,
    total,
    wontCome,
  }, actor);

  notify(
    "cccccccc-cccc-cccc-cccc-cccccccccccc",
    "session.cancelled",
    `Отмена «${session.title}»: ожидается ${coming} из ${total}.`,
    "inbox",
  );

  return { cancelled: true, coming, total, wontCome };
}

export function listSessionsForBrand(brandId: string) {
  const state = getDemoState();
  const groupIds = new Set(
    state.groups.filter((g) => g.brand_id === brandId).map((g) => g.id),
  );
  return state.sessions
    .filter((s) => groupIds.has(s.group_id))
    .map((s) => {
      const group = state.groups.find((g) => g.id === s.group_id);
      const counts = countExpectedAttendees(s.id);
      const roster = state.enrollments
        .filter((e) => e.group_id === s.group_id && e.status === "active")
        .map((e) => {
          const person = state.persons.find((p) => p.id === e.student_person_id)!;
          const existing = state.attendance.find(
            (a) => a.session_id === s.id && a.student_person_id === e.student_person_id,
          );
          // Default UI: present unless explicit won't-come
          const effective =
            existing?.status ??
            (s.status === "cancelled_by_studio" ? "cancelled_by_studio" : "present");
          return {
            enrollmentId: e.id,
            studentPersonId: e.student_person_id,
            fullName: person.full_name,
            status: existing?.status ?? null,
            effectiveStatus: isWontCome(existing?.status) ? existing!.status : effective,
            explicitWontCome: isWontCome(existing?.status),
          };
        });
      return {
        ...s,
        group_title: group?.title ?? s.title,
        capacity: group?.capacity ?? 12,
        expected_coming: counts.coming,
        expected_wont_come: counts.wontCome,
        will_hold: counts.coming >= STUDIO_POLICY.minAttendeesToHold,
        roster,
      };
    });
}

export function markAttendanceDemo(input: {
  sessionId: string;
  items: Array<{
    enrollmentId: string;
    studentPersonId: string;
    attendanceType?: "regular" | "makeup";
    status: "present" | "absent" | "absent_notified" | "cancelled_by_studio";
    comment?: string | null;
  }>;
  actor?: string;
  /** If true, fill missing roster as present (default came) */
  fillDefaultsPresent?: boolean;
  /** A range absence sends one summary instead of one message per class. */
  notifyMakeup?: boolean;
}) {
  const state = getDemoState();
  const session = state.sessions.find((s) => s.id === input.sessionId);
  if (!session) throw new Error("Session not found");

  const items = [...input.items];

  if (input.fillDefaultsPresent) {
    const roster = state.enrollments.filter(
      (e) => e.group_id === session.group_id && e.status === "active",
    );
    for (const e of roster) {
      const has = items.some((i) => i.studentPersonId === e.student_person_id);
      const existing = state.attendance.find(
        (a) =>
          a.session_id === input.sessionId &&
          a.student_person_id === e.student_person_id,
      );
      if (!has) {
        items.push({
          enrollmentId: e.id,
          studentPersonId: e.student_person_id,
          status: isWontCome(existing?.status)
            ? (existing!.status as "absent" | "absent_notified")
            : "present",
        });
      }
    }
  }

  const createdMakeups: string[] = [];
  const results = [];

  for (const item of items) {
    const existingIdx = state.attendance.findIndex(
      (a) =>
        a.session_id === input.sessionId &&
        a.student_person_id === item.studentPersonId,
    );

    if (existingIdx >= 0) {
      const prev = state.attendance[existingIdx]!;
      if (prev.status === item.status) {
        results.push(prev);
        continue;
      }
      // Don't overwrite explicit won't-come with present on finalize
      if (
        isWontCome(prev.status) &&
        item.status === "present" &&
        input.fillDefaultsPresent
      ) {
        results.push(prev);
        continue;
      }
      state.attendance[existingIdx] = { ...prev, status: item.status };
      results.push(state.attendance[existingIdx]);
      audit("attendance.marked", "attendance", item.studentPersonId, item, input.actor);
      continue;
    }

    const row = {
      id: nanoid(8),
      session_id: input.sessionId,
      student_person_id: item.studentPersonId,
      status: item.status,
    };
    state.attendance.push(row);
    results.push(row);

    const pkg = state.packages.find(
      (p) =>
        p.enrollment_id === item.enrollmentId &&
        p.status === "active" &&
        p.credits_available > 0,
    );

    if (item.status === "cancelled_by_studio") {
      // no credit
    } else if (pkg && (item.status === "present" || isWontCome(item.status))) {
      pkg.credits_available -= 1;
      if (pkg.credits_available === 1) {
        notify(
          item.studentPersonId,
          "credits.low_balance",
          "Осталось 1 занятие в пакете.",
          "telegram",
        );
      }
    }

    // Отработка только при предупреждении (absent_notified), не при silent absent.
    if (
      item.status === "absent_notified" &&
      (item.attendanceType ?? "regular") === "regular"
    ) {
      const makeupId = `makeup-${nanoid(6)}`;
      state.makeups.push({
        id: makeupId,
        student_person_id: item.studentPersonId,
        status: "available",
        valid_until: addDays(
          new Date(),
          STUDIO_POLICY.makeupValidityDays,
        ).toISOString(),
      });
      createdMakeups.push(makeupId);
      if (input.notifyMakeup !== false) {
        notify(
          item.studentPersonId,
          "makeup.created",
          `Создана отработка (до ${addDays(new Date(), STUDIO_POLICY.makeupValidityDays).toLocaleDateString()}). Забронируй в кабинете.`,
          "telegram",
        );
      }
    }

    audit("attendance.marked", "attendance", item.studentPersonId, item, input.actor);
  }

  const cancelInfo = maybeCancelSessionIfTooFew(input.sessionId, input.actor);
  return { marked: results.length, createdMakeups, cancelInfo };
}

/** Client or parent: explicit "won't come" */
export function reportCantAttendDemo(input: {
  sessionId: string;
  personId: string;
  /** When parent acts for child */
  studentPersonId?: string;
  actorName?: string;
  notifyMakeup?: boolean;
}) {
  const state = getDemoState();
  const session = state.sessions.find((s) => s.id === input.sessionId);
  if (!session) throw new Error("Занятие не найдено");
  if (session.status !== "scheduled") {
    throw new Error("На это занятие уже нельзя сообщить");
  }

  const minutes = differenceInMinutes(new Date(session.starts_at), new Date());
  if (minutes < ABSENT_CUTOFF) {
    throw new Error(
      `Слишком поздно: нужно сообщить минимум за ${STUDIO_POLICY.absentNotifyCutoffHours} ч до начала`,
    );
  }

  let studentId = input.studentPersonId ?? input.personId;
  if (input.studentPersonId && input.studentPersonId !== input.personId) {
    const allowed = getExtendedDemo().contacts.some(
      (c) =>
        c.contact_person_id === input.personId &&
        c.student_person_id === input.studentPersonId &&
        ["parent", "guardian"].includes(c.relation_type),
    );
    if (!allowed) throw new Error("Нет прав отметить отсутствие за этого ребёнка");
    studentId = input.studentPersonId;
  }

  const enrollment = state.enrollments.find(
    (e) =>
      e.student_person_id === studentId &&
      e.group_id === session.group_id &&
      e.status === "active",
  );
  if (!enrollment) throw new Error("Ученик не записан на эту группу");

  const already = state.attendance.find(
    (a) =>
      a.session_id === session.id &&
      a.student_person_id === studentId &&
      isWontCome(a.status),
  );
  if (already) {
    return {
      already: true,
      status: already.status,
      message: "Уже отмечено: не приду",
      cancelInfo: countExpectedAttendees(session.id),
    };
  }

  const result = markAttendanceDemo({
    sessionId: session.id,
    items: [
      {
        enrollmentId: enrollment.id,
        studentPersonId: studentId,
        status: "absent_notified",
        comment:
          studentId !== input.personId
            ? "parent won't-come for child"
            : "self-service won't come",
      },
    ],
    actor: input.actorName,
    notifyMakeup: input.notifyMakeup,
  });

  const cancelInfo = result.cancelInfo;
  let message =
    studentId !== input.personId
      ? "Ок, ребёнок не придёт. Отработка создана."
      : "Ок, занятие пропущено. Отработка появилась в разделе «Отработки».";
  if (cancelInfo?.cancelled) {
    message += ` Занятие отменено студией: осталось ${cancelInfo.coming} человек.`;
  }

  return { ...result, message, cancelInfo, studentPersonId: studentId };
}

type PlannedAbsenceItem = {
  sessionId: string;
  title: string;
  startsAt: string;
  studentPersonId: string;
};

type PlannedAbsenceSkipped = PlannedAbsenceItem & { reason: string };

function demoPlannedAbsenceCandidates(input: {
  personId: string;
  studentPersonId?: string;
  startsOn: string;
  endsOn: string;
}) {
  const state = getDemoState();
  const studentPersonId = input.studentPersonId ?? input.personId;
  if (studentPersonId !== input.personId) {
    const allowed = getExtendedDemo().contacts.some(
      (contact) =>
        contact.contact_person_id === input.personId &&
        contact.student_person_id === studentPersonId &&
        ["parent", "guardian"].includes(contact.relation_type),
    );
    if (!allowed) throw new Error("Нет прав отметить отсутствие за этого ребёнка");
  }

  const enrollmentByGroup = new Map(
    state.enrollments
      .filter(
        (enrollment) =>
          enrollment.student_person_id === studentPersonId &&
          enrollment.status === "active",
      )
      .map((enrollment) => [enrollment.group_id, enrollment]),
  );
  const eligible: PlannedAbsenceItem[] = [];
  const skipped: PlannedAbsenceSkipped[] = [];

  for (const session of state.sessions) {
    const enrollment = enrollmentByGroup.get(session.group_id);
    if (!enrollment) continue;
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(session.starts_at));
    if (ymd < input.startsOn || ymd > input.endsOn) continue;
    const item: PlannedAbsenceItem = {
      sessionId: session.id,
      title: session.title,
      startsAt: session.starts_at,
      studentPersonId,
    };
    if (session.status !== "scheduled") {
      skipped.push({ ...item, reason: "занятие уже отменено или завершено" });
      continue;
    }
    if (differenceInMinutes(new Date(session.starts_at), new Date()) < ABSENT_CUTOFF) {
      skipped.push({
        ...item,
        reason: `предупреждать нужно минимум за ${STUDIO_POLICY.absentNotifyCutoffHours} ч`,
      });
      continue;
    }
    const existing = state.attendance.find(
      (attendance) =>
        attendance.session_id === session.id &&
        attendance.student_person_id === studentPersonId,
    );
    if (isWontCome(existing?.status)) {
      skipped.push({ ...item, reason: "отсутствие уже отмечено" });
      continue;
    }
    if (existing) {
      skipped.push({ ...item, reason: "посещаемость уже отмечена" });
      continue;
    }
    eligible.push(item);
  }

  return { eligible, skipped, studentPersonId };
}

/** Preview or move every affected class for a holiday/trip in demo mode. */
export function plannedAbsenceDemo(input: {
  personId: string;
  studentPersonId?: string;
  startsOn: string;
  endsOn: string;
  action: "preview" | "apply";
  actorName?: string;
}) {
  const candidates = demoPlannedAbsenceCandidates(input);
  if (input.action === "preview") return candidates;

  let moved = 0;
  let createdMakeups = 0;
  const skipped = [...candidates.skipped];
  for (const item of candidates.eligible) {
    try {
      const result = reportCantAttendDemo({
        sessionId: item.sessionId,
        personId: input.personId,
        studentPersonId: candidates.studentPersonId,
        actorName: input.actorName,
        notifyMakeup: false,
      });
      moved += 1;
      createdMakeups +=
        "createdMakeups" in result ? (result.createdMakeups?.length ?? 0) : 0;
    } catch (error) {
      skipped.push({
        ...item,
        reason: error instanceof Error ? error.message : "не удалось перенести",
      });
    }
  }

  if (createdMakeups > 0) {
    notify(
      candidates.studentPersonId,
      "makeup.planned_absence",
      `Отсутствие отмечено. Создано отработок: ${createdMakeups}. Выбери новую дату в кабинете.`,
      "telegram",
    );
  }
  return {
    ...candidates,
    skipped,
    moved,
    createdMakeups,
    message:
      moved > 0
        ? `Перенесли занятий: ${moved}. Отработок создано: ${createdMakeups}.`
        : "Нет занятий, которые можно перенести на выбранные даты.",
  };
}

/** Close session: everyone without explicit won't-come = present */
export function finalizeSessionPresentDefaults(sessionId: string, actor?: string) {
  return markAttendanceDemo({
    sessionId,
    items: [],
    fillDefaultsPresent: true,
    actor,
  });
}

export function bookMakeupDemo(input: {
  makeupId: string;
  targetSessionId: string;
  actorPersonId?: string;
}) {
  const state = getDemoState();
  const makeup = state.makeups.find((m) => m.id === input.makeupId);
  if (!makeup) throw new Error("Makeup not found");
  if (makeup.status !== "available") throw new Error("Makeup is not available");
  if (new Date(makeup.valid_until) < new Date()) {
    makeup.status = "expired";
    throw new Error("Makeup expired");
  }

  const session = state.sessions.find((s) => s.id === input.targetSessionId);
  if (!session || session.status !== "scheduled") {
    throw new Error("Target session is not bookable");
  }

  const minutesToStart = differenceInMinutes(new Date(session.starts_at), new Date());
  if (minutesToStart < MAKEUP_CUTOFF) {
    throw new Error(
      `Слишком поздно бронировать (нужно за ${STUDIO_POLICY.makeupCutoffHours} ч)`,
    );
  }

  const group = state.groups.find((g) => g.id === session.group_id);
  const capacity = group?.capacity ?? 12;
  type MakeupExt = (typeof state.makeups)[number] & {
    target_session_id?: string;
    booked_at?: string;
  };
  const bookedOnSession = state.makeups.filter(
    (m) => (m as MakeupExt).target_session_id === session.id && m.status === "booked",
  ).length;
  const regularCount = state.enrollments.filter(
    (e) => e.group_id === session.group_id && e.status === "active",
  ).length;

  if (regularCount + bookedOnSession >= capacity) {
    throw new Error("Нет мест на занятии");
  }

  const m = makeup as MakeupExt;
  m.status = "booked";
  m.target_session_id = session.id;
  m.booked_at = new Date().toISOString();

  audit(
    "makeup.booked",
    "makeup_credit",
    makeup.id,
    { targetSessionId: session.id },
    input.actorPersonId,
  );
  notify(
    makeup.student_person_id,
    "makeup.booked",
    `Отработка забронирована: ${session.title}`,
  );

  return { makeupId: makeup.id, targetSessionId: session.id, status: "booked" };
}

export function cancelMakeupDemo(input: {
  makeupId: string;
  actorPersonId?: string;
  forceBurn?: boolean;
}) {
  const state = getDemoState();
  type MakeupExt = (typeof state.makeups)[number] & {
    target_session_id?: string;
    booked_at?: string;
  };
  const makeup = state.makeups.find((m) => m.id === input.makeupId) as
    | MakeupExt
    | undefined;
  if (!makeup) throw new Error("Makeup not found");

  if (makeup.status === "booked" && makeup.target_session_id) {
    const session = state.sessions.find((s) => s.id === makeup.target_session_id);
    if (session) {
      const minutesToStart = differenceInMinutes(
        new Date(session.starts_at),
        new Date(),
      );
      if (minutesToStart < MAKEUP_CUTOFF || input.forceBurn) {
        makeup.status = "burned";
        delete makeup.target_session_id;
        audit("makeup.burned", "makeup_credit", makeup.id, null, input.actorPersonId);
        notify(
          makeup.student_person_id,
          "makeup.burned",
          "Отработка сгорела (отмена после cutoff).",
        );
        return { makeupId: makeup.id, creditStatus: "burned" };
      }
    }
  }

  makeup.status = "available";
  delete makeup.target_session_id;
  delete makeup.booked_at;
  audit("makeup.cancelled", "makeup_credit", makeup.id, null, input.actorPersonId);
  return { makeupId: makeup.id, creditStatus: "available" };
}

export function seedStudioDay() {
  const state = getDemoState();
  const ext = getExtendedDemo();
  const poetGroup = state.groups.find((g) => g.brand_id === "poet");
  if (!poetGroup) throw new Error("Poet group missing");

  let ola = state.persons.find((p) => p.email === "ola@example.com");
  if (!ola) {
    ola = {
      id: `person-ola`,
      full_name: "Ola Wiśniewska",
      email: "ola@example.com",
      phone: "+48444444444",
      roles: ["student", "payer"],
      tshirt_size: "S",
      birth_date: "1999-01-20",
    };
    state.persons.push(ola);
    state.enrollments.push({
      id: `enr-ola`,
      brand_id: "poet",
      student_person_id: ola.id,
      group_id: poetGroup.id,
      status: "active",
    });
    state.payments.unshift({
      id: `pay-ola`,
      brand_id: "poet",
      payer_person_id: ola.id,
      enrollment_id: "enr-ola",
      amount: 380,
      amount_paid: 0,
      status: "pending",
      payment_method: "online",
      description: "Pakiet 4 — индивидуально скидка 380",
      product_kind: "package",
      created_at: new Date().toISOString(),
    });
  }

  const nextWeek = addDays(new Date(), 7);
  nextWeek.setHours(18, 0, 0, 0);
  if (!state.sessions.some((s) => s.id === "sess-week-next")) {
    state.sessions.push({
      id: "sess-week-next",
      group_id: poetGroup.id,
      title: poetGroup.title,
      starts_at: nextWeek.toISOString(),
      status: "scheduled",
    });
  }

  audit("seed.studio_day", "system", undefined, {
    group: poetGroup.title,
    policy: STUDIO_POLICY,
  });

  return {
    group: poetGroup.title,
    sessions: state.sessions.filter((s) => s.group_id === poetGroup.id).length,
    enrollments: state.enrollments.filter((e) => e.group_id === poetGroup.id).length,
    offers: ext.offers.length,
    policy: STUDIO_POLICY,
  };
}

/** Admin day board: upcoming sessions with coming / wontCome / cancel risk */
export function getDayBoard(brandId?: string) {
  const state = getDemoState();
  const now = Date.now();
  const weekAhead = now + 7 * 24 * 3600 * 1000;

  return state.sessions
    .filter((s) => {
      const t = new Date(s.starts_at).getTime();
      if (t < now - 3 * 3600 * 1000 || t > weekAhead) return false;
      if (!brandId) return true;
      const g = state.groups.find((x) => x.id === s.group_id);
      return g?.brand_id === brandId;
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((s) => {
      const group = state.groups.find((g) => g.id === s.group_id);
      const counts = countExpectedAttendees(s.id);
      const roster = state.enrollments
        .filter((e) => e.group_id === s.group_id && e.status === "active")
        .map((e) => {
          const person = state.persons.find((p) => p.id === e.student_person_id);
          const att = state.attendance.find(
            (a) => a.session_id === s.id && a.student_person_id === e.student_person_id,
          );
          const wont = isWontCome(att?.status);
          return {
            studentPersonId: e.student_person_id,
            fullName: person?.full_name ?? "?",
            status: wont ? att!.status : att?.status ?? "coming",
            coming: !wont && s.status === "scheduled",
          };
        });
      return {
        ...s,
        group_title: group?.title ?? s.title,
        brand_id: group?.brand_id,
        expected_coming: counts.coming,
        expected_wont_come: counts.wontCome,
        will_hold: counts.coming >= STUDIO_POLICY.minAttendeesToHold,
        cancel_risk:
          s.status === "scheduled" &&
          counts.total > 0 &&
          counts.coming < STUDIO_POLICY.minAttendeesToHold,
        roster,
      };
    });
}
