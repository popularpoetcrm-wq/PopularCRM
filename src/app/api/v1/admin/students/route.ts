import { z } from "zod";
import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin, isStaff } from "@/lib/auth";
import {
  createChildWithParent,
  createStudent,
  getExtendedDemo,
  getStudentCard,
  remindAllDebtors,
} from "@/lib/demo-ops";
import {
  importStudentsCsv,
  inviteMany,
  invitePerson,
  listStudentsWithOnboarding,
} from "@/lib/demo-onboarding";
import type { BrandId } from "@/lib/brands";

function brandTab() {
  return cookies().then(
    (jar) => (jar.get("admin_brand_tab")?.value as BrandId) || "poet",
  );
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const tab = await brandTab();
  const state = getExtendedDemo();
  const students = listStudentsWithOnboarding(tab);
  return jsonOk({
    students,
    enrollments: state.enrollments.filter((e) => e.brand_id === tab),
    contacts: state.contacts,
    groups: state.groups.filter((g) => g.brand_id === tab),
  });
}

const createSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  tshirt_size: z.string().optional(),
  birth_date: z.string().optional(),
  group_id: z.string().optional(),
  invite: z.boolean().optional(),
});

const childSchema = z.object({
  mode: z.literal("child_parent"),
  child_full_name: z.string().min(2),
  child_birth_date: z.string().optional(),
  parent_full_name: z.string().min(2),
  parent_email: z.string().email(),
  parent_phone: z.string().optional(),
  group_id: z.string().optional(),
  credits_left: z.number().optional(),
  invite: z.boolean().optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const body = await req.json();
  const brandId = await brandTab();

  const childParsed = childSchema.safeParse(body);
  if (childParsed.success) {
    const result = createChildWithParent({
      ...childParsed.data,
      brand_id: brandId,
      actor: user.fullName,
    });
    let invite = null;
    if (childParsed.data.invite) {
      invite = invitePerson(result.parent.id, { actor: user.fullName });
    }
    return jsonOk({ ...result, invite });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid payload");
  const result = createStudent({
    ...parsed.data,
    brand_id: brandId,
    actor: user.fullName,
  });
  let invite = null;
  if (parsed.data.invite) {
    invite = invitePerson(result.person.id, { actor: user.fullName });
  }
  return jsonOk({ ...result, invite });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const body = await req.json();

  if (body?.action === "invite") {
    const parsed = z.object({ personIds: z.array(z.string()).min(1) }).safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");
    return jsonOk({ results: inviteMany(parsed.data.personIds, user.fullName) });
  }

  if (body?.action === "import") {
    if (!isAdmin(user.roles)) return jsonError("Forbidden", 403);
    const csv = z.string().min(1).safeParse(body.csv);
    if (!csv.success) return jsonError("csv required");
    const brandId = await brandTab();
    return jsonOk({ results: importStudentsCsv(csv.data, brandId, user.fullName) });
  }

  return jsonError("Unknown action");
}
