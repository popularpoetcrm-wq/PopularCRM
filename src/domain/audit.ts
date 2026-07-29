import type { SupabaseClient } from "@supabase/supabase-js";

export async function writeAudit(
  db: SupabaseClient,
  params: {
    tenantId: string;
    actorPersonId?: string | null;
    actorRole?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    requestId?: string | null;
  },
) {
  const { error } = await db.from("audit_log").insert({
    tenant_id: params.tenantId,
    actor_person_id: params.actorPersonId ?? null,
    actor_role: params.actorRole ?? null,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
    reason: params.reason ?? null,
    request_id: params.requestId ?? null,
  });
  if (error) throw error;
}
