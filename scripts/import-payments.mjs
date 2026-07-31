#!/usr/bin/env node
/**
 * Import phase-3 payments + patch group.direction.
 * Preview: node scripts/import-payments.mjs
 * Apply:   node scripts/import-payments.mjs --apply
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

function directionFromTitle(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("идея")) return "kids";
  if (t.includes("импро")) return "impro";
  if (t.includes("актёр") || t.includes("актер")) return "acting";
  if (t.includes("воскрес") || t.includes("школ")) return "impro";
  if (t.includes("спектакл")) return "show";
  if (t.includes("play")) return "playback";
  return "other";
}

const env = loadEnv(resolve(root, ".env.local"));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const payload = JSON.parse(
  readFileSync(resolve(__dir, "data/real-tables-phase3-payments.json"), "utf8"),
);
const APPLY = process.argv.includes("--apply");

async function upsertChunk(table, rows, onConflict, label) {
  const size = 80;
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

async function loadPaymentDependencies(table, paymentIds) {
  const rows = [];
  for (let i = 0; i < paymentIds.length; i += 80) {
    const { data, error } = await db
      .from(table)
      .select("payment_id")
      .in("payment_id", paymentIds.slice(i, i + 80));
    if (error) {
      throw new Error(`Cannot inspect ${table}: ${error.message}`);
    }
    rows.push(...(data ?? []));
  }
  return rows;
}

async function main() {
  console.log("Phase 3 totals", payload.totals);

  // Verify enrollments exist; skip orphans
  const enrollIds = [...new Set(payload.payments.map((p) => p.enrollment_id))];
  const existing = new Set();
  for (let i = 0; i < enrollIds.length; i += 100) {
    const chunk = enrollIds.slice(i, i + 100);
    const { data, error } = await db
      .from("enrollments")
      .select("id")
      .in("id", chunk);
    if (error) {
      throw new Error(`Cannot verify enrollments: ${error.message}`);
    }
    for (const r of data ?? []) existing.add(r.id);
  }

  const usable = payload.payments.filter((p) => existing.has(p.enrollment_id));
  const skipped = payload.payments.length - usable.length;
  console.log("enrollments matched", usable.length, "skipped", skipped);
  if (APPLY && skipped > 0) {
    throw new Error(
      `Apply refused: ${skipped} payment events have no matching enrollment`,
    );
  }

  // brand_id from enrollment → group
  const brandByEnrollment = new Map();
  const usableEnrollmentIds = [
    ...new Set(usable.map((p) => p.enrollment_id)),
  ];
  for (let i = 0; i < usableEnrollmentIds.length; i += 100) {
    const chunk = usableEnrollmentIds.slice(i, i + 100);
    const { data: enrs, error } = await db
      .from("enrollments")
      .select("id, brand_id, group_id, groups(brand_id)")
      .in("id", chunk);
    if (error) {
      throw new Error(`Cannot load enrollment brands: ${error.message}`);
    }
    for (const e of enrs ?? []) {
      const gBrand = Array.isArray(e.groups)
        ? e.groups[0]?.brand_id
        : e.groups?.brand_id;
      brandByEnrollment.set(e.id, e.brand_id || gBrand || "poet");
    }
  }

  const rows = usable.map((p) => ({
    id: p.id,
    tenant_id: p.tenant_id,
    brand_id: brandByEnrollment.get(p.enrollment_id) || "poet",
    product_kind: "package",
    provider: p.provider,
    provider_session_id: p.provider_session_id,
    payer_person_id: p.payer_person_id,
    enrollment_id: p.enrollment_id,
    amount: p.amount,
    amount_paid: p.amount_paid,
    currency: p.currency,
    status: p.status,
    payment_method: p.payment_method,
    description: p.description,
    due_at: p.due_at ?? null,
    paid_at: p.paid_at ?? null,
  }));

  // Imported aggregate payments can already be referenced by an invoice,
  // package, or provider event. Preserve those rows and omit their equivalent
  // split-cycle replacements so revenue is neither broken nor duplicated.
  const { data: currentImports, error: currentImportsError } = await db
    .from("payments")
    .select(
      "id, enrollment_id, amount, amount_paid, status, provider_session_id",
    )
    .like("provider_session_id", "import:%");
  if (currentImportsError) {
    throw new Error(
      `Cannot inspect current imported payments: ${currentImportsError.message}`,
    );
  }
  const currentImportIds = (currentImports ?? []).map((row) => row.id);
  const dependencyTables = ["student_packages", "payment_events", "invoices"];
  const dependencies = {};
  for (const table of dependencyTables) {
    dependencies[table] = await loadPaymentDependencies(table, currentImportIds);
  }
  const protectedPaymentIds = new Set(
    dependencyTables.flatMap((table) =>
      dependencies[table].map((row) => row.payment_id),
    ),
  );
  const protectedImports = (currentImports ?? []).filter((row) =>
    protectedPaymentIds.has(row.id),
  );
  const protectedEnrollmentIds = new Set(
    protectedImports.map((row) => row.enrollment_id).filter(Boolean),
  );
  const protectedMismatches = protectedImports.filter((payment) => {
    if (!payment.enrollment_id) return true;
    const replacements = rows.filter(
      (row) => row.enrollment_id === payment.enrollment_id,
    );
    const replacementAmount = replacements.reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    );
    const replacementPaid = replacements.reduce(
      (sum, row) => sum + Number(row.amount_paid),
      0,
    );
    return (
      replacements.length === 0 ||
      Math.abs(replacementAmount - Number(payment.amount)) > 0.01 ||
      Math.abs(replacementPaid - Number(payment.amount_paid)) > 0.01
    );
  });
  const rowsToWrite = rows.filter(
    (row) => !protectedEnrollmentIds.has(row.enrollment_id),
  );
  const deletableImportIds = (currentImports ?? [])
    .filter((row) => !protectedPaymentIds.has(row.id))
    .map((row) => row.id);

  if (!APPLY) {
    const paidRows = rows.filter((row) => row.status === "paid");
    const pendingRows = rows.filter((row) => row.status === "pending");
    const paidAmount = paidRows.reduce(
      (sum, row) => sum + Number(row.amount_paid),
      0,
    );
    const openAmount = rows.reduce(
      (sum, row) => sum + Number(row.amount) - Number(row.amount_paid),
      0,
    );
    console.log({
      mode: "preview",
      importedPaymentsToReplace: rows.length,
      paidPayments: paidRows.length,
      paidAmount,
      pendingPayments: pendingRows.length,
      openAmount,
      currentImportedPayments: currentImports?.length ?? 0,
      currentImportsToDelete: deletableImportIds.length,
      newPaymentRowsToWrite: rowsToWrite.length,
      legacyPaymentRowsPreserved: protectedImports.length,
      paymentRowsAfterApply: rowsToWrite.length + protectedImports.length,
      protectedPaymentMismatches: protectedMismatches.length,
      currentPackageBalances: payload.current_packages_preview?.length ?? 0,
      packageBalancesNeedingReview:
        payload.current_packages_preview?.filter((row) => row.needs_review)
          .length ?? 0,
      message: "No database writes. Re-run with --apply after review.",
    });
    return;
  }

  if (protectedMismatches.length > 0) {
    throw new Error(
      `Apply refused: ${protectedMismatches.length} protected legacy payments do not match their replacement cycles`,
    );
  }

  // Delete only resolved, unreferenced legacy import rows. Referenced rows are
  // preserved above together with their equivalent enrollment cycles.
  for (let i = 0; i < deletableImportIds.length; i += 80) {
    const chunk = deletableImportIds.slice(i, i + 80);
    const { error: delErr } = await db.from("payments").delete().in("id", chunk);
    if (delErr) {
      throw new Error(`Cannot clear previous import payments: ${delErr.message}`);
    }
  }
  console.log("OK cleared previous import payments", deletableImportIds.length);
  console.log("OK preserved referenced import payments", protectedImports.length);

  const ok = await upsertChunk("payments", rowsToWrite, "id", "payments");
  if (!ok) process.exit(1);

  // Patch group directions from titles
  const { data: groups, error: groupsError } = await db
    .from("groups")
    .select("id, title, direction")
    .eq("tenant_id", payload.tenant_id);
  if (groupsError) {
    throw new Error(`Cannot load groups: ${groupsError.message}`);
  }
  let patched = 0;
  for (const g of groups ?? []) {
    const dir = directionFromTitle(g.title);
    if (g.direction === dir) continue;
    const { error } = await db.from("groups").update({ direction: dir }).eq("id", g.id);
    if (!error) patched++;
  }
  console.log("OK group.direction patched", patched);

  const { data: sumRows, error: sumError } = await db
    .from("payments")
    .select("amount, amount_paid, status")
    .eq("tenant_id", payload.tenant_id)
    .like("provider_session_id", "import:%");
  if (sumError) {
    throw new Error(`Cannot verify imported payments: ${sumError.message}`);
  }
  const revenue = (sumRows ?? [])
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + Number(p.amount_paid || 0), 0);
  const debt = (sumRows ?? [])
    .filter((p) => ["pending", "partial"].includes(p.status))
    .reduce((s, p) => s + (Number(p.amount || 0) - Number(p.amount_paid || 0)), 0);
  const expectedRows = rowsToWrite.length + protectedImports.length;
  const expectedRevenue = rows.reduce(
    (sum, row) => sum + Number(row.amount_paid || 0),
    0,
  );
  if (
    (sumRows?.length ?? 0) !== expectedRows ||
    Math.abs(revenue - expectedRevenue) > 0.01 ||
    debt !== 0
  ) {
    throw new Error(
      `Import verification failed: expected ${expectedRows} rows / ${expectedRevenue} paid, got ${sumRows?.length ?? 0} rows / ${revenue} paid / ${debt} debt`,
    );
  }
  console.log({ imported: sumRows?.length ?? 0, revenue, debt });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
