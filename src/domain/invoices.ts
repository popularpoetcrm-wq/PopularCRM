import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSaldeoInvoice,
  fetchSaldeoInvoiceById,
  getSaldeoSetup,
} from "@/integrations/saldeo";
import {
  createFakturowniaInvoice,
  getFakturowniaSetup,
} from "@/integrations/fakturownia";
import { enqueueNotification, resolveNotificationRecipient } from "@/domain/notifications";
import { writeAudit } from "@/domain/audit";
import { sendTemplatedTelegram } from "@/integrations/telegram";

export function getInvoiceProviderSetup() {
  const fakturownia = getFakturowniaSetup();
  if (fakturownia.configured) {
    return { provider: "fakturownia" as const, setup: fakturownia };
  }
  const saldeo = getSaldeoSetup();
  if (saldeo.configured) {
    return { provider: "saldeo" as const, setup: saldeo };
  }
  return {
    provider: null,
    setup: {
      configured: false,
      missing: [...fakturownia.missing, ...saldeo.missing],
    },
  };
}

async function notifyInvoiceReady(
  db: SupabaseClient,
  params: {
    tenantId: string;
    recipientPersonId: string;
    invoiceNumber?: string | null;
    pdfUrl?: string | null;
  },
) {
  const payload = {
    invoiceNumber: params.invoiceNumber ?? undefined,
    pdfUrl: params.pdfUrl ?? undefined,
  };

  let deliverTo = params.recipientPersonId;
  let channel: "telegram" | "email" = "telegram";
  try {
    const recipient = await resolveNotificationRecipient(
      db,
      params.recipientPersonId,
    );
    deliverTo = recipient.personId;
    channel = recipient.channel;
  } catch {
    /* keep buyer as recipient */
  }

  const note = await enqueueNotification(db, {
    tenantId: params.tenantId,
    recipientPersonId: deliverTo,
    channel,
    templateCode: "invoice.ready",
    payload,
    dedupeKey: `invoice:${params.invoiceNumber ?? params.pdfUrl ?? "ready"}`,
  });

  if (channel !== "telegram" || !params.pdfUrl) return note;

  try {
    const { data: identity } = await db
      .from("telegram_identities")
      .select("chat_id")
      .eq("person_id", deliverTo)
      .not("chat_id", "is", null)
      .maybeSingle();
    if (identity?.chat_id) {
      await sendTemplatedTelegram({
        chatId: identity.chat_id,
        templateCode: "invoice.ready",
        payload,
      });
      await db
        .from("notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", note.id);
    }
  } catch (e) {
    console.warn("[invoice] immediate telegram delivery failed", e);
  }

  return note;
}

/** After successful payment: create + sync invoice (Fakturownia preferred). */
export async function issueInvoiceAfterPayment(
  db: SupabaseClient,
  params: {
    tenantId: string;
    paymentId: string;
    buyerPersonId: string;
  },
) {
  const { provider } = getInvoiceProviderSetup();
  if (!provider) return null;

  const { getInvoiceBillingProfile, isBillingComplete } = await import(
    "@/domain/billing"
  );
  const billing = await getInvoiceBillingProfile(db, params.buyerPersonId);
  if (!isBillingComplete(billing)) {
    console.warn(
      "[invoice] skip auto-issue — billing address incomplete",
      params.buyerPersonId,
    );
    return null;
  }

  const invoice = await requestInvoice(db, {
    tenantId: params.tenantId,
    paymentId: params.paymentId,
    buyerPersonId: params.buyerPersonId,
    buyerType: billing?.company_name || billing?.nip ? "company" : "person",
    companyName: billing?.company_name || undefined,
    nip: billing?.nip || undefined,
    actorPersonId: params.buyerPersonId,
  });

  if (invoice.status === "issued" && invoice.pdf_url) {
    return invoice;
  }

  return syncInvoiceToProvider(db, invoice.id, params.tenantId);
}

export async function requestInvoice(
  db: SupabaseClient,
  params: {
    tenantId: string;
    paymentId: string;
    buyerPersonId: string;
    buyerType?: "person" | "company";
    companyName?: string;
    nip?: string;
    actorPersonId?: string;
  },
) {
  const { data: payment, error } = await db
    .from("payments")
    .select("*, enrollments(student_person_id)")
    .eq("id", params.paymentId)
    .eq("tenant_id", params.tenantId)
    .single();
  if (error) throw error;
  const enrollment = Array.isArray(payment.enrollments)
    ? payment.enrollments[0]
    : payment.enrollments;
  const studentPersonId = enrollment?.student_person_id as string | undefined;
  if (
    payment.payer_person_id !== params.buyerPersonId &&
    studentPersonId !== params.buyerPersonId
  ) {
    const { data: relation } = studentPersonId
      ? await db
          .from("student_contacts")
          .select("id")
          .eq("student_person_id", studentPersonId)
          .eq("contact_person_id", params.buyerPersonId)
          .eq("can_pay", true)
          .maybeSingle()
      : { data: null };
    if (!relation) throw new Error("Нет доступа к этому начислению");
  }
  if (!["pending", "paid", "partial"].includes(payment.status)) {
    throw new Error("Для этого начисления нельзя выставить фактуру");
  }

  const { data: existing } = await db
    .from("invoices")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("payment_id", params.paymentId)
    .neq("status", "cancelled")
    .maybeSingle();
  if (existing) return existing;

  const { data: invoice, error: invErr } = await db
    .from("invoices")
    .insert({
      tenant_id: params.tenantId,
      payment_id: params.paymentId,
      buyer_person_id: params.buyerPersonId,
      buyer_type: params.buyerType ?? "person",
      company_name: params.companyName ?? null,
      nip: params.nip ?? null,
      requested: true,
      status: "queued",
    })
    .select("*")
    .single();
  if (invErr) throw invErr;

  await writeAudit(db, {
    tenantId: params.tenantId,
    actorPersonId: params.actorPersonId ?? params.buyerPersonId,
    action: "invoice.requested",
    entityType: "invoice",
    entityId: invoice.id,
    after: invoice,
  });

  const provider = getInvoiceProviderSetup().provider;
  await db.from("outbox").insert({
    tenant_id: params.tenantId,
    event_type:
      provider === "fakturownia"
        ? "invoice.fakturownia_sync"
        : "invoice.saldeo_sync",
    payload: { invoiceId: invoice.id },
    status: "pending",
  });

  return invoice;
}

export async function syncInvoiceToFakturownia(
  db: SupabaseClient,
  invoiceId: string,
  tenantId?: string,
) {
  let invoiceQuery = db
    .from("invoices")
    .select("*, payments(*), persons:buyer_person_id(*)")
    .eq("id", invoiceId);
  if (tenantId) invoiceQuery = invoiceQuery.eq("tenant_id", tenantId);
  const { data: invoice, error } = await invoiceQuery.single();
  if (error) throw error;

  try {
    const person = invoice.persons as
      | { full_name?: string; email?: string | null }
      | null
      | undefined;
    const payment = invoice.payments as {
      amount?: number;
      amount_paid?: number;
      currency?: string;
      description?: string | null;
      status?: string;
    };

    const { getInvoiceBillingProfile, invoiceLineDescription, isBillingComplete } =
      await import("@/domain/billing");
    const billing = invoice.buyer_person_id
      ? await getInvoiceBillingProfile(db, invoice.buyer_person_id)
      : null;
    if (!isBillingComplete(billing)) {
      throw new Error(
        "Заполните адрес для фактуры в профиле (улица, индекс, город)",
      );
    }

    const result = await createFakturowniaInvoice({
      externalId: invoice.id,
      buyerName:
        invoice.company_name ||
        billing?.company_name ||
        billing?.full_name ||
        person?.full_name ||
        "Klient",
      nip: invoice.nip || billing?.nip || undefined,
      email: billing?.email || person?.email || undefined,
      street: billing?.street,
      postCode: billing?.post_code,
      city: billing?.city,
      country: billing?.country || "PL",
      amount: Number(payment.amount_paid || payment.amount),
      currency: payment.currency || "PLN",
      description: invoiceLineDescription(payment.description),
      tax: 0,
      paid: payment.status === "paid",
    });

    const ready = Boolean(result.pdfUrl);
    const { data: updated, error: updErr } = await db
      .from("invoices")
      .update({
        status: ready ? "issued" : "sent_to_saldeo",
        saldeo_invoice_id: result.fakturowniaInvoiceId,
        invoice_number: result.invoiceNumber ?? null,
        pdf_url: result.pdfUrl ?? null,
        issued_at: ready ? new Date().toISOString() : null,
        error_message: null,
      })
      .eq("id", invoiceId)
      .eq("tenant_id", invoice.tenant_id)
      .select("*")
      .single();
    if (updErr) throw updErr;

    if (ready && invoice.buyer_person_id) {
      await notifyInvoiceReady(db, {
        tenantId: invoice.tenant_id,
        recipientPersonId: invoice.buyer_person_id,
        invoiceNumber: updated.invoice_number,
        pdfUrl: updated.pdf_url,
      });
    }

    await writeAudit(db, {
      tenantId: invoice.tenant_id,
      action: ready ? "invoice.fakturownia_issued" : "invoice.fakturownia_sent",
      entityType: "invoice",
      entityId: invoice.id,
      after: updated,
    });

    return updated;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fakturownia sync failed";
    await db
      .from("invoices")
      .update({ status: "failed", error_message: message })
      .eq("id", invoiceId)
      .eq("tenant_id", invoice.tenant_id);
    throw e;
  }
}

export async function syncInvoiceToSaldeo(
  db: SupabaseClient,
  invoiceId: string,
  tenantId?: string,
) {
  let invoiceQuery = db
    .from("invoices")
    .select("*, payments(*), persons:buyer_person_id(*)")
    .eq("id", invoiceId);
  if (tenantId) invoiceQuery = invoiceQuery.eq("tenant_id", tenantId);
  const { data: invoice, error } = await invoiceQuery.single();
  if (error) throw error;

  try {
    const result = await createSaldeoInvoice({
      externalId: invoice.id,
      buyerName:
        invoice.company_name ||
        invoice.persons?.full_name ||
        "Klient",
      nip: invoice.nip ?? undefined,
      amount: Number(invoice.payments.amount_paid || invoice.payments.amount),
      currency: invoice.payments.currency,
      description: invoice.payments.description ?? "Пакет занятий",
      vatRate: "0",
    });

    const { data: updated, error: updErr } = await db
      .from("invoices")
      .update({
        status: "sent_to_saldeo",
        saldeo_invoice_id: result.saldeoInvoiceId,
        invoice_number: result.invoiceNumber ?? null,
        ksef_number: result.ksefNumber ?? null,
        pdf_url: result.pdfUrl ?? null,
        error_message: null,
      })
      .eq("id", invoiceId)
      .eq("tenant_id", invoice.tenant_id)
      .select("*")
      .single();
    if (updErr) throw updErr;

    await writeAudit(db, {
      tenantId: invoice.tenant_id,
      action: "invoice.saldeo_sent",
      entityType: "invoice",
      entityId: invoice.id,
      after: updated,
    });

    return updated;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Saldeo sync failed";
    await db
      .from("invoices")
      .update({ status: "failed", error_message: message })
      .eq("id", invoiceId)
      .eq("tenant_id", invoice.tenant_id);
    throw e;
  }
}

export async function syncInvoiceToProvider(
  db: SupabaseClient,
  invoiceId: string,
  tenantId?: string,
) {
  const { provider } = getInvoiceProviderSetup();
  if (provider === "fakturownia") {
    return syncInvoiceToFakturownia(db, invoiceId, tenantId);
  }
  if (provider === "saldeo") {
    return syncInvoiceToSaldeo(db, invoiceId, tenantId);
  }
  throw new Error("Нет настроенного провайдера фактур (Fakturownia / Saldeo)");
}

/**
 * Saldeo creates the document asynchronously. A number alone is not enough to
 * call it ready: we wait for the PDF link, then notify the buyer exactly once.
 */
export async function refreshInvoiceFromSaldeo(
  db: SupabaseClient,
  invoiceId: string,
  tenantId?: string,
) {
  let invoiceQuery = db
    .from("invoices")
    .select("*")
    .eq("id", invoiceId);
  if (tenantId) invoiceQuery = invoiceQuery.eq("tenant_id", tenantId);
  const { data: invoice, error } = await invoiceQuery.single();
  if (error) throw error;
  if (!invoice.saldeo_invoice_id) {
    throw new Error("У фактуры ещё нет внешнего идентификатора");
  }

  if (getFakturowniaSetup().configured && invoice.pdf_url) {
    return invoice;
  }

  try {
    const result = await fetchSaldeoInvoiceById(invoice.saldeo_invoice_id);
    const ready = Boolean(result.pdfUrl);
    const { data: updated, error: updateError } = await db
      .from("invoices")
      .update({
        status: ready ? "issued" : "sent_to_saldeo",
        invoice_number: result.number ?? invoice.invoice_number ?? null,
        ksef_number: result.ksefNumber ?? invoice.ksef_number ?? null,
        pdf_url: result.pdfUrl ?? invoice.pdf_url ?? null,
        issued_at: ready ? invoice.issued_at ?? new Date().toISOString() : null,
        error_message: null,
      })
      .eq("id", invoiceId)
      .eq("tenant_id", invoice.tenant_id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    if (ready && invoice.status !== "issued" && invoice.buyer_person_id) {
      await notifyInvoiceReady(db, {
        tenantId: invoice.tenant_id,
        recipientPersonId: invoice.buyer_person_id,
        invoiceNumber: updated.invoice_number,
        pdfUrl: updated.pdf_url,
      });
    }

    await writeAudit(db, {
      tenantId: invoice.tenant_id,
      action: ready ? "invoice.saldeo_issued" : "invoice.saldeo_checked",
      entityType: "invoice",
      entityId: invoice.id,
      after: updated,
    });

    return updated;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Saldeo status check failed";
    await db
      .from("invoices")
      .update({ status: "failed", error_message: message })
      .eq("id", invoiceId)
      .eq("tenant_id", invoice.tenant_id);
    throw e;
  }
}
