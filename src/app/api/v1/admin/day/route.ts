import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin, isStaff } from "@/lib/auth";
import { getDayBoard, finalizeSessionPresentDefaults } from "@/lib/demo-attendance";
import { remindAllDebtors } from "@/lib/demo-ops";
import { hasSupabase } from "@/lib/env";
import { warsawYmd } from "@/lib/format-date";
import { getDayBoardDb } from "@/lib/supabase-data";
import type { BrandId } from "@/lib/brands";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  const rawDate = new URL(req.url).searchParams.get("date") || undefined;
  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return jsonError("Invalid date, expected YYYY-MM-DD");
  }
  const date = rawDate ?? warsawYmd();

  if (hasSupabase() && user.mode === "supabase") {
    try {
      return jsonOk({
        sessions: await getDayBoardDb(user.tenantId, tab, { date }),
        date,
        mode: user.mode,
      });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 500);
    }
  }

  return jsonOk({ sessions: getDayBoard(tab), date, mode: user.mode });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const body = await req.json().catch(() => ({}));

  if (hasSupabase() && user.mode === "supabase") {
    if (body?.action === "finalize") {
      return jsonError("Finalize в Supabase — следующим шагом (пока demo)", 501);
    }
    if (body?.action === "remind_debtors") {
      if (!isAdmin(user.roles)) return jsonError("Forbidden", 403);
      return jsonError("Reminders в Supabase notifications — следующим шагом", 501);
    }
  }

  if (body?.action === "finalize" && body.sessionId) {
    try {
      return jsonOk(
        finalizeSessionPresentDefaults(String(body.sessionId), user.fullName),
      );
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  if (body?.action === "remind_debtors") {
    if (!isAdmin(user.roles)) return jsonError("Forbidden", 403);
    return jsonOk(remindAllDebtors(user.fullName));
  }

  return jsonError("Unknown action");
}
