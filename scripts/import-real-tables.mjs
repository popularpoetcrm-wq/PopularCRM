#!/usr/bin/env node
/**
 * Import phase-1 real tables JSON into Supabase.
 * Usage: node scripts/import-real-tables.mjs
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
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
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase URL / SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const payload = JSON.parse(
  readFileSync(resolve(__dir, "data/real-tables-phase1.json"), "utf8"),
);
const TENANT = payload.tenant_id;
const PLAN = payload.plan_id;

async function ok(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error("FAIL", label, error.message);
    return { data: null, error };
  }
  console.log("OK", label);
  return { data, error: null };
}

async function upsertChunk(table, rows, onConflict, label) {
  const size = 50;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) {
      console.error("FAIL", label, i, error.message);
      return false;
    }
  }
  console.log("OK", label, rows.length);
  return true;
}

function flattenBrand(block) {
  return block;
}

async function importBrand(block) {
  const brand = block.brand;
  console.log("\n===", brand, block.file, "===");

  const groupRows = block.groups.map((g) => ({
    id: g.id,
    tenant_id: TENANT,
    title: g.title,
    direction: g.direction,
    capacity: g.capacity ?? 12,
    default_plan_id: PLAN,
    brand_id: brand,
    status: "active",
  }));
  await upsertChunk("groups", groupRows, "id", `${brand} groups`);

  // schedule rules: delete+insert by group (no stable id)
  for (const g of block.groups) {
    const s = g.schedule || {};
    if (s.weekday == null || !s.start_time) continue;
    await db.from("group_schedule_rules").delete().eq("group_id", g.id);
    const { error } = await db.from("group_schedule_rules").insert({
      group_id: g.id,
      weekday: s.weekday,
      start_time: s.start_time,
      duration_minutes: s.duration_minutes ?? 90,
      room: null,
    });
    if (error) console.error("FAIL schedule", g.title, error.message);
  }
  console.log("OK", brand, "schedules");

  const personRows = block.persons.map((p) => ({
    id: p.id,
    tenant_id: TENANT,
    full_name: p.full_name,
    email: null,
    birth_date: p.birth_date,
    tshirt_size: p.tshirt_size,
    is_minor: Boolean(p.is_minor),
    status: "completed",
    onboarding_status: "draft",
  }));
  await upsertChunk("persons", personRows, "id", `${brand} persons`);

  // roles: student (+ payer for adults)
  const roleRows = [];
  for (const p of block.persons) {
    roleRows.push({
      tenant_id: TENANT,
      person_id: p.id,
      role: "student",
    });
    if (!p.is_minor) {
      roleRows.push({
        tenant_id: TENANT,
        person_id: p.id,
        role: "payer",
      });
    }
  }
  // insert roles ignoring duplicates via select-first
  let rolesOk = 0;
  for (const r of roleRows) {
    const { data: existing } = await db
      .from("person_roles")
      .select("id")
      .eq("person_id", r.person_id)
      .eq("role", r.role)
      .is("revoked_at", null)
      .maybeSingle();
    if (existing) {
      rolesOk++;
      continue;
    }
    const { error } = await db.from("person_roles").insert(r);
    if (!error) rolesOk++;
    else if (!error.message?.includes("duplicate")) {
      console.error("FAIL role", r.person_id, r.role, error.message);
    } else rolesOk++;
  }
  console.log("OK", brand, "roles", rolesOk);

  const enrollMap = new Map();
  for (const e of block.enrollments) {
    enrollMap.set(e.id, e);
  }
  const enrollRows = [...enrollMap.values()].map((e) => ({
    id: e.id,
    tenant_id: TENANT,
    student_person_id: e.student_person_id,
    group_id: e.group_id,
    plan_id: PLAN,
    status: "active",
    brand_id: brand,
    tags: e.tags ?? [],
  }));
  await upsertChunk("enrollments", enrollRows, "id", `${brand} enrollments`);
}

async function main() {
  console.log("Phase", payload.phase, payload.note);
  console.log("Totals", payload.totals);
  await importBrand(flattenBrand(payload.poet));
  await importBrand(flattenBrand(payload.kids));

  for (const t of ["groups", "persons", "enrollments"]) {
    const { count } = await db
      .from(t)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT);
    console.log("count", t, count);
  }
  const { count: poetG } = await db
    .from("groups")
    .select("*", { count: "exact", head: true })
    .eq("brand_id", "poet")
    .eq("status", "active");
  const { count: kidsG } = await db
    .from("groups")
    .select("*", { count: "exact", head: true })
    .eq("brand_id", "kids")
    .eq("status", "active");
  console.log("active groups poet", poetG, "kids", kidsG);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
