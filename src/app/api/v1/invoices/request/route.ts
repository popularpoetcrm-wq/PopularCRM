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
      status: "queued",
    };
    state.invoices.unshift(invoice);
    return jsonOk(invoice);
  }

  try {
    const {
      requestInvoice,
      syncInvoiceToProvider,
      getInvoiceProviderSetup,
    } = await import("@/domain/invoices");
    const { getAdminClient } = await import("@/lib/supabase/admin");
    const {
      getInvoiceBillingProfile,
      isBillingComplete,
    } = await import("@/domain/billing");
    const db = getAdminClient();

    const billing = await getInvoiceBillingProfile(db, user.personId);
    if (!isBillingComplete(billing)) {
      return jsonError(
        "Заполните адрес для фактуры в профиле (улица, индекс, город)",
        400,
      );
    }

    const invoice = await requestInvoice(db, {
      tenantId: user.tenantId,
      paymentId: parsed.data.paymentId,
      buyerPersonId: user.personId,
      buyerType:
        parsed.data.buyerType === "company" ||
        billing?.company_name ||
        billing?.nip ||
        parsed.data.companyName ||
        parsed.data.nip
          ? "company"
          : "person",
      companyName:
        parsed.data.companyName || billing?.company_name || undefined,
      nip: parsed.data.nip || billing?.nip || undefined,
      actorPersonId: user.personId,
    });

    if (["issued", "sent_to_saldeo"].includes(invoice.status) && invoice.pdf_url) {
      return jsonOk(invoice);
    }

    const { provider } = getInvoiceProviderSetup();
    if (!provider) return jsonOk(invoice);

    return jsonOk(await syncInvoiceToProvider(db, invoice.id, user.tenantId));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
