import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { tenantIdOrDefault } from "@/lib/supabase-data";
import { invitePersonDb } from "@/lib/supabase-onboarding";
import { getEnv } from "@/lib/env";
import type { BrandId } from "@/lib/brands";

function isRealEmail(email?: string | null) {
  if (!email) return false;
  const e = email.toLowerCase();
  return !e.endsWith("@cabinet.local") && !e.endsWith("@kids.local");
}

export async function listJoinGroupsDb(brandId?: BrandId) {
  const db = getAdminClient();
  const tenantId = tenantIdOrDefault(getEnv().DEFAULT_TENANT_ID);
  let q = db
    .from("groups")
    .select("id, title, direction, brand_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("title");
  if (brandId) q = q.eq("brand_id", brandId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Students in a group missing real email (or all if includeAll). */
export async function listJoinCandidatesDb(input: {
  groupId: string;
  includeAll?: boolean;
}) {
  const db = getAdminClient();
  const { data: enrollments, error } = await db
    .from("enrollments")
    .select("student_person_id")
    .eq("group_id", input.groupId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  const ids = [...new Set((enrollments ?? []).map((e) => e.student_person_id))];
  if (!ids.length) return [];

  const { data: persons, error: pErr } = await db
    .from("persons")
    .select("id, full_name, email, phone, telegram_username, birth_date, is_minor, status")
    .in("id", ids)
    .in("status", ["active", "completed"])
    .order("full_name");
  if (pErr) throw new Error(pErr.message);

  const rows = (persons ?? [])
    // Public join only for profiles without a real email yet.
    .filter((p) => input.includeAll || !isRealEmail(p.email as string | null))
    // Claimable only when birth month-day is on file (required verifier).
    .filter((p) => Boolean(p.birth_date) || input.includeAll)
    .map((p) => ({
      id: p.id as string,
      full_name: p.full_name as string,
      has_email: isRealEmail(p.email as string | null),
      has_phone: Boolean(p.phone),
      has_telegram: Boolean(p.telegram_username),
      // only month-day for soft verify, not full year privacy
      birth_md: p.birth_date
        ? String(p.birth_date).slice(5, 10)
        : null,
      requires_birth: Boolean(p.birth_date),
      is_minor: Boolean(p.is_minor),
    }));

  return rows;
}

const claimSchema = z.object({
  personId: z.string().uuid(),
  email: z.string().email(),
  phone: z.string().min(5).max(40).optional().nullable(),
  telegram_username: z.string().max(64).optional().nullable(),
  /** Optional: YYYY-MM-DD or MM-DD — if person has birth_date, must match month-day */
  birth_date: z.string().optional().nullable(),
});

export async function claimJoinContactDb(raw: unknown) {
  const parsed = claimSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Проверь email и поля формы");

  const db = getAdminClient();
  const { data: person, error } = await db
    .from("persons")
    .select("id, full_name, email, birth_date, tenant_id, is_minor, status")
    .eq("id", parsed.data.personId)
    .in("status", ["active", "completed"])
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!person) throw new Error("Ученик не найден");

  if (isRealEmail(person.email as string | null)) {
    throw new Error("У этого профиля уже есть email — войди через /login");
  }

  // Birth month-day is mandatory anti-takeover check.
  if (!person.birth_date) {
    throw new Error(
      "Для этого профиля нет даты рождения в базе — напиши студии, сами привяжем контакты",
    );
  }
  if (!parsed.data.birth_date?.trim()) {
    throw new Error("Укажи дату рождения (день и месяц) для подтверждения");
  }
  const have = String(person.birth_date).slice(5, 10);
  const got = parsed.data.birth_date.includes("-")
    ? parsed.data.birth_date.slice(-5)
    : parsed.data.birth_date;
  if (have !== got) {
    throw new Error("Дата рождения не совпала — выбери себя ещё раз или напиши студии");
  }

  const email = parsed.data.email.trim().toLowerCase();
  // Don't steal email already used by another person
  const { data: clash } = await db
    .from("persons")
    .select("id, full_name")
    .eq("email", email)
    .neq("id", person.id)
    .maybeSingle();
  if (clash) {
    throw new Error("Этот email уже привязан к другому профилю. Войди через /login");
  }

  const tg = parsed.data.telegram_username
    ? parsed.data.telegram_username.trim().replace(/^@+/, "") || null
    : null;

  const patch: Record<string, unknown> = {
    email,
    phone: parsed.data.phone?.trim() || null,
    telegram_username: tg,
  };
  if (!person.is_minor) {
    patch.onboarding_status = "invited";
    patch.invited_at = new Date().toISOString();
  }

  const { error: upErr } = await db.from("persons").update(patch).eq("id", person.id);
  if (upErr) throw new Error(upErr.message);

  const invite = await invitePersonDb(person.id, { email });
  // Never return magicUrl to the browser — only email (or ask studio if email failed).
  return {
    person: { id: person.id, full_name: person.full_name, email },
    emailed: invite.emailed,
    message: invite.emailed
      ? "Готово — ссылка входа отправлена на email."
      : "Контакты сохранены, но письмо не ушло. Напиши студии — пришлём ссылку вручную.",
  };
}

export async function adminMissingContactsDb(tenantId: string, brandId?: BrandId) {
  const db = getAdminClient();
  let gq = db
    .from("groups")
    .select("id, title, brand_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  if (brandId) gq = gq.eq("brand_id", brandId);
  const { data: groups } = await gq;
  const groupIds = (groups ?? []).map((g) => g.id);
  if (!groupIds.length) return { missing: [], total: 0 };

  const { data: enrollments } = await db
    .from("enrollments")
    .select("student_person_id, group_id")
    .in("group_id", groupIds)
    .eq("status", "active");

  const studentIds = [...new Set((enrollments ?? []).map((e) => e.student_person_id))];
  if (!studentIds.length) return { missing: [], total: 0 };

  const { data: persons } = await db
    .from("persons")
    .select("id, full_name, email, phone, telegram_username")
    .in("id", studentIds)
    .eq("status", "active");

  const groupTitle = new Map((groups ?? []).map((g) => [g.id, g.title]));
  const groupsByStudent = new Map<string, string[]>();
  for (const e of enrollments ?? []) {
    const list = groupsByStudent.get(e.student_person_id) ?? [];
    const t = groupTitle.get(e.group_id);
    if (t && !list.includes(t)) list.push(t);
    groupsByStudent.set(e.student_person_id, list);
  }

  const missing = (persons ?? [])
    .filter((p) => !isRealEmail(p.email as string | null))
    .map((p) => ({
      id: p.id as string,
      full_name: p.full_name as string,
      phone: p.phone as string | null,
      telegram_username: p.telegram_username as string | null,
      groups: groupsByStudent.get(p.id as string) ?? [],
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));

  return { missing, total: studentIds.length };
}
