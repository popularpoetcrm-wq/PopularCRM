import { jsonError, jsonOk } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { hasSupabase } from "@/lib/env";
import { getPersonAvatarUrl, uploadPersonAvatarDb } from "@/lib/avatars";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (!hasSupabase() || user.mode === "demo") {
    return jsonOk({ url: null });
  }
  try {
    return jsonOk({ url: await getPersonAvatarUrl(user.personId) });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 500);
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (!hasSupabase() || user.mode === "demo") {
    return jsonError("Avatar upload requires Supabase", 501);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("file required");

  try {
    const bytes = await file.arrayBuffer();
    const result = await uploadPersonAvatarDb({
      tenantId: user.tenantId,
      personId: user.personId,
      bytes,
      contentType: file.type || "image/jpeg",
    });
    return jsonOk(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
