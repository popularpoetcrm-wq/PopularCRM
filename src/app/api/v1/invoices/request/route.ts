import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { getDemoState } from "@/lib/demo-store";
import { nanoid } from "nanoid";

const bodySchema = z.object({
  paymentId: z.string(),
  buyerType: z.enum(["person", "company"]).default("person"),
  companyName: z.string().optional(),
  nip: z.string().optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  if (!hasSupabase() || user.mode === "demo") {
    const state = getDemoState();
    const payment = state.payments.find((p) => p.id === parsed.data.paymentId);
    if (!payment) return jsonError("Payment not found", 404);
    const invoice = {
      id: `inv-${nanoid(6)}`,
      payment_id: payment.id,
      status: "sent_to_saldeo",
      invoice_number: `FV/DEMO/${Date.now()}`,
      pdf_url: `/cabinet/invoices?preview=1`,
    };
    state.invoices.unshift(invoice);
    return jsonOk(invoice);
  }

  const { requestInvoice, syncInvoiceToSaldeo } = await import("@/domain/invoices");
  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();
  const invoice = await requestInvoice(db, {
    tenantId: user.tenantId,
    paymentId: parsed.data.paymentId,
    buyerPersonId: user.personId,
    buyerType: parsed.data.buyerType,
    companyName: parsed.data.companyName,
    nip: parsed.data.nip,
    actorPersonId: user.personId,
  });

  // MVP: sync immediately (later via outbox worker)
  const synced = await syncInvoiceToSaldeo(db, invoice.id);
  return jsonOk(synced);
}
