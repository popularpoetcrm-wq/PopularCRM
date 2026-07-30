import type { SupabaseClient } from "@supabase/supabase-js";
import { createSaldeoInvoice } from "@/integrations/saldeo";
import { enqueueNotification } from "@/domain/notifications";
import { writeAudit } from "@/domain/audit";

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

  await db.from("outbox").insert({
    tenant_id: params.tenantId,
    event_type: "invoice.saldeo_sync",
    payload: { invoiceId: invoice.id },
    status: "pending",
  });

  return invoice;
}

export async function syncInvoiceToSaldeo(
  db: SupabaseClient,
  invoiceId: string,
) {
  const { data: invoice, error } = await db
    .from("invoices")
    .select("*, payments(*), persons:buyer_person_id(*)")
    .eq("id", invoiceId)
    .single();
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
    });

    const { data: updated, error: updErr } = await db
      .from("invoices")
      .update({
        status: "sent_to_saldeo",
        saldeo_invoice_id: result.saldeoInvoiceId,
        invoice_number: result.invoiceNumber ?? null,
        ksef_number: result.ksefNumber ?? null,
        pdf_url: result.pdfUrl ?? null,
        issued_at: new Date().toISOString(),
      })
      .eq("id", invoiceId)
      .select("*")
      .single();
    if (updErr) throw updErr;

    if (invoice.buyer_person_id) {
      await enqueueNotification(db, {
        tenantId: invoice.tenant_id,
        recipientPersonId: invoice.buyer_person_id,
        channel: "telegram",
        templateCode: "invoice.ready",
        payload: {
          invoiceNumber: updated.invoice_number,
          pdfUrl: updated.pdf_url,
        },
      });
    }

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
      .eq("id", invoiceId);
    throw e;
  }
}
