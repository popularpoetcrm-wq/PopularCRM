import { cookies, headers } from "next/headers";
import { brandById, resolveBrandFromHost, type BrandConfig } from "@/lib/brands";

export async function getRequestBrand(): Promise<BrandConfig> {
  const h = await headers();
  const fromHeader = h.get("x-brand-id");
  if (fromHeader) return brandById(fromHeader);

  const jar = await cookies();
  const fromCookie = jar.get("studio_brand_id")?.value;
  if (fromCookie) return brandById(fromCookie);

  return resolveBrandFromHost(h.get("host"));
}

export async function getAdminBrandFilter(): Promise<string | null> {
  const jar = await cookies();
  return jar.get("admin_brand_tab")?.value ?? null;
}
