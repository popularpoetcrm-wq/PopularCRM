import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { bookMakeupDemo } from "@/lib/demo-attendance";

const bodySchema = z.object({
  targetSessionId: z.string(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  if (!hasSupabase() || user.mode === "demo") {
    try {
      return jsonOk(
        bookMakeupDemo({
          makeupId: id,
          targetSessionId: parsed.data.targetSessionId,
          actorPersonId: user.personId,
        }),
      );
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  const { bookMakeup } = await import("@/domain/makeup");
  const { getAdminClient } = await import("@/lib/supabase/admin");
  const booking = await bookMakeup(getAdminClient(), {
    tenantId: user.tenantId,
    makeupCreditId: id,
    targetSessionId: parsed.data.targetSessionId,
    bookedBy: user.personId,
  });
  return jsonOk(booking);
}
