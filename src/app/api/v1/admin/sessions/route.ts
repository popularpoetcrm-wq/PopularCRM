import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { getDemoState } from "@/lib/demo-store";
import { warsawYmd } from "@/lib/format-date";
import { listGroupsDb, listSessionsArchiveDb } from "@/lib/supabase-data";
import type { BrandId } from "@/lib/brands";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  const url = new URL(req.url);
  const month = url.searchParams.get("month") || warsawYmd().slice(0, 7);
  const groupId = url.searchParams.get("groupId") || undefined;
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return jsonError("Invalid month, expected YYYY-MM");
  }

  if (hasSupabase() && user.mode === "supabase") {
    try {
      const [sessions, groups] = await Promise.all([
        listSessionsArchiveDb(user.tenantId, tab, { month, groupId }),
        listGroupsDb(user.tenantId, tab, { includeInactive: true }),
      ]);
      return jsonOk({ sessions, groups, month, mode: user.mode });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 500);
    }
  }

  const state = getDemoState();
  const groups = state.groups.filter((g) => g.brand_id === tab);
  const groupIds = new Set(groups.map((g) => g.id));
  const sessions = state.sessions
    .filter((s) => groupIds.has(s.group_id))
    .filter((s) => s.starts_at.slice(0, 7) === month)
    .filter((s) => !groupId || s.group_id === groupId)
    .map((s) => {
      const group = groups.find((g) => g.id === s.group_id);
      const marks = state.attendance.filter((a) => a.session_id === s.id);
      return {
        id: s.id,
        group_id: s.group_id,
        group_title: group?.title ?? s.title,
        starts_at: s.starts_at,
        status: s.status,
        present_count: marks.filter((a) => a.status === "present").length,
        absent_count: marks.filter((a) =>
          ["absent", "absent_notified"].includes(a.status),
        ).length,
        marked_count: marks.length,
      };
    })
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));

  return jsonOk({
    sessions,
    groups: groups.map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status ?? "active",
    })),
    month,
    mode: user.mode,
  });
}
