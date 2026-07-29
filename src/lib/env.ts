import { z } from "zod";

export const envSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  /** New Supabase dashboard "publishable" key — treated as anon if anon empty */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /** Seed UUIDs may be non-RFC (e.g. aaaa…); accept any uuid-shaped string. */
  DEFAULT_TENANT_ID: z
    .string()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      "Invalid tenant id",
    )
    .optional(),

  P24_MERCHANT_ID: z.string().optional(),
  P24_POS_ID: z.string().optional(),
  P24_CRC: z.string().optional(),
  P24_API_KEY: z.string().optional(),
  P24_SANDBOX: z.string().optional().default("true"),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  SALDEO_API_URL: z.string().optional(),
  SALDEO_USERNAME: z.string().optional(),
  SALDEO_API_TOKEN: z.string().optional(),
  SALDEO_COMPANY_PROGRAM_ID: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional().default("Studio CRM <noreply@example.com>"),

  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  cached = envSchema.parse(process.env);
  if (!cached.NEXT_PUBLIC_SUPABASE_ANON_KEY && cached.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    cached = {
      ...cached,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: cached.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    };
  }
  return cached;
}

export function hasSupabase(): boolean {
  const e = getEnv();
  return Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY);
}

/** URL + anon/publishable present (client-side / light checks). */
export function hasSupabasePublic(): boolean {
  const e = getEnv();
  return Boolean(
    e.NEXT_PUBLIC_SUPABASE_URL &&
      (e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  );
}
