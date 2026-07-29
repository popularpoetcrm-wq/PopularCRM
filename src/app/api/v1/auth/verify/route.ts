import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { DEMO_TENANT_ID } from "@/lib/demo-store";

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const email = parsed.data.email.toLowerCase();

  const { data: row } = await db
    .from("magic_login_codes")
    .select("*")
    .eq("email", email)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row || row.code !== parsed.data.code) {
    return jsonError("Invalid or expired code", 401);
  }

  await db
    .from("magic_login_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);

  let { data: person } = await db
    .from("persons")
    .select("*")
    .eq("email", email)
    .eq("tenant_id", row.tenant_id)
    .maybeSingle();

  if (!person) {
    const created = await db
      .from("persons")
      .insert({
        tenant_id: row.tenant_id || DEMO_TENANT_ID,
        full_name: email.split("@")[0],
        email,
        status: "completed",
      })
      .select("*")
      .single();
    person = created.data;
    await db.from("person_roles").insert({
      tenant_id: person!.tenant_id,
      person_id: person!.id,
      role: "payer",
    });
  }

  const res = jsonOk({ personId: person!.id });
  res.cookies.set("studio_person_id", person!.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  res.cookies.set("studio_tenant_id", person!.tenant_id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
