import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";

/**
 * Legacy demo offers endpoint.
 * Real trials/events live on populartickets.pl — do not create them in CRM.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  return jsonOk([]);
}

export async function POST() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  return jsonError(
    "Пробные и ивенты создаются на populartickets.pl, не в CRM",
    400,
  );
}
