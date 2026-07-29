import { jsonError, jsonOk } from "@/lib/api";
import { hasSupabase } from "@/lib/env";
import { claimJoinContactDb } from "@/lib/join-claim";

export async function POST(req: Request) {
  if (!hasSupabase()) return jsonError("Supabase required", 501);
  try {
    const body = await req.json();
    const result = await claimJoinContactDb(body);
    return jsonOk(result);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 400);
  }
}
