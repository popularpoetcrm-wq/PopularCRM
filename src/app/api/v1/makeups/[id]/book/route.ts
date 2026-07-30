import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { bookMakeupDemo } from "@/lib/demo-attendance";

const bodySchema = z.object({
  targetKind: z.enum(["group_session", "trial_event"]).default("group_session"),
  targetSessionId: z.string().uuid().or(z.string().min(1)).optional(),
  ticketsEventId: z.string().uuid().optional(),
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
    if (parsed.data.targetKind === "trial_event") {
      return jsonError("В demo пробные через Tickets недоступны", 400);
    }
    if (!parsed.data.targetSessionId) {
      return jsonError("targetSessionId required");
    }
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

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();

  try {
    if (parsed.data.targetKind === "trial_event") {
      if (!parsed.data.ticketsEventId) {
        return jsonError("ticketsEventId required");
      }
      const { data: person } = await db
        .from("persons")
        .select("email, full_name")
        .eq("id", user.personId)
        .maybeSingle();
      if (!person?.email) {
        return jsonError("Нужен email в профиле для записи на пробное", 400);
      }
      const { bookMakeupTrial } = await import("@/domain/makeup");
      const booking = await bookMakeupTrial(db, {
        tenantId: user.tenantId,
        makeupCreditId: id,
        ticketsEventId: parsed.data.ticketsEventId,
        buyerEmail: person.email,
        buyerName: person.full_name ?? undefined,
        bookedBy: user.personId,
      });
      return jsonOk(booking);
    }

    if (!parsed.data.targetSessionId) {
      return jsonError("targetSessionId required");
    }
    const { bookMakeup } = await import("@/domain/makeup");
    const booking = await bookMakeup(db, {
      tenantId: user.tenantId,
      makeupCreditId: id,
      targetSessionId: parsed.data.targetSessionId,
      bookedBy: user.personId,
    });
    return jsonOk(booking);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
