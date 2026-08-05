import type { SupabaseClient } from "@supabase/supabase-js";

export type InvoiceBillingProfile = {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  street: string;
  post_code: string;
  city: string;
  country: string;
  nip?: string | null;
  company_name?: string | null;
};

const BILLING_COLS =
  "invoice_street, invoice_post_code, invoice_city, invoice_country, invoice_nip, invoice_company_name";

let columnsReady: boolean | null = null;

async function hasBillingColumns(db: SupabaseClient): Promise<boolean> {
  if (columnsReady != null) return columnsReady;
  const { error } = await db
    .from("persons")
    .select("invoice_street")
    .limit(1);
  columnsReady = !error;
  return columnsReady;
}

export function isBillingComplete(
  profile: Partial<InvoiceBillingProfile> | null | undefined,
): boolean {
  if (!profile) return false;
  return Boolean(
    profile.full_name?.trim() &&
      profile.street?.trim() &&
      profile.post_code?.trim() &&
      profile.city?.trim(),
  );
}

export async function getInvoiceBillingProfile(
  db: SupabaseClient,
  personId: string,
): Promise<InvoiceBillingProfile | null> {
  const base = await db
    .from("persons")
    .select("full_name, email, phone")
    .eq("id", personId)
    .maybeSingle();
  if (base.error || !base.data) return null;

  let street: string | null = null;
  let post_code: string | null = null;
  let city: string | null = null;
  let country: string | null = "PL";
  let nip: string | null = null;
  let company_name: string | null = null;

  if (await hasBillingColumns(db)) {
    const { data } = await db
      .from("persons")
      .select(BILLING_COLS)
      .eq("id", personId)
      .maybeSingle();
    if (data) {
      street = data.invoice_street;
      post_code = data.invoice_post_code;
      city = data.invoice_city;
      country = data.invoice_country || "PL";
      nip = data.invoice_nip;
      company_name = data.invoice_company_name;
    }
  } else {
    // Fallback: tenants.settings.billing[personId] until migration 011 is applied
    const { data: person } = await db
      .from("persons")
      .select("tenant_id")
      .eq("id", personId)
      .single();
    if (person?.tenant_id) {
      const { data: tenant } = await db
        .from("tenants")
        .select("settings")
        .eq("id", person.tenant_id)
        .single();
      const stored = (
        tenant?.settings as
          | { billing?: Record<string, InvoiceBillingProfile> }
          | null
          | undefined
      )?.billing?.[personId];
      if (stored) {
        street = stored.street ?? null;
        post_code = stored.post_code ?? null;
        city = stored.city ?? null;
        country = stored.country || "PL";
        nip = stored.nip ?? null;
        company_name = stored.company_name ?? null;
      }
    }
  }

  return {
    full_name: base.data.full_name,
    email: base.data.email,
    phone: base.data.phone,
    street: street ?? "",
    post_code: post_code ?? "",
    city: city ?? "",
    country: country || "PL",
    nip,
    company_name,
  };
}

export async function saveInvoiceBillingProfile(
  db: SupabaseClient,
  personId: string,
  patch: Partial<InvoiceBillingProfile>,
): Promise<InvoiceBillingProfile> {
  const { data: person, error } = await db
    .from("persons")
    .select("id, tenant_id, full_name, email, phone")
    .eq("id", personId)
    .single();
  if (error || !person) throw new Error("Person not found");

  const next: InvoiceBillingProfile = {
    full_name: (patch.full_name ?? person.full_name).trim(),
    email: patch.email !== undefined ? patch.email : person.email,
    phone: patch.phone !== undefined ? patch.phone : person.phone,
    street: (patch.street ?? "").trim(),
    post_code: (patch.post_code ?? "").trim(),
    city: (patch.city ?? "").trim(),
    country: ((patch.country ?? "PL") || "PL").trim().toUpperCase().slice(0, 2),
    nip: patch.nip?.trim() || null,
    company_name: patch.company_name?.trim() || null,
  };

  if (patch.full_name !== undefined || patch.email !== undefined || patch.phone !== undefined) {
    const personPatch: Record<string, unknown> = {};
    if (patch.full_name !== undefined) personPatch.full_name = next.full_name;
    if (patch.email !== undefined) {
      personPatch.email = next.email?.trim().toLowerCase() || null;
    }
    if (patch.phone !== undefined) {
      personPatch.phone = next.phone?.trim() || null;
    }
    if (Object.keys(personPatch).length) {
      const { error: updErr } = await db
        .from("persons")
        .update(personPatch)
        .eq("id", personId);
      if (updErr) throw new Error(updErr.message);
    }
  }

  if (await hasBillingColumns(db)) {
    const { error: billErr } = await db
      .from("persons")
      .update({
        invoice_street: next.street || null,
        invoice_post_code: next.post_code || null,
        invoice_city: next.city || null,
        invoice_country: next.country || "PL",
        invoice_nip: next.nip,
        invoice_company_name: next.company_name,
      })
      .eq("id", personId);
    if (billErr) throw new Error(billErr.message);
  } else {
    const { data: tenant, error: tErr } = await db
      .from("tenants")
      .select("settings")
      .eq("id", person.tenant_id)
      .single();
    if (tErr) throw new Error(tErr.message);
    const settings = {
      ...((tenant?.settings as Record<string, unknown>) ?? {}),
    };
    const billing = {
      ...((settings.billing as Record<string, InvoiceBillingProfile>) ?? {}),
      [personId]: next,
    };
    settings.billing = billing;
    const { error: sErr } = await db
      .from("tenants")
      .update({ settings })
      .eq("id", person.tenant_id);
    if (sErr) throw new Error(sErr.message);
  }

  return (await getInvoiceBillingProfile(db, personId))!;
}

/** Polish line item for package invoices */
export function invoiceLineDescription(paymentDescription?: string | null): string {
  const raw = (paymentDescription || "").toLowerCase();
  if (raw.includes("aktorsk") || raw.includes("acting") || raw.includes("teatr")) {
    return "Kurs aktorski — 4 zajęcia";
  }
  if (raw.includes("testowy") || raw.includes("fakturownia") || raw.includes("pakiet")) {
    return "Kurs aktorski — 4 zajęcia";
  }
  return "Kurs aktorski — 4 zajęcia";
}
