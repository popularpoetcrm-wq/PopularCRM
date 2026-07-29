import { z } from "zod";
import { cookies } from "next/headers";
import { jsonError, jsonOk, getRequestId } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { listSessionsForBrand, markAttendanceDemo } from "@/lib/demo-attendance";
import type { BrandId } from "@/lib/brands";

const itemSchema = z.object({
  enrollmentId: z.string(),
  studentPersonId: z.string(),
  attendanceType: z.enum(["regular", "makeup"]).default("regular"),
  status: z.enum(["present", "absent", "absent_notified", "cancelled_by_studio"]),
  comment: z.string().nullable().optional(),
});

const bodySchema = z.object({
  sessionId: z.string(),
  items: z.array(itemSchema).min(1),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  return jsonOk(listSessionsForBrand(tab));
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  if (!hasSupabase() || user.mode === "demo") {
    try {
      const result = markAttendanceDemo({
        sessionId: parsed.data.sessionId,
        items: parsed.data.items,
        actor: user.fullName,
      });
      return jsonOk(result);
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  const { bulkUpsertAttendance } = await import("@/domain/attendance");
  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const results = await bulkUpsertAttendance(db, {
    tenantId: user.tenantId,
    sessionId: parsed.data.sessionId,
    items: parsed.data.items,
    markedBy: user.personId,
    requestId: getRequestId(req),
  });
  return jsonOk(results);
}
