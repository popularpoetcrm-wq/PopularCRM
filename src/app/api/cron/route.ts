import { jsonError, jsonOk } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { hasSupabase } from "@/lib/env";
import { sendTemplatedTelegram } from "@/integrations/telegram";

function authorize(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorize(req)) return jsonError("Unauthorized", 401);

  const { searchParams } = new URL(req.url);
  const job = searchParams.get("job") ?? "retry_failed_notifications";

  if (!hasSupabase()) {
    return jsonOk({ job, mode: "demo", processed: 0 });
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const db = getAdminClient();

  if (job === "expire_makeup_credits") {
    const { data } = await db
      .from("makeup_credits")
      .update({ status: "expired" })
      .eq("status", "available")
      .lt("valid_until", new Date().toISOString())
      .select("id");
    return jsonOk({ job, expired: data?.length ?? 0 });
  }

  if (job === "expire_packages") {
    const { data: pkgs } = await db
      .from("student_packages")
      .update({ status: "expired" })
      .eq("status", "active")
      .lt("expires_at", new Date().toISOString())
      .select("id");
    for (const pkg of pkgs ?? []) {
      await db
        .from("lesson_credits")
        .update({ status: "expired" })
        .eq("student_package_id", pkg.id)
        .eq("status", "available");
    }
    return jsonOk({ job, expired: pkgs?.length ?? 0 });
  }

  if (job === "retry_failed_notifications" || job === "dispatch_notifications") {
    const { data: notes } = await db
      .from("notifications")
      .select("*, telegram_identities:recipient_person_id(*)")
      .eq("status", "queued")
      .lte("scheduled_at", new Date().toISOString())
      .limit(50);

    let sent = 0;
    for (const n of notes ?? []) {
      try {
        if (n.channel === "telegram") {
          const { data: identity } = await db
            .from("telegram_identities")
            .select("chat_id")
            .eq("person_id", n.recipient_person_id)
            .maybeSingle();
          if (identity?.chat_id) {
            await sendTemplatedTelegram({
              chatId: identity.chat_id,
              templateCode: n.template_code,
              payload: n.payload,
            });
          }
        }
        await db
          .from("notifications")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", n.id);
        sent += 1;
      } catch (e) {
        await db
          .from("notifications")
          .update({
            status: "failed",
            failed_at: new Date().toISOString(),
            error_message: e instanceof Error ? e.message : "fail",
          })
          .eq("id", n.id);
      }
    }
    return jsonOk({ job, sent });
  }

  if (job === "invoice_saldeo_sync") {
    const { data: pending } = await db
      .from("invoices")
      .select("id")
      .eq("status", "queued")
      .limit(20);
    const { syncInvoiceToSaldeo } = await import("@/domain/invoices");
    let synced = 0;
    for (const inv of pending ?? []) {
      await syncInvoiceToSaldeo(db, inv.id);
      synced += 1;
    }
    return jsonOk({ job, synced });
  }

  return jsonError(`Unknown job: ${job}`, 400);
}
