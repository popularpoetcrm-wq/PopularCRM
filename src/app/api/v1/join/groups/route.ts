import { jsonError, jsonOk } from "@/lib/api";
import { hasSupabase } from "@/lib/env";
import { listJoinGroupsDb } from "@/lib/join-claim";
import type { BrandId } from "@/lib/brands";

export async function GET(req: Request) {
  if (!hasSupabase()) return jsonError("Supabase required", 501);
  const brand = new URL(req.url).searchParams.get("brand") as BrandId | null;
  try {
    const groups = await listJoinGroupsDb(brand || undefined);
    return jsonOk({ groups });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 500);
  }
}
