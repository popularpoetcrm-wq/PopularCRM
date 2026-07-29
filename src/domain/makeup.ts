import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/domain/audit";

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
  const { data: credit, error } = await db
    .from("makeup_credits")
    .select("*")
    .eq("id", params.makeupCreditId)
    .eq("tenant_id", params.tenantId)
    .single();
  if (error) throw error;
  if (credit.status !== "available") {
    throw new Error("Makeup credit is not available");
  }
  if (new Date(credit.valid_until) < new Date()) {
    throw new Error("Makeup credit expired");
  }

  const { data: session, error: sessErr } = await db
    .from("sessions")
    .select("*, groups(capacity)")
    .eq("id", params.targetSessionId)
    .single();
  if (sessErr) throw sessErr;
  if (session.status !== "scheduled") {
    throw new Error("Target session is not bookable");
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
    throw new Error("No free spots in target session");
  }

  const { data: booking, error: bookErr } = await db
    .from("makeup_bookings")
    .insert({
      tenant_id: params.tenantId,
      makeup_credit_id: params.makeupCreditId,
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

  return booking;
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
    .select("*, sessions(starts_at), makeup_credits(*)")
    .eq("makeup_credit_id", params.makeupCreditId)
    .eq("status", "booked")
    .order("booked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!booking) throw new Error("Active booking not found");

  await db
    .from("makeup_bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", booking.id);

  const newStatus = params.forceBurn ? "burned" : "available";
  await db
    .from("makeup_credits")
    .update({ status: newStatus })
    .eq("id", params.makeupCreditId);

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.cancelledBy ?? null,
    action: "makeup.cancelled",
    entityType: "makeup_credit",
    entityId: params.makeupCreditId,
    after: { status: newStatus },
    requestId: params.requestId,
  });

  return { bookingId: booking.id, creditStatus: newStatus };
}
