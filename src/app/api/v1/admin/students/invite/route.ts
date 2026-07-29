import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { inviteGroup, inviteMany } from "@/lib/demo-onboarding";

const schema = z.object({
  personIds: z.array(z.string()).optional(),
  groupId: z.string().optional(),
});

/** POST /api/v1/admin/students/invite — selected persons or whole group. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  if (parsed.data.groupId) {
    return jsonOk({
      results: inviteGroup(parsed.data.groupId, user.fullName),
    });
  }

  if (parsed.data.personIds?.length) {
    return jsonOk({
      results: inviteMany(parsed.data.personIds, user.fullName),
    });
  }

  return jsonError("personIds or groupId required");
}
