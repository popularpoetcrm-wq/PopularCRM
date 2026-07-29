import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin } from "@/lib/auth";
import {
  createOnlinePaymentLink,
  recordPartialPayment,
  upsertPaymentAmount,
  getExtendedDemo,
} from "@/lib/demo-ops";
import { cookies } from "next/headers";
import type { BrandId } from "@/lib/brands";

const upsertSchema = z.object({
  action: z.literal("upsert"),
  enrollment_id: z.string(),
  payer_person_id: z.string(),
  amount: z.coerce.number().positive(),
  amount_paid: z.coerce.number().min(0).optional(),
  payment_method: z.enum(["cash", "transfer", "online", "invoice"]).optional(),
  description: z.string().optional(),
});

const partialSchema = z.object({
  action: z.literal("partial"),
  payment_id: z.string(),
  add_amount: z.coerce.number().positive(),
  method: z.enum(["cash", "transfer", "online", "invoice"]).optional(),
});

const linkSchema = z.object({
  action: z.literal("link"),
  enrollment_id: z.string().optional(),
  payer_person_id: z.string(),
  amount: z.coerce.number().positive(),
  description: z.string().optional(),
  product_kind: z.enum(["package", "trial", "event"]).optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);
  const body = await req.json();
  const jar = await cookies();
  const brandId = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";

  if (body.action === "upsert") {
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");
    return jsonOk(
      upsertPaymentAmount({ ...parsed.data, brand_id: brandId, actor: user.fullName }),
    );
  }
  if (body.action === "partial") {
    const parsed = partialSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");
    return jsonOk(recordPartialPayment({ ...parsed.data, actor: user.fullName }));
  }
  if (body.action === "link") {
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");
    return jsonOk(
      createOnlinePaymentLink({
        ...parsed.data,
        brand_id: brandId,
        actor: user.fullName,
      }),
    );
  }
  return jsonError("Unknown action");
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  return jsonOk(
    getExtendedDemo().payments.filter((p) => p.brand_id === tab || !p.brand_id),
  );
}
