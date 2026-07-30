import { z } from "zod";
import { getRequestId, jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { finalizeSessionPresentDefaults } from "@/lib/demo-attendance";
import { hasSupabase } from "@/lib/env";

const schema = z.object({
  sessionId: z.string(),
});

/** Все, кто явно не сказал «не приду», отмечаются как present. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  try {
    if (hasSupabase() && user.mode === "supabase") {
      const { getAdminClient } = await import("@/lib/supabase/admin");
      const { finalizeSessionDb } = await import("@/domain/attendance");
      return jsonOk(
        await finalizeSessionDb(getAdminClient(), {
          tenantId: user.tenantId,
          sessionId: parsed.data.sessionId,
          actorPersonId: user.personId,
          requestId: getRequestId(req),
        }),
      );
    }

    const result = finalizeSessionPresentDefaults(
      parsed.data.sessionId,
      user.fullName,
    );
    return jsonOk(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
