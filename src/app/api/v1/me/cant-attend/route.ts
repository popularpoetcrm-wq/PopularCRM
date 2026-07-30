import { z } from "zod";
import { getRequestId, jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { reportCantAttendDemo } from "@/lib/demo-attendance";
import { STUDIO_POLICY } from "@/lib/studio-policy";
import { hasSupabase } from "@/lib/env";

const schema = z.object({
  sessionId: z.string().min(1),
  /** Parent acting for child */
  studentPersonId: z.string().optional(),
});

/** «Не приду» — сам или родитель за ребёнка. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  try {
    if (hasSupabase() && user.mode === "supabase") {
      const { getAdminClient } = await import("@/lib/supabase/admin");
      const { reportCantAttendDb } = await import("@/domain/attendance");
      const result = await reportCantAttendDb(getAdminClient(), {
        tenantId: user.tenantId,
        sessionId: parsed.data.sessionId,
        actorPersonId: user.personId,
        studentPersonId: parsed.data.studentPersonId,
        requestId: getRequestId(req),
      });
      return jsonOk({ ...result, policy: STUDIO_POLICY });
    }

    const result = reportCantAttendDemo({
      sessionId: parsed.data.sessionId,
      personId: user.personId,
      studentPersonId: parsed.data.studentPersonId,
      actorName: user.fullName,
    });
    return jsonOk({ ...result, policy: STUDIO_POLICY });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
