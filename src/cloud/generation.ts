import type { z } from 'zod';
import {
  errorReplySchema,
  generateReplySchema,
  statusReplySchema,
  type GenerateReply,
  type GenerateRequest,
  type GenerationErrorCode,
  type StatusReply,
} from '../../supabase/functions/_shared/flashcards/contract.ts';

/**
 * What the app needs to generate cards, independent of how the server is
 * reached. `supabaseServices.ts` implements it by calling the
 * `generate-flashcards` Edge Function with the signed-in user's token; tests
 * use a scripted fake. The browser never talks to an AI provider directly and
 * never holds a provider key.
 */

export type GenerationFailureCode =
  | GenerationErrorCode
  /** The server could not be reached at all. */
  | 'network'
  /** The user cancelled the request. */
  | 'cancelled';

export interface GenerationFailure {
  ok: false;
  code: GenerationFailureCode;
  message: string;
  retryAfterSeconds?: number;
}

export type GenerationResult<T> = { ok: true; value: T } | GenerationFailure;

export interface GenerationClient {
  /** Whether generation is configured on the server, and which provider processes the material. */
  status(): Promise<GenerationResult<StatusReply>>;
  generate(
    request: GenerateRequest,
    signal?: AbortSignal,
  ): Promise<GenerationResult<GenerateReply>>;
}

/** The longest the app waits for cards; the server gives up on the provider before this. */
export const GENERATION_TIMEOUT_MS = 150_000;

export const NETWORK_FAILURE: GenerationFailure = {
  ok: false,
  code: 'network',
  message: 'Snap Notes could not reach the server. Check your connection and try again.',
};

export const TIMEOUT_FAILURE: GenerationFailure = {
  ok: false,
  code: 'timeout',
  message: 'Generating took too long. Try again, perhaps with less material or fewer cards.',
};

export const CANCELLED: GenerationFailure = { ok: false, code: 'cancelled', message: '' };

const UNREADABLE: GenerationFailure = {
  ok: false,
  code: 'malformed-response',
  message: 'The server sent a reply Snap Notes could not read. Try again in a minute.',
};

/**
 * Reads a reply from the Edge Function. A success is validated against the
 * same schema the server used to build it; anything that does not fit is
 * refused as a whole. Errors keep the server's written message, which never
 * contains internal details.
 */
export function readGenerationReply<T>(
  schema: z.ZodType<T>,
  status: number,
  body: unknown,
): GenerationResult<T> {
  if (status >= 200 && status < 300) {
    const parsed = schema.safeParse(body);
    return parsed.success ? { ok: true, value: parsed.data } : UNREADABLE;
  }
  const error = errorReplySchema.safeParse(body);
  if (error.success) {
    const { code, message, retryAfterSeconds } = error.data.error;
    return { ok: false, code, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
  }
  if (status === 401) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Your session has ended. Sign in again to generate cards.',
    };
  }
  if (status === 404) {
    return {
      ok: false,
      code: 'not-configured',
      message: 'AI card generation is not set up on this Snap Notes server.',
    };
  }
  return {
    ok: false,
    code: 'provider-unavailable',
    message: 'The server could not generate cards right now. Try again in a minute.',
  };
}

export const replySchemas = { status: statusReplySchema, generate: generateReplySchema };
