import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { resetDemoState } from "@/lib/demo-store";

/** Reset in-memory + file demo store (admin). */
export async function POST() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);
  resetDemoState();
  return jsonOk({ reset: true });
}
