import { z } from "zod";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasSupabase } from "@/lib/env";
import { getDemoState } from "@/lib/demo-store";

const retrySchema = z.object({ invoiceId: z.string().min(1) });

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);

  if (!hasSupabase() || user.mode === "demo") {
    return jsonOk(getDemoState().invoices);
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await getAdminClient()
    .from("invoices")
    .select("*, payments(amount, currency, description), persons:buyer_person_id(full_name)")
    .eq("tenant_id", user.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return jsonError(error.message, 500);
  return jsonOk(data ?? []);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);
  const parsed = retrySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("invoiceId required");
  if (!hasSupabase() || user.mode === "demo") {
    return jsonError("Повторная отправка доступна только с Saldeo", 400);
  }

  try {
    const { getAdminClient } = await import("@/lib/supabase/admin");
    const { syncInvoiceToSaldeo } = await import("@/domain/invoices");
    return jsonOk(
      await syncInvoiceToSaldeo(getAdminClient(), parsed.data.invoiceId),
    );
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
