import { z } from "zod";
import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import {
  createOffer,
  createOnlinePaymentLink,
  getExtendedDemo,
} from "@/lib/demo-ops";
import type { BrandId } from "@/lib/brands";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  return jsonOk(getExtendedDemo().offers);
}

const createSchema = z.object({
  product_kind: z.enum(["trial", "event"]),
  title: z.string().min(2),
  amount: z.coerce.number().positive(),
  starts_at: z.string(),
  capacity: z.coerce.number().optional(),
});

const buySchema = z.object({
  action: z.literal("buy"),
  offer_id: z.string(),
  payer_person_id: z.string().optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const body = await req.json();
  const jar = await cookies();
  const brandId = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";

  if (body.action === "buy") {
    const parsed = buySchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid payload");
    const offer = getExtendedDemo().offers.find((o) => o.id === parsed.data.offer_id);
    if (!offer) return jsonError("Offer not found", 404);
    const payment = createOnlinePaymentLink({
      payer_person_id: parsed.data.payer_person_id ?? user.personId,
      brand_id: offer.brand_id,
      amount: offer.amount,
      description: offer.title,
      product_kind: offer.product_kind,
      offer_id: offer.id,
      actor: user.fullName,
    });
    return jsonOk(payment);
  }

  if (!isStaff(user.roles)) return jsonError("Forbidden", 403);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid payload");
  return jsonOk(
    createOffer({
      brand_id: brandId === "tickets" ? "poet" : brandId,
      ...parsed.data,
      actor: user.fullName,
    }),
  );
}
