import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv, hasSupabase } from "@/lib/env";

let admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (!hasSupabase()) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  if (admin) return admin;
  const env = getEnv();
  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export function tryGetAdminClient(): SupabaseClient | null {
  try {
    return getAdminClient();
  } catch {
    return null;
  }
}
