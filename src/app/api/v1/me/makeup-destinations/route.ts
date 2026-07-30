import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { getEnv, hasSupabase } from "@/lib/env";
import { getDemoState } from "@/lib/demo-store";
import { STUDIO_POLICY, cutoffMinutes } from "@/lib/studio-policy";
import { differenceInMinutes } from "date-fns";

const MAKEUP_CUTOFF = cutoffMinutes(STUDIO_POLICY.makeupCutoffHours);

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  if (!hasSupabase() || user.mode === "demo") {
    const state = getDemoState();
    const now = Date.now();
    const groups = state.sessions
      .filter((s) => s.status === "scheduled" && new Date(s.starts_at).getTime() > now)
      .filter(
        (s) =>
          differenceInMinutes(new Date(s.starts_at), new Date()) >= MAKEUP_CUTOFF,
      )
      .map((s) => {
        const group = state.groups.find((g) => g.id === s.group_id);
        return {
          kind: "group_session" as const,
          id: s.id,
          title: s.title,
          group_title: group?.title ?? "Группа",
          starts_at: s.starts_at,
          brand_id: group?.brand_id ?? "poet",
          remaining: Math.max(
            0,
            (group?.capacity ?? 12) -
              state.enrollments.filter(
                (e) => e.group_id === s.group_id && e.status === "active",
              ).length,
          ),
        };
      })
      .filter((s) => s.remaining > 0);
    return jsonOk({ groups, trials: [] });
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const tenantId =
    user.tenantId ||
    getEnv().DEFAULT_TENANT_ID ||
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  const nowIso = new Date().toISOString();
  const { data: sessions, error } = await db
    .from("sessions")
    .select(
      "id, starts_at, status, capacity_override, group_id, groups(id, title, capacity, brand_id, status)",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "scheduled")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(80);
  if (error) return jsonError(error.message, 500);

  const groups = [];
  for (const session of sessions ?? []) {
    const group = Array.isArray(session.groups)
      ? session.groups[0]
      : session.groups;
    if (!group || group.status !== "active") continue;
    if (group.brand_id && group.brand_id !== "poet" && group.brand_id !== "kids") {
      continue;
    }
    if (
      differenceInMinutes(new Date(session.starts_at), new Date()) < MAKEUP_CUTOFF
    ) {
      continue;
    }

    const capacity =
      session.capacity_override ?? group.capacity ?? 12;
    const { count: reserved } = await db
      .from("makeup_bookings")
      .select("*", { count: "exact", head: true })
      .eq("target_session_id", session.id)
      .eq("status", "booked");
    const { count: regular } = await db
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("group_id", session.group_id)
      .eq("status", "active");
    const remaining = capacity - (reserved ?? 0) - (regular ?? 0);
    if (remaining <= 0) continue;

    groups.push({
      kind: "group_session" as const,
      id: session.id,
      title: `${group.title} · занятие`,
      group_title: group.title as string,
      starts_at: session.starts_at as string,
      brand_id: group.brand_id as string,
      remaining,
    });
  }

  let trials: Array<{
    kind: "trial_event";
    id: string;
    title: string;
    starts_at: string;
    venue: string;
    slug: string;
    remaining: number;
  }> = [];

  try {
    const { fetchTicketsTrials } = await import("@/lib/tickets-makeup");
    const list = await fetchTicketsTrials();
    trials = list
      .filter(
        (t) =>
          differenceInMinutes(new Date(t.starts_at), new Date()) >= MAKEUP_CUTOFF,
      )
      .map((t) => ({
        kind: "trial_event" as const,
        id: t.id,
        title: t.title,
        starts_at: t.starts_at,
        venue: t.venue,
        slug: t.slug,
        remaining: t.remaining,
      }));
  } catch (e) {
    console.error("[makeup-destinations] trials", e);
  }

  return jsonOk({ groups, trials });
}
