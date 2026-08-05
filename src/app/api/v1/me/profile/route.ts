import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import {
  getPersonProfileDb,
  updatePersonProfileDb,
} from "@/lib/supabase-onboarding";
import { getDemoState } from "@/lib/demo-store";
import { getChildrenForParent } from "@/lib/demo-ops";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  if (hasSupabase() && user.mode === "supabase") {
    try {
      return jsonOk(await getPersonProfileDb(user.personId));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }

  const person = getDemoState().persons.find((p) => p.id === user.personId);
  if (!person) return jsonError("Not found", 404);
  const children = getChildrenForParent(user.personId);
  const scopeIds = [user.personId, ...children.map((child) => child.id)];
  const groups = getDemoState().groups.filter((group) =>
    getDemoState().enrollments.some(
      (enrollment) =>
        enrollment.group_id === group.id &&
        enrollment.status === "active" &&
        scopeIds.includes(enrollment.student_person_id),
    ),
  );
  return jsonOk({
    person: {
      ...person,
      roles: person.roles,
      telegram_linked: Boolean(person.telegram_linked),
      telegram_username: null,
    },
    children,
    parents: [],
    groups,
    packages: [],
    schedule: [],
  });
}

const patchSchema = z.object({
  full_name: z.string().min(2).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  birth_date: z.string().optional().nullable(),
  tshirt_size: z.string().optional().nullable(),
  telegram_username: z.string().optional().nullable(),
  invoice_street: z.string().optional().nullable(),
  invoice_post_code: z.string().optional().nullable(),
  invoice_city: z.string().optional().nullable(),
  invoice_country: z.string().optional().nullable(),
  invoice_nip: z.string().optional().nullable(),
  invoice_company_name: z.string().optional().nullable(),
});

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  if (hasSupabase() && user.mode === "supabase") {
    try {
      return jsonOk(await updatePersonProfileDb(user.personId, parsed.data));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 400);
    }
  }
  return jsonError("Demo profile update limited", 501);
}
