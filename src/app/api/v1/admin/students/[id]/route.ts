import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { getStudentCard } from "@/lib/demo-ops";
import { invitePerson } from "@/lib/demo-onboarding";
import { hasSupabase } from "@/lib/env";
import { getStudentCardDb, invitePersonDb } from "@/lib/supabase-onboarding";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const { id } = await ctx.params;
  try {
    if (hasSupabase() && user.mode === "supabase") {
      return jsonOk(await getStudentCardDb(id, user.tenantId));
    }
    return jsonOk(getStudentCard(id));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 404);
  }
}

const inviteBody = z.object({
  action: z.literal("invite"),
  email: z.string().email().optional(),
});

const patchBody = z.object({
  action: z.literal("set-email").optional(),
  email: z.string().email().optional(),
  phone: z.string().optional().nullable(),
});

export async function POST(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body?.action === "invite") {
    const parsed = inviteBody.safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");
    try {
      if (hasSupabase() && user.mode === "supabase") {
        return jsonOk(
          await invitePersonDb(id, {
            actorId: user.personId,
            email: parsed.data.email,
          }),
        );
      }
      return jsonOk(invitePerson(id, { actor: user.fullName }));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }
  return jsonError("Unknown action");
}

export async function PATCH(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const { id } = await ctx.params;
  const parsed = patchBody.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  if (!(hasSupabase() && user.mode === "supabase")) {
    return jsonError("Supabase required", 400);
  }

  const db = getAdminClient();
  const payload: Record<string, unknown> = {};
  if (parsed.data.email) payload.email = parsed.data.email.toLowerCase();
  if (parsed.data.phone !== undefined) payload.phone = parsed.data.phone;
  if (!Object.keys(payload).length) return jsonError("Nothing to update");

  const { data, error } = await db
    .from("persons")
    .update(payload)
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .select("id, full_name, email, phone, onboarding_status")
    .single();
  if (error) return jsonError(error.message, 400);
  return jsonOk(data);
}
