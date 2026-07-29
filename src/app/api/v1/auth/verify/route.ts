import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { DEMO_TENANT_ID } from "@/lib/demo-store";
import { hasSupabase } from "@/lib/env";
import {
  consumeMagicCode,
  findPersonByEmail,
  getPersonRoles,
  markPersonActivated,
} from "@/lib/supabase-data";
import { getAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
});

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return jsonError("Supabase not configured", 400);
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  const email = parsed.data.email.toLowerCase();

  try {
    const row = await consumeMagicCode(email, parsed.data.code);
    if (!row) return jsonError("Invalid or expired code", 401);

    let person = await findPersonByEmail(email, row.tenant_id);
    if (!person) {
      const db = getAdminClient();
      const created = await db
        .from("persons")
        .insert({
          tenant_id: row.tenant_id || DEMO_TENANT_ID,
          full_name: email.split("@")[0],
          email,
          status: "completed",
          onboarding_status: "activated",
          activated_at: new Date().toISOString(),
        })
        .select("id, tenant_id, full_name, email, onboarding_status, is_minor, status")
        .single();
      if (created.error || !created.data) {
        return jsonError(created.error?.message ?? "person create failed", 500);
      }
      person = created.data;
      await db.from("person_roles").insert({
        tenant_id: person.tenant_id,
        person_id: person.id,
        role: "payer",
      });
    }

    await markPersonActivated(person.id);
    const roles = await getPersonRoles(person.id);
    const status = person.onboarding_status ?? "complete";
    const needsWelcome =
      status === "draft" || status === "invited" || status === "activated";

    const res = jsonOk({
      personId: person.id,
      roles,
      onboarding_status: status,
      needsWelcome,
      mode: "supabase",
    });
    res.cookies.set("studio_person_id", person.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    res.cookies.set("studio_tenant_id", person.tenant_id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return res;
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "verify fail", 500);
  }
}
