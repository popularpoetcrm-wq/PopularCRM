import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import type { BrandId } from "@/lib/brands";
import { adminMissingContactsDb } from "@/lib/join-claim";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);
  if (!(hasSupabase() && user.mode === "supabase")) {
    return jsonOk({ missing: [], total: 0 });
  }
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";
  try {
    return jsonOk(await adminMissingContactsDb(user.tenantId, tab));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 500);
  }
}
