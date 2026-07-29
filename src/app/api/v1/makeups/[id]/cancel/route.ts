import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { cancelMakeupDemo } from "@/lib/demo-attendance";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (!hasSupabase() || user.mode === "demo") {
    try {
      return jsonOk(
        cancelMakeupDemo({
          makeupId: id,
          actorPersonId: user.personId,
          forceBurn: Boolean(body?.forceBurn),
        }),
      );
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  const { cancelMakeupBooking } = await import("@/domain/makeup");
  const { getAdminClient } = await import("@/lib/supabase/admin");
  const result = await cancelMakeupBooking(getAdminClient(), {
    tenantId: user.tenantId,
    makeupCreditId: id,
    cancelledBy: user.personId,
  });
  return jsonOk(result);
}
