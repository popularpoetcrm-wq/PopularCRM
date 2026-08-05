import { getSessionUser, isAdmin } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getFakturowniaSetup } from "@/integrations/fakturownia";
import { getSaldeoSetup } from "@/integrations/saldeo";
import { getInvoiceProviderSetup } from "@/domain/invoices";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return jsonError("Forbidden", 403);
  const active = getInvoiceProviderSetup();
  return jsonOk({
    activeProvider: active.provider,
    fakturownia: getFakturowniaSetup(),
    saldeo: getSaldeoSetup(),
    // backward-compatible shape for admin UI
    configured: Boolean(active.provider),
    missing: active.provider ? [] : active.setup.missing,
    environment:
      active.provider === "fakturownia"
        ? "production"
        : getSaldeoSetup().environment,
  });
}
