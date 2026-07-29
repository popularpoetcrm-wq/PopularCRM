import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getExtendedDemo } from "@/lib/demo-ops";
import { startGuestCheckout } from "@/lib/demo-onboarding";

const schema = z.object({
  offer_id: z.string().min(1),
  email: z.string().email(),
  full_name: z.string().min(2),
  phone: z.string().optional(),
});

/** Public: trial/event checkout without prior account. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return jsonError("Invalid payload");
  try {
    const result = startGuestCheckout(parsed.data);
    return jsonOk(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}

export async function GET() {
  const offers = getExtendedDemo().offers.filter((o) => o.status === "open");
  return jsonOk(offers);
}
