import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { moveEnrollmentDb, setEnrollmentStatusDb } from "@/lib/supabase-data";
import { moveDemoEnrollment } from "@/lib/demo-ops";

const moveSchema = z.object({
  action: z.literal("move"),
  enrollment_id: z.string().min(1),
  to_group_id: z.string().min(1),
});

const statusSchema = z.object({
  action: z.literal("set_status"),
  enrollment_id: z.string().min(1),
  status: z.enum(["active", "paused", "ended"]),
});

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);

  const body = await req.json().catch(() => ({}));

  if (body?.action === "set_status") {
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) return jsonError("Неверные данные");
    if (!(hasSupabase() && user.mode === "supabase")) {
      return jsonError("Нужен режим Supabase", 501);
    }
    try {
      return jsonOk(
        await setEnrollmentStatusDb({
          enrollmentId: parsed.data.enrollment_id,
          tenantId: user.tenantId,
          status: parsed.data.status,
        }),
      );
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "ошибка", 400);
    }
  }

  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) return jsonError("Неверные данные");

  if (hasSupabase() && user.mode === "supabase") {
    try {
      const result = await moveEnrollmentDb({
        enrollmentId: parsed.data.enrollment_id,
        toGroupId: parsed.data.to_group_id,
        tenantId: user.tenantId,
      });
      return jsonOk(result);
    } catch (e) {
      return jsonError(
        e instanceof Error ? e.message : "не удалось перенести",
        400,
      );
    }
  }

  try {
    const result = moveDemoEnrollment({
      enrollmentId: parsed.data.enrollment_id,
      toGroupId: parsed.data.to_group_id,
      actor: user.fullName,
    });
    return jsonOk(result);
  } catch (e) {
    return jsonError(
      e instanceof Error ? e.message : "не удалось перенести",
      400,
    );
  }
}
