import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { fetchTicketsTrials } from "@/lib/tickets-makeup";

/** Live trial list from populartickets.pl — CRM does not own trial creation. */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  try {
    const trials = await fetchTicketsTrials();
    return jsonOk({ trials, source: "populartickets.pl" });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "tickets fail", 502);
  }
}
