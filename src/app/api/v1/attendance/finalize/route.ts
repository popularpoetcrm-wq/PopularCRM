import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { finalizeSessionPresentDefaults } from "@/lib/demo-attendance";

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
    const result = finalizeSessionPresentDefaults(
      parsed.data.sessionId,
      user.fullName,
    );
    return jsonOk(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
