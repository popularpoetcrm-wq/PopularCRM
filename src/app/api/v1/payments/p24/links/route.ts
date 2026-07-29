import { z } from "zod";
import { jsonError, jsonOk, getRequestId } from "@/lib/api";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { getDemoState } from "@/lib/demo-store";
import { nanoid } from "nanoid";
import { checkoutUrl, type BrandId, type ProductKind } from "@/lib/brands";
import { cookies } from "next/headers";

const bodySchema = z.object({
  enrollmentId: z.string().uuid().or(z.string().min(1)).optional(),
  planId: z.string().optional(),
  payerPersonId: z.string().optional(),
  amount: z.coerce.number().positive(),
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
            : "Pakiet 4 zajęć"),
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

    const result = await createPaymentLink(db, {
      tenantId: user.tenantId,
      enrollmentId: parsed.data.enrollmentId!,
      planId: parsed.data.planId ?? enrollment.plan_id,
      payerPersonId: parsed.data.payerPersonId ?? user.personId,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      description: parsed.data.description,
      email: user.email,
    });

    return jsonOk(
      { ...result, product_kind: productKind },
      { headers: { "x-request-id": getRequestId(req) } },
    );
  }

  // trial / event — payment row without enrollment package activation
  const sessionId = `crm-${nanoid(16)}`;
  const { registerP24Transaction } = await import("@/integrations/przelewy24");
  const { paymentReturnUrl, paymentStatusUrl } = await import("@/lib/brands");
  const registered = await registerP24Transaction({
    sessionId,
    amount: Math.round(parsed.data.amount * 100),
    currency: parsed.data.currency,
    description: parsed.data.description ?? productKind,
    email: user.email,
    urlReturn: paymentReturnUrl("/pay/return"),
    urlStatus: paymentStatusUrl(),
  });

  const { data: payment, error } = await db
    .from("payments")
    .insert({
      tenant_id: user.tenantId,
      provider: "przelewy24",
      payer_person_id: parsed.data.payerPersonId ?? user.personId,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      status: "pending",
      payment_method: "online",
      product_kind: productKind,
      brand_id: "poet",
      description: parsed.data.description ?? productKind,
      provider_session_id: sessionId,
      provider_token: registered.token,
      payment_url: registered.paymentUrl || checkoutUrl(productKind, sessionId),
    })
    .select("*")
    .single();
  if (error) return jsonError(error.message, 500);

  return jsonOk(payment);
}
