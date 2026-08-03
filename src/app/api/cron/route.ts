import { jsonError, jsonOk } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { hasSupabase } from "@/lib/env";
import { sendTemplatedTelegram } from "@/integrations/telegram";
import { renderTemplate } from "@/domain/notifications";

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
    let notesQuery = db
      .from("notifications")
      .select("*")
      .lte("scheduled_at", new Date().toISOString())
      .limit(50);
    notesQuery =
      job === "retry_failed_notifications"
        ? notesQuery.in("status", ["queued", "failed"])
        : notesQuery.eq("status", "queued");
    const { data: notes } = await notesQuery;

    let sent = 0;
    let failed = 0;
    for (const n of notes ?? []) {
      try {
        if (n.channel === "telegram") {
          const { data: identity } = await db
            .from("telegram_identities")
            .select("chat_id")
            .eq("person_id", n.recipient_person_id)
            .maybeSingle();
          if (!identity?.chat_id) throw new Error("Telegram не привязан");
          await sendTemplatedTelegram({
            chatId: identity.chat_id,
            templateCode: n.template_code,
            payload: n.payload,
          });
        } else if (n.channel === "email") {
          const env = getEnv();
          if (!env.RESEND_API_KEY) throw new Error("Resend не настроен");
          const { data: person } = await db
            .from("persons")
            .select("email")
            .eq("id", n.recipient_person_id)
            .maybeSingle();
          if (!person?.email) throw new Error("У получателя нет email");
          const { Resend } = await import("resend");
          await new Resend(env.RESEND_API_KEY).emails.send({
            from: env.EMAIL_FROM!,
            to: person.email,
            subject: "Уведомление от студии",
            text: renderTemplate(n.template_code, n.payload ?? {}),
          });
        } else {
          throw new Error(`Неизвестный канал: ${n.channel}`);
        }
        await db
          .from("notifications")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            failed_at: null,
            error_message: null,
          })
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
        failed += 1;
      }
    }
    return jsonOk({ job, sent, failed });
  }

  if (job === "queue_payment_reminders") {
    const { data: payments } = await db
      .from("payments")
      .select("id, tenant_id, payer_person_id, amount, amount_paid, payment_url")
      .in("status", ["pending", "partial"])
      .not("due_at", "is", null)
      .lte("due_at", new Date().toISOString())
      .limit(100);
    const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const { enqueueBestNotification } = await import("@/domain/notifications");
    let queued = 0;
    for (const payment of payments ?? []) {
      if (!payment.payer_person_id) continue;
      const { data: recent } = await db
        .from("notifications")
        .select("id")
        .eq("template_code", "payment.reminder")
        .contains("payload", { paymentId: payment.id })
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();
      if (recent) continue;
      try {
        await enqueueBestNotification(db, {
          tenantId: payment.tenant_id,
          recipientPersonId: payment.payer_person_id,
          templateCode: "payment.reminder",
          payload: {
            paymentId: payment.id,
            amount: Math.max(
              0,
              Number(payment.amount) - Number(payment.amount_paid),
            ),
            paymentUrl: payment.payment_url,
          },
        });
        queued += 1;
      } catch (e) {
        console.error("[cron] payment reminder skipped", payment.id, e);
      }
    }
    return jsonOk({ job, queued });
  }

  if (job === "queue_attendance_reminders") {
    const { enqueueBestNotification } = await import("@/domain/notifications");
    const { STUDIO_POLICY } = await import("@/lib/studio-policy");
    const appUrl = (
      getEnv().NEXT_PUBLIC_APP_URL || "https://popularcrm.vercel.app"
    ).replace(/\/$/, "");
    // Window: between cutoff+1h and cutoff (e.g. 7h..6h before start)
    const cutoffMs = STUDIO_POLICY.absentNotifyCutoffHours * 60 * 60 * 1000;
    const from = new Date(Date.now() + cutoffMs).toISOString();
    const to = new Date(Date.now() + cutoffMs + 60 * 60 * 1000).toISOString();
    const { data: sessions } = await db
      .from("sessions")
      .select("id, starts_at, group_id, groups(title)")
      .eq("status", "scheduled")
      .gte("starts_at", from)
      .lt("starts_at", to)
      .limit(40);

    let queued = 0;
    for (const session of sessions ?? []) {
      const { data: enrollments } = await db
        .from("enrollments")
        .select("student_person_id")
        .eq("group_id", session.group_id)
        .eq("status", "active");
      for (const enr of enrollments ?? []) {
        const { data: att } = await db
          .from("attendance")
          .select("status")
          .eq("session_id", session.id)
          .eq("student_person_id", enr.student_person_id)
          .maybeSingle();
        if (att?.status === "absent_notified" || att?.status === "absent") {
          continue;
        }
        const { data: recent } = await db
          .from("notifications")
          .select("id")
          .eq("template_code", "attendance.remind_cutoff")
          .eq("recipient_person_id", enr.student_person_id)
          .contains("payload", { sessionId: session.id })
          .limit(1)
          .maybeSingle();
        if (recent) continue;
        const group = Array.isArray(session.groups)
          ? session.groups[0]
          : session.groups;
        try {
          await enqueueBestNotification(db, {
            tenantId:
              getEnv().DEFAULT_TENANT_ID ||
              "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            recipientPersonId: enr.student_person_id,
            templateCode: "attendance.remind_cutoff",
            payload: {
              sessionId: session.id,
              title: group?.title ?? "занятие",
              startsAt: session.starts_at,
              cutoffHours: STUDIO_POLICY.absentNotifyCutoffHours,
              cabinetUrl: `${appUrl}/cabinet/schedule`,
            },
          });
          queued += 1;
        } catch (e) {
          console.error("[cron] attendance reminder skipped", session.id, e);
        }
      }
    }
    return jsonOk({ job, queued, sessions: sessions?.length ?? 0 });
  }

  if (job === "invoice_saldeo_sync") {
    const { getSaldeoSetup } = await import("@/integrations/saldeo");
    const setup = getSaldeoSetup();
    if (!setup.configured) {
      return jsonOk({ job, skipped: "Saldeo не настроен", pending: 0 });
    }
    const { data: pending } = await db
      .from("invoices")
      .select("id, tenant_id")
      .eq("status", "queued")
      .limit(20);
    const { syncInvoiceToSaldeo } = await import("@/domain/invoices");
    let synced = 0;
    let failed = 0;
    for (const inv of pending ?? []) {
      try {
        await syncInvoiceToSaldeo(db, inv.id, inv.tenant_id);
        synced += 1;
      } catch {
        failed += 1;
      }
    }
    return jsonOk({ job, synced, failed });
  }

  if (job === "invoice_saldeo_refresh") {
    const { getSaldeoSetup } = await import("@/integrations/saldeo");
    const setup = getSaldeoSetup();
    if (!setup.configured) {
      return jsonOk({ job, skipped: "Saldeo не настроен", pending: 0 });
    }
    const { data: pending } = await db
      .from("invoices")
      .select("id, tenant_id")
      .eq("status", "sent_to_saldeo")
      .limit(20);
    const { refreshInvoiceFromSaldeo } = await import("@/domain/invoices");
    let issued = 0;
    let waiting = 0;
    let failed = 0;
    for (const inv of pending ?? []) {
      try {
        const result = await refreshInvoiceFromSaldeo(db, inv.id, inv.tenant_id);
        if (result.status === "issued") issued += 1;
        else waiting += 1;
      } catch {
        failed += 1;
      }
    }
    return jsonOk({ job, issued, waiting, failed });
  }

  if (job === "generate_sessions") {
    const { generateSessionsFromRulesDb } = await import("@/domain/schedule");
    const { getEnv } = await import("@/lib/env");
    const tenantId =
      getEnv().DEFAULT_TENANT_ID || "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const result = await generateSessionsFromRulesDb(tenantId, { weeks: 8 });
    return jsonOk({ job, ...result });
  }

  // Hobby plan: one daily cron runs all maintenance jobs
  if (job === "daily") {
    const base = new URL(req.url);
    const auth = req.headers.get("authorization");
    const jobs = [
      "expire_makeup_credits",
      "expire_packages",
      "queue_payment_reminders",
      "queue_attendance_reminders",
      "dispatch_notifications",
      "invoice_saldeo_sync",
      "invoice_saldeo_refresh",
      "generate_sessions",
    ] as const;
    const results: Record<string, unknown> = {};
    for (const name of jobs) {
      const url = new URL(base.toString());
      url.searchParams.set("job", name);
      const res = await GET(
        new Request(url.toString(), {
          headers: auth ? { authorization: auth } : {},
        }),
      );
      results[name] = await res.json().catch(() => ({ ok: false }));
    }
    return jsonOk({ job, results });
  }

  return jsonError(`Unknown job: ${job}`, 400);
}
