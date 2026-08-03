import { z } from "zod";
import { getRequestId, jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { plannedAbsenceDemo } from "@/lib/demo-attendance";
import { hasSupabase } from "@/lib/env";
import { STUDIO_POLICY } from "@/lib/studio-policy";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  action: z.enum(["preview", "apply"]).default("preview"),
  startsOn: ymd,
  endsOn: ymd,
  /** Parent acting for a child; empty means the signed-in student. */
  studentPersonId: z.string().min(1).optional(),
});

function validYmd(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * One absence for a future trip. The client must preview first, then explicitly
 * confirm apply; the server always recalculates the affected sessions.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Неверные даты");
  const { startsOn, endsOn } = parsed.data;
  if (!validYmd(startsOn) || !validYmd(endsOn) || endsOn < startsOn) {
    return jsonError("Проверь даты отсутствия");
  }
  const days =
    (Date.parse(`${endsOn}T00:00:00.000Z`) -
      Date.parse(`${startsOn}T00:00:00.000Z`)) /
    86_400_000;
  if (days > 45) {
    return jsonError("За один раз можно перенести период до 45 дней");
  }

  try {
    if (hasSupabase() && user.mode === "supabase") {
      const { getAdminClient } = await import("@/lib/supabase/admin");
      const { plannedAbsenceDb } = await import("@/domain/attendance");
      const result = await plannedAbsenceDb(getAdminClient(), {
        tenantId: user.tenantId,
        actorPersonId: user.personId,
        studentPersonId: parsed.data.studentPersonId,
        startsOn,
        endsOn,
        action: parsed.data.action,
        requestId: getRequestId(req),
      });
      return jsonOk({ ...result, policy: STUDIO_POLICY });
    }

    const result = plannedAbsenceDemo({
      personId: user.personId,
      studentPersonId: parsed.data.studentPersonId,
      startsOn,
      endsOn,
      action: parsed.data.action,
      actorName: user.fullName,
    });
    return jsonOk({ ...result, policy: STUDIO_POLICY });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось перенести занятия", 400);
  }
}
