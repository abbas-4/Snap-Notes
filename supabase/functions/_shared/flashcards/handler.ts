import {
  LIMITS,
  materialProblem,
  requestSchema,
  type ErrorReply,
  type GenerateReply,
  type GenerationErrorCode,
  type ParsedGenerateRequest,
  type Quota,
  type StatusReply,
} from './contract.ts';
import { buildUserPrompt, MAX_OUTPUT_TOKENS, RESPONSE_SCHEMA, SYSTEM_PROMPT } from './prompt.ts';
import { ProviderError, type AiProvider } from './provider.ts';
import { selectCards } from './quality.ts';

/**
 * The `generate-flashcards` Edge Function, as a plain `Request → Response`
 * function. Everything it talks to (the auth server, the quota function, the
 * AI provider, the log) is passed in, so the same code is tested in Node and
 * served by Deno (see ../../generate-flashcards/index.ts).
 *
 * Order matters:
 *   1. size and shape of the request, before anything is parsed or trusted;
 *   2. who is asking, from their access token;
 *   3. whether a provider is configured at all;
 *   4. one request reserved against the account's allowance;
 *   5. the provider, then every card it wrote checked by `selectCards`.
 * The study material is never logged.
 */

export type ReserveResult =
  | { allowed: true; quota: Quota }
  | {
      allowed: false;
      /** `account`: this user's allowance is used up. `project`: everyone's, together. */
      scope: 'account' | 'project';
      retryAfterSeconds: number;
      quota: Quota;
    };

export interface HandlerDeps {
  /** Checks the caller's access token: their user ID, or null when it is not a valid session. */
  authenticate(authorization: string): Promise<string | null>;
  /** Counts one generation request against the caller's allowance; null when the session is not valid. */
  reserve(authorization: string): Promise<ReserveResult | null>;
  /** Null when no provider is configured. */
  provider: AiProvider | null;
  /** Origins allowed to call from a browser, or '*' for any. */
  allowedOrigins: readonly string[] | '*';
  /** Structured events without any study content. */
  log(event: Record<string, string | number | boolean>): void;
  now?: () => number;
}

const MESSAGES: Record<GenerationErrorCode, string> = {
  unauthenticated: 'Your session has ended. Sign in again to generate cards.',
  'invalid-request': 'That request could not be understood. Reload the page and try again.',
  'input-too-long': `That is more material than can be sent at once. Keep it under ${LIMITS.materialMaxChars.toLocaleString('en')} characters.`,
  'rate-limited': 'You have generated a lot of cards recently. Wait a while, then try again.',
  'not-configured': 'AI card generation is not set up on this Snap Notes server.',
  'provider-unavailable': 'The AI service is busy or unavailable right now. Try again in a minute.',
  timeout:
    'The AI service took too long to answer. Try again, perhaps with less material or fewer cards.',
  'malformed-response':
    'The AI service sent back cards that could not be used. Try again, perhaps with fewer cards.',
  refused: 'The AI service declined to make cards from this material.',
  internal: 'Something went wrong on the server. Try again in a minute.',
};

/** When the whole project, not this account, has reached its generation limit. */
export const PROJECT_LIMIT_MESSAGE =
  'AI card generation is very busy and has paused for now. Try again later.';

const STATUS: Record<GenerationErrorCode, number> = {
  unauthenticated: 401,
  'invalid-request': 400,
  'input-too-long': 413,
  'rate-limited': 429,
  'not-configured': 503,
  'provider-unavailable': 503,
  timeout: 504,
  'malformed-response': 502,
  refused: 422,
  internal: 500,
};

class TooLarge extends Error {}

/** Reads the body, stopping as soon as it passes `maxBytes`, so a huge upload is never held in memory. */
async function readBody(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new TooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;

  function corsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (deps.allowedOrigins === '*') {
      headers['Access-Control-Allow-Origin'] = '*';
    } else {
      headers.Vary = 'Origin';
      if (origin !== null && deps.allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
      }
    }
    return headers;
  }

  function json(body: unknown, status: number, origin: string | null, extra = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extra,
      },
    });
  }

  function fail(
    code: GenerationErrorCode,
    origin: string | null,
    options: { message?: string; retryAfterSeconds?: number } = {},
  ): Response {
    const body: ErrorReply = {
      ok: false,
      error: {
        code,
        message: options.message ?? MESSAGES[code],
        ...(options.retryAfterSeconds ? { retryAfterSeconds: options.retryAfterSeconds } : {}),
      },
    };
    const extra = options.retryAfterSeconds
      ? { 'Retry-After': String(options.retryAfterSeconds) }
      : {};
    return json(body, STATUS[code], origin, extra);
  }

  async function generate(
    request: ParsedGenerateRequest,
    authorization: string,
    origin: string | null,
    provider: AiProvider,
  ): Promise<Response> {
    const started = now();
    const reserved = await deps.reserve(authorization);
    if (reserved === null) return fail('unauthenticated', origin);
    if (!reserved.allowed) {
      deps.log({ event: 'generate', outcome: 'rate-limited', scope: reserved.scope });
      return fail('rate-limited', origin, {
        retryAfterSeconds: reserved.retryAfterSeconds,
        ...(reserved.scope === 'project' ? { message: PROJECT_LIMIT_MESSAGE } : {}),
      });
    }

    let reply;
    try {
      reply = await provider.generate({
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt(request),
        schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
      const failure = error instanceof ProviderError ? error : null;
      deps.log({
        event: 'generate',
        outcome: failure ? `provider-${failure.code}` : 'provider-exception',
        detail: failure?.message ?? 'unexpected',
        ms: now() - started,
      });
      switch (failure?.code) {
        case 'timeout':
          return fail('timeout', origin);
        case 'refused':
          return fail('refused', origin);
        case 'too-large':
          return fail('input-too-long', origin);
        case 'misconfigured':
          return fail('not-configured', origin, {
            message:
              'AI card generation is not available right now because of a problem with the server’s setup.',
          });
        default:
          return fail('provider-unavailable', origin, {
            retryAfterSeconds: failure?.retryAfterSeconds,
          });
      }
    }

    if (reply.stop === 'truncated') {
      deps.log({ event: 'generate', outcome: 'truncated', ms: now() - started });
      return fail('malformed-response', origin, {
        message: 'The AI service’s answer was cut short. Try again with fewer cards.',
      });
    }

    let cards: unknown;
    try {
      cards = (JSON.parse(reply.text) as { cards?: unknown }).cards;
    } catch {
      cards = undefined;
    }
    if (!Array.isArray(cards)) {
      deps.log({ event: 'generate', outcome: 'malformed', ms: now() - started });
      return fail('malformed-response', origin);
    }

    const selection = selectCards(cards, {
      material: request.material,
      avoid: request.avoid,
      count: request.count,
    });
    deps.log({
      event: 'generate',
      outcome: 'ok',
      requested: request.count,
      returned: selection.cards.length,
      invalid: selection.discarded.invalid,
      ungrounded: selection.discarded.ungrounded,
      duplicate: selection.discarded.duplicate,
      ms: now() - started,
    });
    const body: GenerateReply = {
      ok: true,
      cards: selection.cards,
      requested: request.count,
      discarded: selection.discarded,
      quota: reserved.quota,
    };
    return json(body, 200, origin);
  }

  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json(
        { ok: false, error: { code: 'invalid-request', message: 'Use POST.' } },
        405,
        origin,
        {
          Allow: 'POST, OPTIONS',
        },
      );
    }

    try {
      const authorization = request.headers.get('authorization') ?? '';
      if (!/^Bearer \S+$/.test(authorization)) return fail('unauthenticated', origin);

      let text: string;
      try {
        text = await readBody(request, LIMITS.requestMaxBytes);
      } catch (error) {
        if (error instanceof TooLarge) return fail('input-too-long', origin);
        throw error;
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return fail('invalid-request', origin);
      }
      const parsed = requestSchema.safeParse(body);
      if (!parsed.success) return fail('invalid-request', origin);

      if (parsed.data.action === 'generate') {
        const problem = materialProblem(parsed.data.material);
        if (problem !== null) {
          const code =
            parsed.data.material.length > LIMITS.materialMaxChars
              ? 'input-too-long'
              : 'invalid-request';
          return fail(code, origin, { message: problem });
        }
      }

      const userId = await deps.authenticate(authorization);
      if (userId === null) return fail('unauthenticated', origin);

      if (parsed.data.action === 'status') {
        const body: StatusReply = {
          ok: true,
          configured: deps.provider !== null,
          provider: deps.provider?.displayName ?? null,
        };
        return json(body, 200, origin);
      }

      if (deps.provider === null) return fail('not-configured', origin);
      return await generate(parsed.data, authorization, origin, deps.provider);
    } catch {
      deps.log({ event: 'request', outcome: 'exception' });
      return fail('internal', origin);
    }
  };
}
