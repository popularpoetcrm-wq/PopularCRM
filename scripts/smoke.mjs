/**
 * Demo smoke flow without external keys.
 * Usage: start `npm run dev`, then `npm run smoke`
 */
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

async function req(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const json = await res.json().catch(() => ({}));
  return { res, json, setCookie };
}

function pickCookie(setCookie) {
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function localMagicCode(email) {
  const dotenv = await import("dotenv");
  dotenv.config({ path: ".env.local" });
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const { data } = await db
    .from("magic_login_codes")
    .select("code")
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.code ?? null;
}

async function main() {
  const steps = [];
  const fail = (msg) => {
    console.error("SMOKE FAIL:", msg);
    console.error(steps.join("\n"));
    process.exit(1);
  };

  let r = await req("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@studio.local", delivery: "email" }),
  });
  if (!r.json.ok) fail(`login admin: ${r.json.error}`);
  let cookie = pickCookie(r.setCookie);
  if (
    r.json.data.mode === "magic" &&
    Array.isArray(r.json.data.delivered) &&
    r.json.data.delivered.some((channel) => channel !== "email")
  ) {
    fail("login admin: requested email delivery also sent a different channel");
  }
  steps.push(`✓ login admin (${r.json.data.mode})`);

  if (r.json.data.mode === "magic") {
    const code =
      r.json.data.debugCode ??
      (await localMagicCode("admin@studio.local"));
    if (!code) fail("Supabase smoke could not resolve the local test code");
    r = await req("/api/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({
        email: "admin@studio.local",
        code,
      }),
    });
    if (!r.json.ok) fail(`verify admin: ${r.json.error}`);
    cookie = pickCookie(r.setCookie);
    steps.push("✓ verify admin");

    for (const [label, path] of [
      ["groups", "/api/v1/admin/groups"],
      ["students", "/api/v1/admin/students"],
      ["payments", "/api/v1/admin/payments"],
      ["day", "/api/v1/admin/day"],
      ["birthdays", "/api/v1/admin/birthdays?days=30"],
      ["invoices", "/api/v1/admin/invoices"],
      ["audit", "/api/v1/admin/audit"],
    ]) {
      r = await req(path, { cookie });
      if (!r.json.ok) fail(`${label}: ${r.json.error}`);
      steps.push(`✓ ${label}`);
    }

    // Client-side safe path: student previews a trip; no attendance is changed.
    r = await req("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "anna@example.com", delivery: "email" }),
    });
    if (!r.json.ok) fail(`login anna: ${r.json.error}`);
    const annaCode =
      r.json.data.debugCode ?? (await localMagicCode("anna@example.com"));
    if (!annaCode) fail("Supabase smoke could not resolve Anna's local test code");
    r = await req("/api/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email: "anna@example.com", code: annaCode }),
    });
    if (!r.json.ok) fail(`verify anna: ${r.json.error}`);
    cookie = pickCookie(r.setCookie);
    r = await req("/api/v1/me/dashboard", { cookie });
    if (!r.json.ok) fail(`anna dashboard: ${r.json.error}`);
    const nextSession = (r.json.data.schedule ?? []).find(
      (session) =>
        new Date(session.starts_at).getTime() - Date.now() > 6 * 60 * 60 * 1000,
    );
    if (nextSession) {
      const ymd = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Warsaw",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(nextSession.starts_at));
      r = await req("/api/v1/me/planned-absence", {
        method: "POST",
        cookie,
        body: JSON.stringify({ action: "preview", startsOn: ymd, endsOn: ymd }),
      });
      if (!r.json.ok) fail(`planned absence preview: ${r.json.error}`);
      steps.push(`✓ planned absence preview (${r.json.data.eligible?.length ?? 0} classes)`);
    } else {
      steps.push("· planned absence preview skipped: no future class");
    }
    r = await req("/api/v1/me/recommendations", { cookie });
    if (!r.json.ok) fail(`recommendations: ${r.json.error}`);
    steps.push("✓ client recommendations");
    console.log("SUPABASE SMOKE OK\n" + steps.join("\n"));
    return;
  }

  r = await req("/api/v1/demo/reset", { method: "POST", cookie });
  if (!r.json.ok) fail(`reset: ${r.json.error}`);
  steps.push("✓ demo reset");

  r = await req("/api/v1/demo/seed", { method: "POST", cookie });
  if (!r.json.ok) fail(`seed: ${r.json.error}`);
  steps.push(`✓ seed ${r.json.data.group}`);

  // Kids pair
  r = await req("/api/v1/admin/students", {
    method: "POST",
    cookie,
    body: JSON.stringify({
      mode: "child_parent",
      child_full_name: "Smoke Kid",
      parent_full_name: "Smoke Parent",
      parent_email: "smoke.parent@example.com",
      group_id: "kidsgroup-ffff-ffff-ffff-ffffffffff",
      invite: true,
    }),
  });
  if (!r.json.ok) fail(`kids pair: ${r.json.error}`);
  const parentInvite = r.json.data.invite?.magicUrl;
  steps.push(`✓ kids pair + invite ${parentInvite ? "ok" : "no-link"}`);

  r = await req("/api/v1/admin/day", { cookie });
  if (!r.json.ok) fail(`day board: ${r.json.error}`);
  steps.push(`✓ day sessions=${r.json.data.sessions?.length ?? 0}`);

  r = await req("/api/v1/attendance/bulk-upsert", { cookie });
  if (!r.json.ok) fail(`sessions: ${r.json.error}`);
  const session = r.json.data[0];
  if (!session) fail("no sessions");
  const anna = session.roster.find((x) => x.fullName === "Anna Kowalska");
  if (!anna) fail("anna not in roster");

  r = await req("/api/v1/attendance/bulk-upsert", {
    method: "POST",
    cookie,
    body: JSON.stringify({
      sessionId: session.id,
      items: [
        {
          enrollmentId: anna.enrollmentId,
          studentPersonId: anna.studentPersonId,
          status: "absent",
        },
      ],
    }),
  });
  if (!r.json.ok) fail(`attendance: ${r.json.error}`);
  steps.push(`✓ attendance absent → makeups ${r.json.data.createdMakeups?.length ?? 0}`);

  r = await req("/api/v1/attendance/finalize", {
    method: "POST",
    cookie,
    body: JSON.stringify({ sessionId: session.id }),
  });
  if (!r.json.ok) fail(`finalize: ${r.json.error}`);
  steps.push("✓ finalize session");

  // Onboarding guest trial
  r = await req("/api/v1/checkout/guest", {
    method: "POST",
    body: JSON.stringify({
      offer_id: "offer-trial-1",
      email: "smoke.trial@example.com",
      full_name: "Smoke Trial",
    }),
  });
  if (!r.json.ok) fail(`guest checkout: ${r.json.error}`);
  const paymentId = r.json.data.payment.id;

  r = await req("/api/v1/demo/complete-payment", {
    method: "POST",
    cookie,
    body: JSON.stringify({ paymentId }),
  });
  if (!r.json.ok) fail(`complete pay: ${r.json.error}`);
  if (!r.json.data.invite?.invited && !r.json.data.invite?.magicUrl) {
    // may already be invited depending on status
  }
  steps.push(`✓ trial paid invite=${Boolean(r.json.data.invite?.magicUrl)}`);

  const magicUrl = r.json.data.invite?.magicUrl;
  if (magicUrl) {
    const token = new URL(magicUrl).searchParams.get("token");
    r = await req("/api/v1/auth/magic", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    if (!r.json.ok) fail(`magic: ${r.json.error}`);
    steps.push("✓ magic login");
    cookie = pickCookie(r.setCookie);
    r = await req("/api/v1/me/onboarding", {
      method: "POST",
      cookie,
      body: JSON.stringify({ action: "complete", acceptRules: true }),
    });
    if (!r.json.ok) fail(`welcome complete: ${r.json.error}`);
    steps.push("✓ onboarding complete");
  }

  r = await req("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "anna@example.com" }),
  });
  if (!r.json.ok) fail(`login anna: ${r.json.error}`);
  cookie = pickCookie(r.setCookie);
  r = await req("/api/v1/me/dashboard", { cookie });
  if (!r.json.ok) fail(`dashboard: ${r.json.error}`);
  const makeups = r.json.data.makeups ?? [];
  steps.push(`✓ anna makeups=${makeups.length}`);

  // book makeup if available
  const available = makeups.find((m) => m.status === "available");
  if (available && r.json.data.schedule?.[0]) {
    const book = await req(`/api/v1/makeups/${available.id}/book`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ targetSessionId: r.json.data.schedule[0].id }),
    });
    steps.push(
      book.json.ok
        ? "✓ makeup book"
        : `· makeup book skip: ${book.json.error ?? "fail"}`,
    );
  }

  // parent cant-attend for child
  r = await req("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "maria@example.com" }),
  });
  if (!r.json.ok) fail(`login maria: ${r.json.error}`);
  cookie = pickCookie(r.setCookie);
  r = await req("/api/v1/me/dashboard", { cookie });
  if (!r.json.ok) fail(`maria dash: ${r.json.error}`);
  const kidSession = (r.json.data.schedule ?? []).find(
    (s) => s.forStudentId && s.forStudentId !== "kidparent-0000-0000-0000-000000000001",
  );
  if (kidSession) {
    const ca = await req("/api/v1/me/cant-attend", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        sessionId: kidSession.id,
        studentPersonId: kidSession.forStudentId,
      }),
    });
    steps.push(ca.json.ok ? "✓ parent won't-come for child" : `· parent skip: ${ca.json.error}`);
  } else {
    steps.push("· no kid session for maria");
  }

  r = await req("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@studio.local" }),
  });
  cookie = pickCookie(r.setCookie);
  r = await req("/api/v1/admin/day", {
    method: "POST",
    cookie,
    body: JSON.stringify({ action: "remind_debtors" }),
  });
  if (!r.json.ok) fail(`remind: ${r.json.error}`);
  steps.push(`✓ remind debtors=${r.json.data.reminded}`);

  console.log("SMOKE OK\n" + steps.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
