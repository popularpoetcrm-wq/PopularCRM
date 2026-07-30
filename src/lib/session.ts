import { createHmac, timingSafeEqual } from "crypto";
import type { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

const COOKIE_SESSION = "studio_session";
const LEGACY_PERSON = "studio_person_id";
const LEGACY_TENANT = "studio_tenant_id";

/** 14 days */
const SESSION_TTL_SEC = 14 * 24 * 60 * 60;

export type SessionPayload = {
  v: 1;
  personId: string;
  tenantId: string;
  exp: number;
};

function sessionSecret(): string {
  const env = getEnv();
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit && explicit.length >= 16) return explicit;
  // Bootstrap from existing secrets so prod works before SESSION_SECRET is set.
  const parts = [
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.CRM_CHECKOUT_SECRET,
    env.CRM_WEBHOOK_SECRET,
    env.CRON_SECRET,
  ].filter(Boolean);
  if (parts.length) return parts.join("|");
  if (process.env.NODE_ENV !== "production") return "dev-only-session-secret";
  throw new Error("SESSION_SECRET is required in production");
}

function b64url(buf: Buffer | string) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromB64url(s: string) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(payloadB64: string) {
  return b64url(
    createHmac("sha256", sessionSecret()).update(payloadB64).digest(),
  );
}

export function createSessionToken(input: {
  personId: string;
  tenantId: string;
  ttlSec?: number;
}) {
  const payload: SessionPayload = {
    v: 1,
    personId: input.personId,
    tenantId: input.tenantId,
    exp: Math.floor(Date.now() / 1000) + (input.ttlSec ?? SESSION_TTL_SEC),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const raw = JSON.parse(fromB64url(payloadB64).toString("utf8")) as SessionPayload;
    if (raw?.v !== 1 || !raw.personId || !raw.tenantId || !raw.exp) return null;
    if (raw.exp < Math.floor(Date.now() / 1000)) return null;
    return raw;
  } catch {
    return null;
  }
}

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

/** Set signed session; clear legacy forgeable UUID cookies. */
export function applySessionCookies(
  res: NextResponse,
  input: { personId: string; tenantId: string; ttlSec?: number },
) {
  const token = createSessionToken(input);
  const maxAge = input.ttlSec ?? SESSION_TTL_SEC;
  res.cookies.set(COOKIE_SESSION, token, { ...cookieBase, maxAge });
  // Force-invalidate unsigned legacy cookies
  res.cookies.set(LEGACY_PERSON, "", { ...cookieBase, maxAge: 0 });
  res.cookies.set(LEGACY_TENANT, "", { ...cookieBase, maxAge: 0 });
  return res;
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.set(COOKIE_SESSION, "", { ...cookieBase, maxAge: 0 });
  res.cookies.set(LEGACY_PERSON, "", { ...cookieBase, maxAge: 0 });
  res.cookies.set(LEGACY_TENANT, "", { ...cookieBase, maxAge: 0 });
  return res;
}

export function readSessionFromCookies(jar: {
  get: (name: string) => { value: string } | undefined;
}): SessionPayload | null {
  return verifySessionToken(jar.get(COOKIE_SESSION)?.value);
}

export { COOKIE_SESSION, LEGACY_PERSON, LEGACY_TENANT };
