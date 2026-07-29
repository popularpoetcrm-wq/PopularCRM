import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { getExtendedDemo, runDemoJobs } from "@/lib/demo-ops";

export async function POST() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  return jsonOk(runDemoJobs());
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const state = getExtendedDemo();
  const mine = state.notifications.filter(
    (n) =>
      n.recipient_person_id === user.personId ||
      user.roles.includes("admin"),
  );
  return jsonOk({
    notifications: mine.slice(0, 50),
    audit: user.roles.includes("admin") ? state.audit.slice(0, 50) : [],
  });
}
