import { cookies } from "next/headers";
import { getDemoState, DEMO_TENANT_ID } from "@/lib/demo-store";
import { hasSupabase } from "@/lib/env";
import { readSessionFromCookies } from "@/lib/session";

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
  // Only signed studio_session is accepted. Bare studio_person_id is ignored
  // (forgeable UUID cookie — security fix).
  const session = readSessionFromCookies(jar);
  if (!session) return null;
  const personId = session.personId;

  if (!hasSupabase()) {
    const person = getDemoState().persons.find((p) => p.id === personId);
    if (!person) return null;
    if (session.tenantId !== DEMO_TENANT_ID) return null;
    return {
      personId: person.id,
      tenantId: DEMO_TENANT_ID,
      fullName: person.full_name,
      email: person.email,
      roles: person.roles,
      mode: "demo",
    };
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const { data: person } = await db
    .from("persons")
    .select("id, tenant_id, full_name, email")
    .eq("id", personId)
    .eq("tenant_id", session.tenantId)
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
