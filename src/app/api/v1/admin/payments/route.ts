import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDemoState } from "@/lib/demo-store";
import { hasSupabase } from "@/lib/env";
import { listPaymentsDb } from "@/lib/supabase-data";
import { cookies } from "next/headers";
import type { BrandId } from "@/lib/brands";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);

  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";

  if (hasSupabase() && user.mode === "supabase") {
    try {
      return jsonOk(await listPaymentsDb(user.tenantId, tab));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "fail", 500);
    }
  }

  return jsonOk(getDemoState().payments.filter((p) => p.brand_id === tab));
}
