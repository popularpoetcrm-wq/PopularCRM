import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { DEMO_TENANT_ID } from "@/lib/demo-store";
import { consumeInviteToken } from "@/lib/demo-onboarding";

const schema = z.object({
  token: z.string().min(8),
});

/** Consume invite magic-link token → set session cookie. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid token");

  try {
    const person = consumeInviteToken(parsed.data.token);
    const needsWelcome =
      person.onboarding_status !== "complete";

    const res = jsonOk({
      personId: person.id,
      fullName: person.full_name,
      roles: person.roles,
      onboarding_status: person.onboarding_status,
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
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
