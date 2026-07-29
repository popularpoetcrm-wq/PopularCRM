import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { upcomingBirthdays } from "@/lib/format-date";
import { getAdminClient } from "@/lib/supabase/admin";
import type { BrandId } from "@/lib/brands";
import { getDemoState } from "@/lib/demo-store";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  const days = Math.min(
    Math.max(Number(new URL(req.url).searchParams.get("days") ?? 30) || 30, 1),
    90,
  );

  if (hasSupabase() && user.mode === "supabase") {
    try {
      const db = getAdminClient();
      const { data: groups } = await db
        .from("groups")
        .select("id, title")
        .eq("tenant_id", user.tenantId)
        .eq("brand_id", tab);
      const groupIds = (groups ?? []).map((g) => g.id);
      if (!groupIds.length) return jsonOk({ birthdays: [], days });

      const { data: enrollments } = await db
        .from("enrollments")
        .select("student_person_id, group_id")
        .in("group_id", groupIds)
        .eq("status", "active");
      const studentIds = [
        ...new Set((enrollments ?? []).map((e) => e.student_person_id)),
      ];
      if (!studentIds.length) return jsonOk({ birthdays: [], days });

      const { data: persons } = await db
        .from("persons")
        .select("id, full_name, birth_date")
        .in("id", studentIds)
        .not("birth_date", "is", null);

      const groupMap = new Map((groups ?? []).map((g) => [g.id, g.title]));
      const groupByStudent = new Map<string, string>();
      for (const e of enrollments ?? []) {
        if (!groupByStudent.has(e.student_person_id)) {
          groupByStudent.set(
            e.student_person_id,
            groupMap.get(e.group_id) ?? "",
          );
        }
      }

      const birthdays = upcomingBirthdays(
        (persons ?? [])
          .filter((p) => p.birth_date)
          .map((p) => ({
            id: p.id,
            full_name: p.full_name,
            birth_date: p.birth_date as string,
            group_title: groupByStudent.get(p.id) ?? null,
          })),
        days,
      );
      return jsonOk({ birthdays, days });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 500);
    }
  }

  const state = getDemoState();
  const groupIds = new Set(
    state.groups.filter((g) => g.brand_id === tab).map((g) => g.id),
  );
  const people = state.enrollments
    .filter((e) => e.status === "active" && groupIds.has(e.group_id))
    .map((e) => {
      const person = state.persons.find((p) => p.id === e.student_person_id);
      const group = state.groups.find((g) => g.id === e.group_id);
      if (!person?.birth_date) return null;
      return {
        id: person.id,
        full_name: person.full_name,
        birth_date: person.birth_date,
        group_title: group?.title ?? null,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    full_name: string;
    birth_date: string;
    group_title: string | null;
  }>;
  // dedupe
  const seen = new Set<string>();
  const unique = people.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  return jsonOk({ birthdays: upcomingBirthdays(unique, days), days });
}
