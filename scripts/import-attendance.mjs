#!/usr/bin/env node
/**
 * Import phase-2 sessions + attendance into Supabase.
 * Usage: node scripts/import-attendance.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = loadEnv(resolve(root, ".env.local"));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const payload = JSON.parse(
  readFileSync(resolve(__dir, "data/real-tables-phase2-attendance.json"), "utf8"),
);

async function upsertChunk(table, rows, onConflict, label) {
  const size = 100;
  let ok = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) {
      console.error("FAIL", label, i, error.message);
      return false;
    }
    ok += chunk.length;
    if (ok % 500 === 0 || ok === rows.length) {
      console.log("…", label, ok, "/", rows.length);
    }
  }
  console.log("OK", label, rows.length);
  return true;
}

async function main() {
  console.log("Phase 2 totals", payload.totals);

  const sessionRows = payload.sessions.map((s) => ({
    id: s.id,
    tenant_id: s.tenant_id,
    group_id: s.group_id,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    status: s.status,
    notes: s.source_sheet ? `import:${s.source_sheet}` : null,
  }));

  // sessions may conflict on (group_id, starts_at) if id differs — upsert by id first
  const okS = await upsertChunk("sessions", sessionRows, "id", "sessions");
  if (!okS) process.exit(1);

  const attRows = payload.attendance.map((a) => ({
    id: a.id,
    tenant_id: a.tenant_id,
    session_id: a.session_id,
    enrollment_id: a.enrollment_id,
    student_person_id: a.student_person_id,
    attendance_type: a.attendance_type,
    status: a.status,
    comment: a.comment ?? null,
  }));

  const okA = await upsertChunk(
    "attendance",
    attRows,
    "id",
    "attendance",
  );
  if (!okA) process.exit(1);

  const { count: sc } = await db
    .from("sessions")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", payload.tenant_id);
  const { count: ac } = await db
    .from("attendance")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", payload.tenant_id);
  console.log("DB counts sessions", sc, "attendance", ac);

  // sample: Воскресная школа recent
  const { data: sample } = await db
    .from("attendance")
    .select("status, comment, persons!attendance_student_person_id_fkey(full_name)")
    .eq("tenant_id", payload.tenant_id)
    .order("marked_at", { ascending: false })
    .limit(5);
  console.log("sample", sample);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
