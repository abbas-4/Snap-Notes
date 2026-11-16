import { createAnthropicProvider } from './anthropic.ts';
import type { AiProvider } from './provider.ts';

/**
 * Reads the Edge Function's settings from its environment (Supabase secrets).
 * See docs/ai-generation.md for how to set them.
 *
 *   AI_PROVIDER          Which provider to use. Only `anthropic` exists today; the default.
 *   ANTHROPIC_API_KEY    The provider's secret key. Without it, generation is switched off.
 *   AI_MODEL             Optional: the model to use instead of the provider's default.
 *   AI_ALLOWED_ORIGINS   Optional: comma-separated origins allowed to call from a browser.
 */

export type Env = (name: string) => string | undefined;

export type ProviderSetup =
  { ok: true; provider: AiProvider | null } | { ok: false; message: string };

export function providerFromEnv(env: Env): ProviderSetup {
  const name = (env('AI_PROVIDER') ?? 'anthropic').trim().toLowerCase();
  if (name !== 'anthropic') {
    return { ok: false, message: `AI_PROVIDER "${name}" is not supported. Use "anthropic".` };
  }
  const apiKey = env('ANTHROPIC_API_KEY')?.trim();
  if (!apiKey) return { ok: true, provider: null };
  return { ok: true, provider: createAnthropicProvider({ apiKey, model: env('AI_MODEL') }) };
}

/** Any origin when unset: every request is authorised by the caller's token, not by cookies. */
export function allowedOriginsFromEnv(env: Env): readonly string[] | '*' {
  const value = env('AI_ALLOWED_ORIGINS')?.trim();
  if (!value || value === '*') return '*';
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin !== '');
}
