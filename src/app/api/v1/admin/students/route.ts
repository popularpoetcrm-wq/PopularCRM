import { z } from "zod";
import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin, isStaff } from "@/lib/auth";
import {
  createChildWithParent,
  createStudent,
  getExtendedDemo,
} from "@/lib/demo-ops";
import {
  importStudentsCsv,
  inviteMany,
  invitePerson,
  listStudentsWithOnboarding,
} from "@/lib/demo-onboarding";
import { hasSupabase } from "@/lib/env";
import { listStudentsDb } from "@/lib/supabase-data";
import type { BrandId } from "@/lib/brands";
import { getAdminClient } from "@/lib/supabase/admin";

function brandTab() {
  return cookies().then(
    (jar) => (jar.get("admin_brand_tab")?.value as BrandId) || "poet",
  );
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  const tab = await brandTab();

  if (hasSupabase() && user.mode === "supabase") {
    try {
      return jsonOk(await listStudentsDb(user.tenantId, tab));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 500);
    }
  }

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

  if (hasSupabase() && user.mode === "supabase") {
    const db = getAdminClient();
    const childParsed = childSchema.safeParse(body);
    if (childParsed.success) {
      const d = childParsed.data;
      let parent = (
        await db
          .from("persons")
          .select("*")
          .eq("tenant_id", user.tenantId)
          .eq("email", d.parent_email.toLowerCase())
          .maybeSingle()
      ).data;
      if (!parent) {
        const created = await db
          .from("persons")
          .insert({
            tenant_id: user.tenantId,
            full_name: d.parent_full_name,
            email: d.parent_email.toLowerCase(),
            phone: d.parent_phone,
            status: "completed",
            onboarding_status: "draft",
          })
          .select("*")
          .single();
        if (created.error) return jsonError(created.error.message, 400);
        parent = created.data;
        await db.from("person_roles").insert([
          { tenant_id: user.tenantId, person_id: parent.id, role: "parent" },
          { tenant_id: user.tenantId, person_id: parent.id, role: "payer" },
        ]);
      }

      const childCreated = await db
        .from("persons")
        .insert({
          tenant_id: user.tenantId,
          full_name: d.child_full_name,
          email: `child+${Date.now()}@kids.local`,
          birth_date: d.child_birth_date || null,
          is_minor: true,
          status: "completed",
          onboarding_status: "complete",
        })
        .select("*")
        .single();
      if (childCreated.error) return jsonError(childCreated.error.message, 400);
      const child = childCreated.data;
      await db.from("person_roles").insert({
        tenant_id: user.tenantId,
        person_id: child.id,
        role: "student",
      });
      await db.from("student_contacts").insert({
        tenant_id: user.tenantId,
        student_person_id: child.id,
        contact_person_id: parent.id,
        relation_type: "parent",
        is_primary: true,
        can_pay: true,
      });
      let enrollmentId: string | undefined;
      if (d.group_id) {
        const enr = await db
          .from("enrollments")
          .insert({
            tenant_id: user.tenantId,
            student_person_id: child.id,
            group_id: d.group_id,
            brand_id: brandId,
            status: "active",
          })
          .select("id")
          .single();
        enrollmentId = enr.data?.id;
        try {
          const { sendTelegramGroupInviteForPersonDb } = await import(
            "@/lib/group-telegram"
          );
          await sendTelegramGroupInviteForPersonDb(child.id, {
            groupId: d.group_id,
          });
        } catch (e) {
          console.error("[students] tg invite child", e);
        }
      }
      let invite = null;
      if (d.invite !== false) {
        const { invitePersonDb } = await import("@/lib/supabase-onboarding");
        invite = await invitePersonDb(parent.id, { actorId: user.personId });
      }
      return jsonOk({ child, parent, enrollmentId, invite });
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");
    const created = await db
      .from("persons")
      .insert({
        tenant_id: user.tenantId,
        full_name: parsed.data.full_name,
        email: parsed.data.email.toLowerCase(),
        phone: parsed.data.phone,
        tshirt_size: parsed.data.tshirt_size,
        birth_date: parsed.data.birth_date || null,
        status: "completed",
        onboarding_status: "draft",
      })
      .select("*")
      .single();
    if (created.error) return jsonError(created.error.message, 400);
    const person = created.data;
    await db.from("person_roles").insert({
      tenant_id: user.tenantId,
      person_id: person.id,
      role: "student",
    });
    let enrollmentId: string | undefined;
    if (parsed.data.group_id) {
      const enr = await db
        .from("enrollments")
        .insert({
          tenant_id: user.tenantId,
          student_person_id: person.id,
          group_id: parsed.data.group_id,
          brand_id: brandId,
          status: "active",
        })
        .select("id")
        .single();
      enrollmentId = enr.data?.id;
      try {
        const { sendTelegramGroupInviteForPersonDb } = await import(
          "@/lib/group-telegram"
        );
        await sendTelegramGroupInviteForPersonDb(person.id, {
          groupId: parsed.data.group_id,
        });
      } catch (e) {
        console.error("[students] tg invite adult", e);
      }
    }
    let invite = null;
    if (parsed.data.invite !== false) {
      const { invitePersonDb } = await import("@/lib/supabase-onboarding");
      invite = await invitePersonDb(person.id, { actorId: user.personId });
    }
    return jsonOk({ person, enrollmentId, invite });
  }

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

  if (hasSupabase() && user.mode === "supabase") {
    if (body?.action === "invite") {
      const parsed = z.object({ personIds: z.array(z.string()).min(1) }).safeParse(body);
      if (!parsed.success) return jsonError("Invalid payload");
      const { inviteManyDb } = await import("@/lib/supabase-onboarding");
      return jsonOk({ results: await inviteManyDb(parsed.data.personIds, user.personId) });
    }
    return jsonError("CSV import в Supabase — следующим шагом", 501);
  }

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
