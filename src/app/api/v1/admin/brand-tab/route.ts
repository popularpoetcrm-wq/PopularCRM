import { z } from "zod";
import { NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { ADMIN_BRAND_TABS, type BrandId } from "@/lib/brands";

const bodySchema = z.object({
  brandId: z.enum(["poet", "kids"]),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid brand");
  if (!ADMIN_BRAND_TABS.includes(parsed.data.brandId as BrandId)) {
    return jsonError("Brand not allowed in admin tabs");
  }

  const res = jsonOk({ brandId: parsed.data.brandId });
  res.cookies.set("admin_brand_tab", parsed.data.brandId, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });
  return res;
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
