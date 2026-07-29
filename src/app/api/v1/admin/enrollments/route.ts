import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { moveEnrollmentDb } from "@/lib/supabase-data";
import { moveDemoEnrollment } from "@/lib/demo-ops";

const moveSchema = z.object({
  action: z.literal("move"),
  enrollment_id: z.string().min(1),
  to_group_id: z.string().min(1),
});

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);

  const parsed = moveSchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  if (hasSupabase() && user.mode === "supabase") {
    try {
      const result = await moveEnrollmentDb({
        enrollmentId: parsed.data.enrollment_id,
        toGroupId: parsed.data.to_group_id,
        tenantId: user.tenantId,
      });
      return jsonOk(result);
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "move fail", 400);
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
    return jsonError(e instanceof Error ? e.message : "move fail", 400);
  }
}
