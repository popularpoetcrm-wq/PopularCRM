import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { getStudentCard } from "@/lib/demo-ops";
import { invitePerson } from "@/lib/demo-onboarding";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const { id } = await ctx.params;
  try {
    return jsonOk(getStudentCard(id));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 404);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body?.action === "invite") {
    try {
      return jsonOk(invitePerson(id, { actor: user.fullName }));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }
  return jsonError("Unknown action");
}
