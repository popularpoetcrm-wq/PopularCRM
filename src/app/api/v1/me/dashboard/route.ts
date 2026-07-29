import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getDemoState } from "@/lib/demo-store";
import { getExtendedDemo, getChildrenForParent } from "@/lib/demo-ops";
import { hasSupabase } from "@/lib/env";
import { getCabinetDashboardDb, getPersonOnboardingStatus } from "@/lib/supabase-data";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  if (hasSupabase() && user.mode === "supabase") {
    try {
      const data = await getCabinetDashboardDb(user.personId, user.tenantId);
      const onboarding_status = await getPersonOnboardingStatus(user.personId);
      return jsonOk({
        me: user,
        onboarding_status,
        ...data,
        notifications: [],
      });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "dashboard fail", 500);
    }
  }

  const state = getDemoState();
  const ext = getExtendedDemo();
  const children = getChildrenForParent(user.personId);
  const childIds = children.map((c) => c.id);
  const scopeIds = [user.personId, ...childIds];

  const myEnrollments = state.enrollments.filter((e) =>
    scopeIds.includes(e.student_person_id),
  );
  const myPackages = state.packages.filter((p) =>
    myEnrollments.some((e) => e.id === p.enrollment_id),
  );
  const myMakeups = state.makeups.filter((m) =>
    scopeIds.includes(m.student_person_id),
  );
  const myPayments = state.payments.filter((p) => p.payer_person_id === user.personId);
  const schedule = myEnrollments.flatMap((e) =>
    state.sessions
      .filter((s) => s.group_id === e.group_id)
      .map((s) => {
        const att = state.attendance.find(
          (a) =>
            a.session_id === s.id && a.student_person_id === e.student_person_id,
        );
        return {
          ...s,
          myStatus: att?.status ?? null,
          forStudentId: e.student_person_id,
        };
      }),
  );
  const seen = new Set<string>();
  const scheduleUnique = schedule.filter((s) => {
    const key = `${s.id}:${s.forStudentId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const person = state.persons.find((p) => p.id === user.personId);

  return jsonOk({
    me: user,
    onboarding_status: person?.onboarding_status ?? "complete",
    children,
    schedule: scheduleUnique,
    packages: myPackages,
    makeups: myMakeups,
    payments: myPayments,
    invoices: state.invoices.filter((i) =>
      myPayments.some((p) => p.id === i.payment_id),
    ),
    groups: state.groups.filter((g) =>
      myEnrollments.some((e) => e.group_id === g.id),
    ),
    notifications: ext.notifications
      .filter((n) => n.recipient_person_id === user.personId)
      .slice(0, 10),
  });
}
