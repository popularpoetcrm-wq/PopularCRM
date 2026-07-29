import { getAdminClient } from "@/lib/supabase/admin";
import {
  LEGAL_DOCS,
  REQUIRED_CONSENT_KEYS,
  listLegalDocs,
  type LegalDocKey,
} from "@/lib/legal";

export async function listPersonConsentsDb(personId: string) {
  const db = getAdminClient();
  const { data, error } = await db
    .from("person_consents")
    .select("doc_key, doc_version, accepted_at, accepted_by_person_id")
    .eq("person_id", personId)
    .order("accepted_at", { ascending: false });
  if (error) {
    if (/person_consents|schema cache|does not exist/i.test(error.message)) {
      throw new Error(
        "Нужна миграция 007_avatar_consents.sql в Supabase SQL Editor",
      );
    }
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function getConsentsStatusDb(personId: string) {
  const docs = listLegalDocs();
  const accepted = await listPersonConsentsDb(personId);
  const latestByKey = new Map<string, (typeof accepted)[0]>();
  for (const row of accepted) {
    if (!latestByKey.has(row.doc_key)) latestByKey.set(row.doc_key, row);
  }
  return docs.map((doc) => {
    const row = latestByKey.get(doc.key);
    const current =
      row?.doc_version === doc.version
        ? {
            accepted: true as const,
            accepted_at: row.accepted_at as string,
            doc_version: row.doc_version as string,
          }
        : { accepted: false as const, accepted_at: null, doc_version: null };
    return {
      key: doc.key,
      title: doc.title,
      version: doc.version,
      body: doc.body,
      ...current,
      needs_accept: !current.accepted,
    };
  });
}

export async function hasRequiredConsentsDb(personId: string) {
  const status = await getConsentsStatusDb(personId);
  return status.every((s) => s.accepted);
}

export async function acceptConsentsDb(input: {
  personId: string;
  tenantId: string;
  keys: LegalDocKey[];
  acceptedByPersonId?: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const db = getAdminClient();
  const acceptedBy = input.acceptedByPersonId ?? input.personId;
  const now = new Date().toISOString();
  const rows = input.keys.map((key) => ({
    tenant_id: input.tenantId,
    person_id: input.personId,
    doc_key: key,
    doc_version: LEGAL_DOCS[key].version,
    accepted_at: now,
    accepted_by_person_id: acceptedBy,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
  }));

  const { error } = await db.from("person_consents").upsert(rows, {
    onConflict: "person_id,doc_key,doc_version",
  });
  if (error) throw new Error(error.message);

  if (input.keys.includes("studio_offer")) {
    await db
      .from("persons")
      .update({ accepted_rules_at: now })
      .eq("id", input.personId);
  }

  return getConsentsStatusDb(input.personId);
}

export async function acceptRequiredConsentsForOnboardingDb(input: {
  personId: string;
  tenantId: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return acceptConsentsDb({
    ...input,
    keys: [...REQUIRED_CONSENT_KEYS],
    acceptedByPersonId: input.personId,
  });
}
