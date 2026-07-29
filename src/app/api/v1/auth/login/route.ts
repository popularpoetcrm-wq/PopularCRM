import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getDemoState, DEMO_TENANT_ID } from "@/lib/demo-store";
import { getEnv, hasSupabase } from "@/lib/env";
import { markActivatedOnLogin } from "@/lib/demo-onboarding";
import {
  findPersonByEmail,
  getPersonRoles,
  issueMagicCode,
  tenantIdOrDefault,
} from "@/lib/supabase-data";

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

  try {
    const env = getEnv();
    const tenantId = tenantIdOrDefault(env.DEFAULT_TENANT_ID);
    const person = await findPersonByEmail(email, tenantId);
    if (!person) {
      return jsonError("Нет аккаунта с этим email. Нужен инвайт от студии.", 404);
    }

    const code = await issueMagicCode(email, person.tenant_id);
    const roles = await getPersonRoles(person.id);

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
      message: env.RESEND_API_KEY
        ? "Kod wysłany na email."
        : "Kod zapisany в БД (Resend нет — смотри debugCode).",
      personId: person.id,
      roles,
      onboarding_status: person.onboarding_status ?? "complete",
      debugCode: env.RESEND_API_KEY ? undefined : code,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "login fail", 500);
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("studio_person_id");
  res.cookies.delete("studio_tenant_id");
  return res;
}
