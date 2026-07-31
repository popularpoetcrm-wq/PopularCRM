import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import type { BrandId } from "@/lib/brands";
import { hasSupabase } from "@/lib/env";
import { warsawYmd } from "@/lib/format-date";
import { listSessionsArchiveDb } from "@/lib/supabase-data";
import { fetchTicketsTrials } from "@/lib/tickets-makeup";
import { getDemoState } from "@/lib/demo-store";

export type CalendarEvent = {
  id: string;
  kind: "session" | "trial";
  title: string;
  starts_at: string;
  group_id?: string | null;
  status?: string | null;
  slug?: string | null;
  venue?: string | null;
  remaining?: number | null;
  total_tickets?: number | null;
  price_pln?: number | null;
};

function inMonth(iso: string, month: string) {
  // Compare in Warsaw calendar date
  try {
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
    return ymd.startsWith(month);
  } catch {
    return iso.slice(0, 7) === month;
  }
}

/** GET /api/v1/admin/calendar?month=YYYY-MM — studio sessions + Tickets trials. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);

  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  const month =
    new URL(req.url).searchParams.get("month") || warsawYmd().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return jsonError("Invalid month, expected YYYY-MM");
  }

  const events: CalendarEvent[] = [];

  if (hasSupabase() && user.mode === "supabase") {
    try {
      const sessions = await listSessionsArchiveDb(user.tenantId, tab, { month });
      for (const s of sessions) {
        events.push({
          id: `session:${s.id}`,
          kind: "session",
          title: s.group_title,
          starts_at: s.starts_at,
          group_id: s.group_id,
          status: s.status,
        });
      }
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "sessions fail", 500);
    }
  } else {
    const state = getDemoState();
    const groups = state.groups.filter((g) => g.brand_id === tab);
    const groupIds = new Set(groups.map((g) => g.id));
    for (const s of state.sessions) {
      if (!groupIds.has(s.group_id)) continue;
      if (!inMonth(s.starts_at, month)) continue;
      const group = groups.find((g) => g.id === s.group_id);
      events.push({
        id: `session:${s.id}`,
        kind: "session",
        title: group?.title ?? s.title,
        starts_at: s.starts_at,
        group_id: s.group_id,
        status: s.status,
      });
    }
  }

  let trials_error: string | null = null;
  try {
    const trials = await fetchTicketsTrials();
    for (const t of trials) {
      if (!inMonth(t.starts_at, month)) continue;
      events.push({
        id: `trial:${t.id}`,
        kind: "trial",
        title: t.title,
        starts_at: t.starts_at,
        slug: t.slug,
        venue: t.venue,
        remaining: t.remaining,
        total_tickets: t.total_tickets,
        price_pln: Math.round(t.price_grosze / 100),
      });
    }
  } catch (e) {
    trials_error = e instanceof Error ? e.message : "tickets fail";
  }

  events.sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return jsonOk({
    month,
    brand_id: tab,
    events,
    trials_error,
  });
}
