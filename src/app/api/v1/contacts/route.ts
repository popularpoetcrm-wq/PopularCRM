import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { linkParentChild, getChildrenForParent, getExtendedDemo } from "@/lib/demo-ops";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.roles.includes("parent") || user.roles.includes("payer")) {
    return jsonOk({ children: getChildrenForParent(user.personId) });
  }
  return jsonOk({ contacts: getExtendedDemo().contacts });
}

const schema = z.object({
  student_person_id: z.string(),
  contact_person_id: z.string(),
  relation_type: z.enum(["parent", "guardian", "payer"]).optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");
  return jsonOk(linkParentChild({ ...parsed.data, actor: user.fullName }));
}
