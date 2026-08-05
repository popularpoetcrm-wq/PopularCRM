import { z } from "zod";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasSupabase } from "@/lib/env";
import { getDemoState } from "@/lib/demo-store";

const actionSchema = z.object({
  invoiceId: z.string().min(1),
  action: z.enum(["send", "refresh"]).default("send"),
});

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
  const parsed = actionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("invoiceId required");
  if (!hasSupabase() || user.mode === "demo") {
    return jsonError("Повторная отправка доступна только с провайдером фактур", 400);
  }

  try {
    const { getAdminClient } = await import("@/lib/supabase/admin");
    const {
      getInvoiceProviderSetup,
      syncInvoiceToProvider,
      refreshInvoiceFromSaldeo,
    } = await import("@/domain/invoices");
    const providerInfo = getInvoiceProviderSetup();
    if (!providerInfo.provider) {
      return jsonError("Провайдер фактур не настроен", 409, {
        provider: providerInfo,
      });
    }
    const invoice =
      parsed.data.action === "refresh"
        ? await refreshInvoiceFromSaldeo(
            getAdminClient(),
            parsed.data.invoiceId,
            user.tenantId,
          )
        : await syncInvoiceToProvider(
            getAdminClient(),
            parsed.data.invoiceId,
            user.tenantId,
          );
    return jsonOk(invoice);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
