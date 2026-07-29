import { cookies } from "next/headers";
import { getDemoState, DEMO_TENANT_ID } from "@/lib/demo-store";
import { hasSupabase } from "@/lib/env";

export type SessionUser = {
  personId: string;
  tenantId: string;
  fullName: string;
  email: string;
  roles: string[];
  mode: "demo" | "supabase";
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const personId = jar.get("studio_person_id")?.value;
  if (!personId) return null;

  if (!hasSupabase()) {
    const person = getDemoState().persons.find((p) => p.id === personId);
    if (!person) return null;
    return {
      personId: person.id,
      tenantId: DEMO_TENANT_ID,
      fullName: person.full_name,
      email: person.email,
      roles: person.roles,
      mode: "demo",
    };
  }

  // Supabase path: resolve person by id (service role)
  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const { data: person } = await db
    .from("persons")
    .select("id, tenant_id, full_name, email")
    .eq("id", personId)
    .maybeSingle();
  if (!person) return null;

  const { data: roles } = await db
    .from("person_roles")
    .select("role")
    .eq("person_id", personId)
    .is("revoked_at", null);

  return {
    personId: person.id,
    tenantId: person.tenant_id,
    fullName: person.full_name,
    email: person.email,
    roles: (roles ?? []).map((r) => r.role),
    mode: "supabase",
  };
}

export function isStaff(roles: string[]) {
  return roles.some((r) => ["admin", "owner", "teacher", "accounting"].includes(r));
}

export function isAdmin(roles: string[]) {
  return roles.some((r) => ["admin", "owner", "accounting"].includes(r));
}

export function isTeacherOnly(roles: string[]) {
  return roles.includes("teacher") && !isAdmin(roles);
}
