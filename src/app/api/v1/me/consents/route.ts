import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { LEGAL_DOCS, listLegalDocs, type LegalDocKey } from "@/lib/legal";
import {
  acceptConsentsDb,
  getConsentsStatusDb,
} from "@/lib/consents";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  if (!hasSupabase() || user.mode === "demo") {
    return jsonOk({
      docs: listLegalDocs().map((d) => ({
        key: d.key,
        title: d.title,
        version: d.version,
        body: d.body,
        accepted: false,
        needs_accept: true,
      })),
      mode: "demo",
    });
  }

  try {
    return jsonOk({
      docs: await getConsentsStatusDb(user.personId),
      mode: user.mode,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 500);
  }
}

const bodySchema = z.object({
  keys: z
    .array(z.enum(["studio_offer", "photo_marketing"]))
    .min(1)
    .optional(),
  acceptAll: z.boolean().optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (!hasSupabase() || user.mode === "demo") {
    return jsonError("Consents require Supabase", 501);
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid payload");

  const keys = (
    parsed.data.acceptAll
      ? (Object.keys(LEGAL_DOCS) as LegalDocKey[])
      : parsed.data.keys
  ) as LegalDocKey[] | undefined;
  if (!keys?.length) return jsonError("keys required");

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip");
  const userAgent = req.headers.get("user-agent");

  try {
    const docs = await acceptConsentsDb({
      personId: user.personId,
      tenantId: user.tenantId,
      keys,
      ip,
      userAgent,
    });
    return jsonOk({ docs });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
