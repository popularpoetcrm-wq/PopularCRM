import { differenceInMinutes } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/domain/audit";
import { STUDIO_POLICY, cutoffMinutes } from "@/lib/studio-policy";
import {
  cancelTicketsMakeupTrial,
  reserveTicketsMakeupTrial,
} from "@/lib/tickets-makeup";

const MAKEUP_CUTOFF = cutoffMinutes(STUDIO_POLICY.makeupCutoffHours);

async function assertCreditBookable(
  db: SupabaseClient,
  tenantId: string,
  makeupCreditId: string,
) {
  const { data: credit, error } = await db
    .from("makeup_credits")
    .select("*")
    .eq("id", makeupCreditId)
    .eq("tenant_id", tenantId)
    .single();
  if (error) throw error;
  if (credit.status !== "available") {
    throw new Error("Отработка недоступна для брони");
  }
  if (new Date(credit.valid_until) < new Date()) {
    await db
      .from("makeup_credits")
      .update({ status: "expired" })
      .eq("id", makeupCreditId);
    throw new Error("Срок отработки истёк");
  }
  return credit;
}

export async function bookMakeup(
  db: SupabaseClient,
  params: {
    tenantId: string;
    makeupCreditId: string;
    targetSessionId: string;
    bookedBy?: string | null;
    requestId?: string;
  },
) {
  const credit = await assertCreditBookable(
    db,
    params.tenantId,
    params.makeupCreditId,
  );

  const { data: session, error: sessErr } = await db
    .from("sessions")
    .select("*, groups(capacity, brand_id, title)")
    .eq("id", params.targetSessionId)
    .single();
  if (sessErr) throw sessErr;
  if (session.status !== "scheduled") {
    throw new Error("На это занятие уже нельзя записаться");
  }

  const minutesToStart = differenceInMinutes(new Date(session.starts_at), new Date());
  if (minutesToStart < MAKEUP_CUTOFF) {
    throw new Error(
      `Слишком поздно бронировать (нужно за ${STUDIO_POLICY.makeupCutoffHours} ч)`,
    );
  }

  const capacity = session.capacity_override ?? session.groups?.capacity ?? 12;
  const { count: reserved } = await db
    .from("makeup_bookings")
    .select("*", { count: "exact", head: true })
    .eq("target_session_id", params.targetSessionId)
    .eq("status", "booked");

  const { count: regularPresent } = await db
    .from("attendance")
    .select("*", { count: "exact", head: true })
    .eq("session_id", params.targetSessionId)
    .eq("attendance_type", "regular");

  const used = (reserved ?? 0) + (regularPresent ?? 0);
  if (used >= capacity) {
    throw new Error("Нет свободных мест на занятии");
  }

  const { data: booking, error: bookErr } = await db
    .from("makeup_bookings")
    .insert({
      tenant_id: params.tenantId,
      makeup_credit_id: params.makeupCreditId,
      target_kind: "group_session",
      target_session_id: params.targetSessionId,
      status: "booked",
      booked_by: params.bookedBy ?? null,
    })
    .select("*")
    .single();
  if (bookErr) throw bookErr;

  await db
    .from("makeup_credits")
    .update({ status: "booked" })
    .eq("id", params.makeupCreditId);

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.bookedBy ?? null,
    action: "makeup.booked",
    entityType: "makeup_booking",
    entityId: booking.id,
    after: booking,
    requestId: params.requestId,
  });

  return { ...booking, credit_id: credit.id };
}

export async function bookMakeupTrial(
  db: SupabaseClient,
  params: {
    tenantId: string;
    makeupCreditId: string;
    ticketsEventId: string;
    buyerEmail: string;
    buyerName?: string;
    bookedBy?: string | null;
    requestId?: string;
  },
) {
  const credit = await assertCreditBookable(
    db,
    params.tenantId,
    params.makeupCreditId,
  );

  const reserved = await reserveTicketsMakeupTrial({
    crmMakeupCreditId: params.makeupCreditId,
    eventId: params.ticketsEventId,
    buyerEmail: params.buyerEmail,
    buyerName: params.buyerName,
  });

  if (reserved.starts_at) {
    const minutesToStart = differenceInMinutes(
      new Date(reserved.starts_at),
      new Date(),
    );
    if (minutesToStart < MAKEUP_CUTOFF && !reserved.already) {
      await cancelTicketsMakeupTrial({
        crmMakeupCreditId: params.makeupCreditId,
        ticketId: reserved.ticket_id,
      });
      throw new Error(
        `Слишком поздно бронировать пробное (нужно за ${STUDIO_POLICY.makeupCutoffHours} ч)`,
      );
    }
  }

  const { data: booking, error: bookErr } = await db
    .from("makeup_bookings")
    .insert({
      tenant_id: params.tenantId,
      makeup_credit_id: params.makeupCreditId,
      target_kind: "trial_event",
      target_session_id: null,
      tickets_event_id: reserved.event_id ?? params.ticketsEventId,
      tickets_ticket_id: reserved.ticket_id ?? null,
      tickets_order_id: reserved.order_id ?? null,
      tickets_starts_at: reserved.starts_at ?? null,
      status: "booked",
      booked_by: params.bookedBy ?? null,
    })
    .select("*")
    .single();
  if (bookErr) {
    await cancelTicketsMakeupTrial({
      crmMakeupCreditId: params.makeupCreditId,
      ticketId: reserved.ticket_id,
    }).catch(() => undefined);
    throw bookErr;
  }

  await db
    .from("makeup_credits")
    .update({ status: "booked" })
    .eq("id", params.makeupCreditId);

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.bookedBy ?? null,
    action: "makeup.booked_trial",
    entityType: "makeup_booking",
    entityId: booking.id,
    after: { ...booking, trial: reserved },
    requestId: params.requestId,
  });

  return {
    ...booking,
    trial: {
      title: reserved.title,
      starts_at: reserved.starts_at,
      slug: reserved.slug,
      remaining: reserved.remaining,
    },
    credit_id: credit.id,
  };
}

export async function cancelMakeupBooking(
  db: SupabaseClient,
  params: {
    tenantId: string;
    makeupCreditId: string;
    cancelledBy?: string | null;
    forceBurn?: boolean;
    requestId?: string;
  },
) {
  const { data: booking, error } = await db
    .from("makeup_bookings")
    .select("*, sessions(starts_at)")
    .eq("makeup_credit_id", params.makeupCreditId)
    .eq("status", "booked")
    .order("booked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!booking) throw new Error("Активная бронь не найдена");

  let forceBurn = Boolean(params.forceBurn);
  if (booking.target_kind === "group_session" && booking.sessions?.starts_at) {
    const minutesToStart = differenceInMinutes(
      new Date(booking.sessions.starts_at),
      new Date(),
    );
    if (minutesToStart < MAKEUP_CUTOFF) forceBurn = true;
  }
  if (booking.target_kind === "trial_event" && booking.tickets_starts_at) {
    const minutesToStart = differenceInMinutes(
      new Date(booking.tickets_starts_at),
      new Date(),
    );
    if (minutesToStart < MAKEUP_CUTOFF) forceBurn = true;
  }

  if (booking.target_kind === "trial_event") {
    // For trials we ask Tickets for starts_at via cancel only if still free;
    // late cancel still burns CRM credit.
    try {
      await cancelTicketsMakeupTrial({
        crmMakeupCreditId: params.makeupCreditId,
        ticketId: booking.tickets_ticket_id ?? undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("already_used")) {
        forceBurn = true;
      } else {
        throw e;
      }
    }
  }

  await db
    .from("makeup_bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", booking.id);

  const newStatus = forceBurn ? "burned" : "available";
  await db
    .from("makeup_credits")
    .update({ status: newStatus })
    .eq("id", params.makeupCreditId);

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.cancelledBy ?? null,
    action: forceBurn ? "makeup.burned" : "makeup.cancelled",
    entityType: "makeup_booking",
    entityId: booking.id,
    after: { creditStatus: newStatus },
    requestId: params.requestId,
  });

  return { bookingId: booking.id, creditStatus: newStatus };
}
