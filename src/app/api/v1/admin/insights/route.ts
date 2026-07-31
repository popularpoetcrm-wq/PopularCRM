import { cookies } from "next/headers";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser, isAdmin } from "@/lib/auth";
import type { BrandId } from "@/lib/brands";
import { hasSupabase } from "@/lib/env";
import { loadAdminInsightsDb } from "@/lib/admin-insights";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);

  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";

  if (!(hasSupabase() && user.mode === "supabase")) {
    return jsonOk({
      brand_id: tab,
      pulse: {
        revenue_paid: 0,
        debt_open: 0,
        debtors: 0,
        active_students: 0,
        attach_pct: 0,
        attach_count: 0,
        present_rate: null,
      },
      directions: [],
      open_debt: [],
      top_ltv: [],
      risk: [],
      cross_sell: [],
      thin_groups: [],
      advice: [
        {
          id: "demo",
          title: "Нужен режим Supabase",
          detail: "Сводка считает метрики из реальных payments / attendance.",
          count: 0,
        },
      ],
      mode: "demo",
    });
  }

  try {
    const data = await loadAdminInsightsDb(user.tenantId, tab);
    return jsonOk({ ...data, mode: "supabase" });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 500);
  }
}
