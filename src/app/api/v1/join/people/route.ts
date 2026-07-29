import { jsonError, jsonOk } from "@/lib/api";
import { hasSupabase } from "@/lib/env";
import { listJoinCandidatesDb } from "@/lib/join-claim";

export async function GET(req: Request) {
  if (!hasSupabase()) return jsonError("Supabase required", 501);
  const groupId = new URL(req.url).searchParams.get("groupId");
  if (!groupId) return jsonError("groupId required");
  try {
    const people = await listJoinCandidatesDb({ groupId, includeAll: false });
    return jsonOk({ people });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "fail", 500);
  }
}
