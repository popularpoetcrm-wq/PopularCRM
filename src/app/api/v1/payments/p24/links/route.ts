import { z } from "zod";
import { jsonError, jsonOk, getRequestId } from "@/lib/api";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { getDemoState } from "@/lib/demo-store";
import { nanoid } from "nanoid";
import { checkoutUrl, type BrandId, type ProductKind } from "@/lib/brands";
import { cookies } from "next/headers";

const bodySchema = z.object({
  paymentId: z.string().optional(),
  enrollmentId: z.string().uuid().or(z.string().min(1)).optional(),
  planId: z.string().optional(),
  payerPersonId: z.string().optional(),
  /** Ignored for package checkout — server uses DB amount / plan price. */
  amount: z.coerce.number().positive().optional(),
  currency: z.string().default("PLN"),
  description: z.string().optional(),
  /** package | trial | event — trials/events always checkout on populartickets */
  productKind: z.enum(["package", "trial", "event"]).default("package"),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");

  const productKind = parsed.data.productKind as ProductKind;

  if (!hasSupabase() || user.mode === "demo") {
    if (parsed.data.amount == null) {
      return jsonError("amount required in demo");
    }
    const state = getDemoState();
    const id = `pay-${nanoid(8)}`;
    const jar = await cookies();
    const brandId = (jar.get("admin_brand_tab")?.value ||
      jar.get("studio_brand_id")?.value ||
      "poet") as BrandId;
    const paymentUrl = checkoutUrl(productKind, id);
    const payment = {
      id,
      brand_id: brandId === "tickets" ? "poet" : brandId,
      payer_person_id: parsed.data.payerPersonId ?? user.personId,
      enrollment_id: parsed.data.enrollmentId ?? "",
      amount: parsed.data.amount,
      amount_paid: 0,
      status: "pending",
      payment_method: "online",
      description:
        parsed.data.description ??
        (productKind === "trial"
          ? "Пробное занятие"
          : productKind === "event"
            ? "Ивент"
            : "Пакет 4 занятий"),
      payment_url: paymentUrl,
      created_at: new Date().toISOString(),
    };
    state.payments.unshift(payment);
    return jsonOk({ ...payment, product_kind: productKind });
  }

  if (!parsed.data.enrollmentId && productKind === "package") {
    return jsonError("enrollmentId required for package");
  }

  const { createPaymentLink } = await import("@/domain/payments");
  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();

  if (productKind === "package") {
    const { data: enrollment } = await db
      .from("enrollments")
      .select("*")
      .eq("id", parsed.data.enrollmentId!)
      .single();
    if (!enrollment) return jsonError("Enrollment not found", 404);

    if (
      !isAdmin(user.roles) &&
      enrollment.student_person_id !== user.personId &&
      parsed.data.payerPersonId !== user.personId
    ) {
      return jsonError("Forbidden", 403);
    }

    if (parsed.data.paymentId) {
      const { data: existing, error: existingError } = await db
        .from("payments")
        .select("*")
        .eq("id", parsed.data.paymentId)
        .eq("tenant_id", user.tenantId)
        .single();
      if (existingError || !existing) {
        return jsonError("Начисление не найдено", 404);
      }
      if (
        !isAdmin(user.roles) &&
        existing.payer_person_id !== user.personId &&
        enrollment.student_person_id !== user.personId
      ) {
        return jsonError("Forbidden", 403);
      }
      if (!["pending", "partial"].includes(existing.status)) {
        return jsonError("Это начисление уже закрыто", 400);
      }

      // Server-side amount only — never trust client payload.
      const chargeAmount = Math.max(
        0,
        Number(existing.amount) - Number(existing.amount_paid ?? 0),
      );
      if (chargeAmount <= 0) {
        return jsonError("Нечего оплачивать по этому начислению", 400);
      }

      const sessionId = `crm-${nanoid(16)}`;
      const description =
        parsed.data.description ?? existing.description ?? "Абонемент";
      const { hasTicketsCheckout, createTicketsCrmCheckout } = await import(
        "@/lib/tickets-checkout"
      );

      let paymentUrl: string;
      let providerToken: string | null = null;

      if (hasTicketsCheckout()) {
        const checkout = await createTicketsCrmCheckout({
          crmPaymentId: existing.id,
          amount: chargeAmount,
          currency: existing.currency || parsed.data.currency,
          description,
          buyerEmail: user.email,
        });
        paymentUrl = checkout.checkout_url;
        providerToken = checkout.order_id;
      } else {
        const { registerP24Transaction } = await import("@/integrations/przelewy24");
        const { paymentReturnUrl, paymentStatusUrl } = await import("@/lib/brands");
        const registered = await registerP24Transaction({
          sessionId,
          amount: Math.round(chargeAmount * 100),
          currency: existing.currency || parsed.data.currency,
          description,
          email: user.email,
          urlReturn: paymentReturnUrl("/pay/return"),
          urlStatus: paymentStatusUrl(),
        });
        paymentUrl = registered.paymentUrl;
        providerToken = registered.token;
      }

      const { data: updated, error: updateError } = await db
        .from("payments")
        .update({
          provider: "przelewy24",
          payment_method: "online",
          provider_session_id: sessionId,
          provider_token: providerToken,
          payment_url: paymentUrl,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (updateError) return jsonError(updateError.message, 500);
      return jsonOk(updated);
    }

    const planId = parsed.data.planId ?? enrollment.plan_id;
    const { data: plan } = await db
      .from("package_plans")
      .select("id, name, price_gross, currency")
      .eq("id", planId)
      .maybeSingle();
    if (!plan) return jsonError("План пакета не найден", 404);
    const planAmount = Number(plan.price_gross);
    if (!(planAmount > 0)) return jsonError("У плана нет цены", 400);

    const result = await createPaymentLink(db, {
      tenantId: user.tenantId,
      enrollmentId: parsed.data.enrollmentId!,
      planId: plan.id,
      payerPersonId: parsed.data.payerPersonId ?? user.personId,
      amount: planAmount,
      currency: plan.currency || parsed.data.currency,
      description: parsed.data.description ?? plan.name,
      email: user.email,
    });

    return jsonOk(
      { ...result, product_kind: productKind },
      { headers: { "x-request-id": getRequestId(req) } },
    );
  }

  // trial / event — only staff may invent an amount; clients need a catalog offer later
  if (!isAdmin(user.roles) && !user.roles.includes("teacher")) {
    return jsonError("Создание trial/event оплаты только для персонала", 403);
  }
  if (parsed.data.amount == null || !(parsed.data.amount > 0)) {
    return jsonError("amount required for trial/event");
  }

  // trial / event — payment row without enrollment package activation
  const sessionId = `crm-${nanoid(16)}`;
  const description = parsed.data.description ?? productKind;
  const chargeAmount = parsed.data.amount;
  const { hasTicketsCheckout, createTicketsCrmCheckout } = await import(
    "@/lib/tickets-checkout"
  );

  const { data: payment, error } = await db
    .from("payments")
    .insert({
      tenant_id: user.tenantId,
      provider: "przelewy24",
      payer_person_id: parsed.data.payerPersonId ?? user.personId,
      amount: chargeAmount,
      currency: parsed.data.currency,
      status: "pending",
      payment_method: "online",
      product_kind: productKind,
      brand_id: "poet",
      description,
      provider_session_id: sessionId,
    })
    .select("*")
    .single();
  if (error) return jsonError(error.message, 500);

  let paymentUrl: string;
  let providerToken: string | null = null;

  if (hasTicketsCheckout()) {
    const checkout = await createTicketsCrmCheckout({
      crmPaymentId: payment.id,
      amount: chargeAmount,
      currency: parsed.data.currency,
      description,
      buyerEmail: user.email,
    });
    paymentUrl = checkout.checkout_url;
    providerToken = checkout.order_id;
  } else {
    const { registerP24Transaction } = await import("@/integrations/przelewy24");
    const { paymentReturnUrl, paymentStatusUrl } = await import("@/lib/brands");
    const registered = await registerP24Transaction({
      sessionId,
      amount: Math.round(chargeAmount * 100),
      currency: parsed.data.currency,
      description,
      email: user.email,
      urlReturn: paymentReturnUrl("/pay/return"),
      urlStatus: paymentStatusUrl(),
    });
    paymentUrl = registered.paymentUrl || checkoutUrl(productKind, sessionId);
    providerToken = registered.token;
  }

  const { data: updated, error: updateError } = await db
    .from("payments")
    .update({
      provider_token: providerToken,
      payment_url: paymentUrl,
    })
    .eq("id", payment.id)
    .select("*")
    .single();
  if (updateError) return jsonError(updateError.message, 500);

  return jsonOk(updated);
}
