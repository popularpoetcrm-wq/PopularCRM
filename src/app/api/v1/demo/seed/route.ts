import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { seedStudioDay } from "@/lib/demo-attendance";

export async function POST() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  try {
    return jsonOk(seedStudioDay());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 500);
  }
}
