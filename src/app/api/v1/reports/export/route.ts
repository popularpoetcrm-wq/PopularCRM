import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { getDemoState } from "@/lib/demo-store";
import { getExtendedDemo } from "@/lib/demo-ops";
import { cookies } from "next/headers";
import type { BrandId } from "@/lib/brands";
import { countExpectedAttendees } from "@/lib/demo-attendance";
import { isStaff, isAdmin, isTeacherOnly } from "@/lib/auth";
import { formatBirthDay } from "@/lib/format-date";

function csvEscape(v: unknown) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: unknown[][]) {
  return [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !isStaff(user.roles)) return jsonError("Forbidden", 403);

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "debt";
  const jar = await cookies();
  const tab = (jar.get("admin_brand_tab")?.value as BrandId) || "poet";

  if (isTeacherOnly(user.roles) && !["week", "attendance"].includes(type)) {
    return jsonError("Forbidden", 403);
  }
  if (!isAdmin(user.roles) && !["week", "attendance"].includes(type)) {
    return jsonError("Forbidden", 403);
  }

  const state = getDemoState();
  const ext = getExtendedDemo();

  if (type === "debt") {
    const rows = state.payments
      .filter(
        (p) =>
          (p.brand_id === tab || !p.brand_id) &&
          ["pending", "partial"].includes(p.status),
      )
      .map((p) => {
        const person = state.persons.find((x) => x.id === p.payer_person_id);
        return [
          person?.full_name ?? "",
          person?.email ?? "",
          p.amount,
          p.amount_paid,
          p.amount - p.amount_paid,
          p.status,
          p.payment_method,
          p.description,
        ];
      });
    const csv = toCsv(
      ["name", "email", "amount", "paid", "debt", "status", "method", "description"],
      rows,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="debt.csv"',
      },
    });
  }

  if (type === "attendance") {
    const rows = state.attendance.map((a) => {
      const person = state.persons.find((x) => x.id === a.student_person_id);
      const session = state.sessions.find((s) => s.id === a.session_id);
      return [
        a.session_id,
        session?.title ?? "",
        session?.starts_at ?? "",
        person?.full_name ?? "",
        a.status,
      ];
    });
    const csv = toCsv(
      ["session_id", "title", "starts_at", "student", "status"],
      rows,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="attendance.csv"',
      },
    });
  }

  if (type === "students") {
    const groupIds = new Set(
      state.groups.filter((g) => g.brand_id === tab).map((g) => g.id),
    );
    const rows = state.enrollments
      .filter((e) => groupIds.has(e.group_id) && e.status === "active")
      .map((e) => {
        const person = state.persons.find((p) => p.id === e.student_person_id);
        const group = state.groups.find((g) => g.id === e.group_id);
        const payment = state.payments.find((p) => p.enrollment_id === e.id);
        const pkg = state.packages.find((p) => p.enrollment_id === e.id);
        return [
          person?.full_name ?? "",
          person?.email ?? "",
          person?.phone ?? "",
          person?.tshirt_size ?? "",
          person?.birth_date ? formatBirthDay(person.birth_date) : "",
          group?.title ?? "",
          payment?.amount ?? "",
          payment?.amount_paid ?? "",
          payment?.status ?? "",
          pkg ? `${pkg.credits_available}/${pkg.credits_total}` : "",
        ];
      });
    const csv = toCsv(
      [
        "name",
        "email",
        "phone",
        "tshirt",
        "birth_date",
        "group",
        "amount",
        "paid",
        "pay_status",
        "credits",
      ],
      rows,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="students.csv"',
      },
    });
  }

  if (type === "makeups") {
    const rows = state.makeups.map((m) => {
      const person = state.persons.find((p) => p.id === m.student_person_id);
      return [
        m.id,
        person?.full_name ?? "",
        m.status,
        m.valid_until,
        m.target_session_id ?? "",
      ];
    });
    const csv = toCsv(
      ["id", "student", "status", "valid_until", "target_session"],
      rows,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="makeups.csv"',
      },
    });
  }

  if (type === "audit") {
    const rows = ext.audit.slice(0, 200).map((a) => [
      a.created_at,
      a.action,
      a.entity_type,
      a.entity_id ?? "",
      a.actor ?? "",
    ]);
    const csv = toCsv(
      ["created_at", "action", "entity_type", "entity_id", "actor"],
      rows,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="audit.csv"',
      },
    });
  }

  if (type === "week") {
    const now = Date.now();
    const week = now + 7 * 24 * 3600 * 1000;
    const rows = state.sessions
      .filter((s) => {
        const t = new Date(s.starts_at).getTime();
        if (t < now || t > week) return false;
        const g = state.groups.find((x) => x.id === s.group_id);
        return !tab || g?.brand_id === tab;
      })
      .map((s) => {
        const g = state.groups.find((x) => x.id === s.group_id);
        const c = countExpectedAttendees(s.id);
        return [
          s.starts_at,
          g?.title ?? s.title,
          s.status,
          c.coming,
          c.wontCome,
          c.total,
          c.coming < 2 ? "RISK" : "ok",
        ];
      });
    const csv = toCsv(
      ["starts_at", "group", "status", "coming", "wont_come", "total", "hold"],
      rows,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="week.csv"',
      },
    });
  }

  return jsonError("Unknown report type", 400);
}
