import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin, isStaff } from "@/lib/auth";
import { getDayBoard, finalizeSessionPresentDefaults } from "@/lib/demo-attendance";
import { remindAllDebtors } from "@/lib/demo-ops";
import type { BrandId } from "@/lib/brands";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  return jsonOk({ sessions: getDayBoard(tab) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const body = await req.json().catch(() => ({}));

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
