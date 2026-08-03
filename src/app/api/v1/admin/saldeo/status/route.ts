import { getSessionUser, isAdmin } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getSaldeoSetup } from "@/integrations/saldeo";

/** Safe configuration state for the admin UI; credentials never leave the server. */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);
  return jsonOk(getSaldeoSetup());
}
