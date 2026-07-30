import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { DEMO_TENANT_ID } from "@/lib/demo-store";
import { consumeInviteToken } from "@/lib/demo-onboarding";
import { hasSupabase } from "@/lib/env";
import { consumeInviteTokenDb } from "@/lib/supabase-onboarding";
import { getPersonRoles } from "@/lib/supabase-data";
import { applySessionCookies } from "@/lib/session";

const schema = z.object({
  token: z.string().min(8),
});

/** Consume invite magic-link token → set signed session cookie. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid token");

  try {
    if (hasSupabase()) {
      const person = await consumeInviteTokenDb(parsed.data.token);
      const roles = person.roles?.length
        ? person.roles
        : await getPersonRoles(person.id);
      const status = person.onboarding_status ?? "activated";
      const needsWelcome =
        status === "draft" || status === "invited" || status === "activated";
      const res = jsonOk({
        personId: person.id,
        fullName: person.full_name,
        roles,
        onboarding_status: status,
        needsWelcome,
        mode: "supabase",
      });
      return applySessionCookies(res, {
        personId: person.id,
        tenantId: person.tenant_id,
      });
    }

    const person = consumeInviteToken(parsed.data.token);
    const needsWelcome = person.onboarding_status !== "complete";
    const res = jsonOk({
      personId: person.id,
      fullName: person.full_name,
      roles: person.roles,
      onboarding_status: person.onboarding_status,
      needsWelcome,
      mode: "demo",
    });
    return applySessionCookies(res, {
      personId: person.id,
      tenantId: DEMO_TENANT_ID,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
