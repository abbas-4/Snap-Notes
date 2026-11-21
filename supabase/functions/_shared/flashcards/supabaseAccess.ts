import { z } from 'zod';
import type { ReserveResult } from './handler.ts';

/**
 * How the Edge Function checks who is calling and counts their requests, using
 * the project's own auth server and database with the caller's token. It never
 * needs the service-role key: the database function decides whose allowance to
 * use from the verified token, exactly as the sync functions do.
 */

export interface SupabaseAccessOptions {
  /** The project URL, which Supabase provides to every Edge Function as SUPABASE_URL. */
  url: string;
  /** The project's publishable (anon) key, provided as SUPABASE_ANON_KEY. */
  publishableKey: string;
  fetch?: typeof fetch;
}

const TIMEOUT_MS = 10_000;

const userSchema = z.object({ id: z.string().min(1) });

const reserveSchema = z.object({
  allowed: z.boolean(),
  /** Which allowance refused the request; sent by the database since the security hardening migration. */
  reason: z.enum(['account', 'project']).optional(),
  userId: z.string(),
  retryAfterSeconds: z.number().int().nonnegative(),
  remainingHour: z.number().int().nonnegative(),
  remainingDay: z.number().int().nonnegative(),
});

/** The token was refused: an expired, revoked or forged session. */
function isRefused(status: number): boolean {
  return status === 401 || status === 403;
}

export function createSupabaseAccess(options: SupabaseAccessOptions) {
  const call = options.fetch ?? fetch;
  const base = options.url.replace(/\/+$/, '');

  return {
    async authenticate(authorization: string): Promise<string | null> {
      const response = await call(`${base}/auth/v1/user`, {
        headers: { apikey: options.publishableKey, Authorization: authorization },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (isRefused(response.status)) return null;
      if (!response.ok) throw new Error(`auth server answered ${response.status}`);
      const user = userSchema.safeParse(await response.json());
      return user.success ? user.data.id : null;
    },

    async reserve(authorization: string): Promise<ReserveResult | null> {
      const response = await call(`${base}/rest/v1/rpc/ai_generation_begin`, {
        method: 'POST',
        headers: {
          apikey: options.publishableKey,
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (isRefused(response.status)) return null;
      if (!response.ok) throw new Error(`database answered ${response.status}`);
      const parsed = reserveSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('database sent an unexpected reply');
      const { allowed, reason, retryAfterSeconds, remainingHour, remainingDay } = parsed.data;
      const quota = { remainingHour, remainingDay };
      return allowed
        ? { allowed: true, quota }
        : {
            allowed: false,
            scope: reason ?? 'account',
            retryAfterSeconds: Math.max(1, retryAfterSeconds),
            quota,
          };
    },
  };
}
