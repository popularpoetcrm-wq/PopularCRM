import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { completeDemoPayment, getExtendedDemo } from "@/lib/demo-ops";
import { afterTrialOrEventPaid } from "@/lib/demo-onboarding";

const schema = z.object({
  paymentId: z.string().min(1),
});

function finish(paymentId: string) {
  const payment = completeDemoPayment(paymentId);
  const invite = afterTrialOrEventPaid(payment.id);
  return { ...payment, invite };
}

/** Demo P24 complete — no external keys needed. Trial/event → auto-invite. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const url = new URL(req.url);
  const paymentId = parsed.success
    ? parsed.data.paymentId
    : url.searchParams.get("paymentId") || url.searchParams.get("sessionId");

  if (!paymentId) return jsonError("paymentId required");

  try {
    return jsonOk(finish(paymentId));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 404);
  }
}

export async function GET(req: Request) {
  const paymentId = new URL(req.url).searchParams.get("paymentId");
  if (!paymentId) {
    return jsonOk({
      pending: getExtendedDemo().payments.filter((p) =>
        ["pending", "partial"].includes(p.status),
      ),
    });
  }
  try {
    return jsonOk(finish(paymentId));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 404);
  }
}
