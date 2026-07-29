import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getDemoState, DEMO_TENANT_ID } from "@/lib/demo-store";
import { hasSupabase } from "@/lib/env";
import { markActivatedOnLogin } from "@/lib/demo-onboarding";

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid email");

  const email = parsed.data.email.toLowerCase();

  if (!hasSupabase()) {
    const person = getDemoState().persons.find((p) => p.email.toLowerCase() === email);
    if (!person) {
      return jsonError(
        "Нет такого email в системе. Вход только по инвайту / для существующих клиентов.",
        404,
      );
    }
    markActivatedOnLogin(person.id);
    const needsWelcome =
      person.onboarding_status === "draft" ||
      person.onboarding_status === "invited" ||
      person.onboarding_status === "activated";

    const res = jsonOk({
      mode: "demo",
      message: "Demo login: cookie set",
      personId: person.id,
      roles: person.roles,
      onboarding_status: person.onboarding_status ?? "complete",
      needsWelcome,
    });
    res.cookies.set("studio_person_id", person.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    res.cookies.set("studio_tenant_id", DEMO_TENANT_ID, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return res;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const { getEnv } = await import("@/lib/env");
  const env = getEnv();
  const tenantId = env.DEFAULT_TENANT_ID ?? DEMO_TENANT_ID;

  const { data: person } = await db
    .from("persons")
    .select("id")
    .eq("email", email)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!person) {
    return jsonError("Нет аккаунта с этим email. Нужен инвайт от студии.", 404);
  }

  await db.from("magic_login_codes").insert({
    tenant_id: tenantId,
    email,
    code,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });

  if (env.RESEND_API_KEY) {
    const { Resend } = await import("resend");
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: env.EMAIL_FROM!,
      to: email,
      subject: "Kod logowania — Studio CRM",
      text: `Twój kod: ${code}`,
    });
  }

  return jsonOk({
    mode: "magic",
    message: "Kod wysłany na email (jeśli Resend skonfigurowany).",
    debugCode: env.RESEND_API_KEY ? undefined : code,
  });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("studio_person_id");
  res.cookies.delete("studio_tenant_id");
  return res;
}
