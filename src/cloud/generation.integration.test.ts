import { beforeAll, describe, expect, it } from 'vitest';
import type { GenerateRequest } from '../../supabase/functions/_shared/flashcards/contract.ts';
import { accessToken, env, newAccount, rest, sql } from '../test/integration';

/**
 * AI generation against the real local stack: the allowance kept in Postgres,
 * and the `generate-flashcards` Edge Function served by the local Edge Runtime.
 *
 * The local stack has no AI provider key (none is ever committed), so these
 * tests check everything up to the provider: authentication, the allowance,
 * request validation, and the "not set up" answer. Generation itself is
 * covered by the handler tests with a scripted provider.
 */

const FUNCTION_URL = `${env.url}/functions/v1/generate-flashcards`;

async function begin(token: string | null) {
  return rest('rpc/ai_generation_begin', { method: 'POST', token, body: {} });
}

async function callFunction(body: unknown, token: string | null) {
  const headers: Record<string, string> = {
    apikey: env.publishableKey,
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

// The project-wide cap counts every account's requests, including earlier runs
// of this suite on the same local stack; start each run from an empty log.
beforeAll(() => {
  sql('delete from snapnotes_private.ai_generation_requests');
});

describe('the generation allowance', () => {
  it('refuses callers who are not signed in', async () => {
    const anonymous = await begin(null);
    expect(anonymous.status).toBeGreaterThanOrEqual(401);
    expect(anonymous.status).toBeLessThan(500);
  });

  it('allows 20 requests an hour per account, then says when to retry', async () => {
    const alice = await newAccount('ai-quota');
    const token = accessToken(alice.services.storage);

    for (let i = 1; i <= 20; i += 1) {
      const result = await begin(token);
      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({
        allowed: true,
        userId: alice.userId,
        remainingHour: 20 - i,
        remainingDay: 60 - i,
      });
    }
    const refused = await begin(token);
    expect(refused.json).toMatchObject({ allowed: false, remainingHour: 0, remainingDay: 40 });
    const wait = (refused.json as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(wait).toBeGreaterThan(3500);
    expect(wait).toBeLessThanOrEqual(3600);

    // Another account has its own allowance.
    const bob = await newAccount('ai-quota-other');
    expect((await begin(accessToken(bob.services.storage))).json).toMatchObject({
      allowed: true,
      remainingHour: 19,
    });
  });

  it('keeps the request log out of reach of the API', async () => {
    const carol = await newAccount('ai-private');
    const token = accessToken(carol.services.storage);
    await begin(token);
    const direct = await rest('ai_generation_requests?select=*', { token });
    // The table is in a schema the API does not serve at all.
    expect(direct.status).toBe(404);
  });
});

describe('the generate-flashcards function', () => {
  const request = {
    action: 'generate',
    material: 'Osmosis is the movement of water across a semi-permeable membrane.',
    count: 5,
    cardType: 'qa',
    difficulty: 'easy',
  } satisfies GenerateRequest;

  it('refuses requests without a valid session', async () => {
    const missing = await callFunction({ action: 'status' }, null);
    expect(missing.status).toBe(401);
    expect(missing.json).toMatchObject({ ok: false, error: { code: 'unauthenticated' } });
    const forged = await callFunction({ action: 'status' }, 'not-a-real-token');
    expect(forged.status).toBe(401);
  });

  it('validates the request before anything else', async () => {
    const dave = await newAccount('ai-validate');
    const token = accessToken(dave.services.storage);
    const invalid = await callFunction({ ...request, count: 500 }, token);
    expect(invalid.status).toBe(400);
    expect(invalid.json).toMatchObject({ error: { code: 'invalid-request' } });
    const tooLong = await callFunction({ ...request, material: 'x'.repeat(30_001) }, token);
    expect(tooLong.status).toBe(413);
  });

  it('reports that no provider is configured, without using the allowance', async () => {
    const erin = await newAccount('ai-status');
    const token = accessToken(erin.services.storage);

    // Through the app's own client, as the Generate page calls it.
    expect(await erin.services.generation.status()).toEqual({
      ok: true,
      value: { ok: true, configured: false, provider: null },
    });
    const generated = await erin.services.generation.generate(request);
    expect(generated).toMatchObject({ ok: false, code: 'not-configured' });

    expect((await begin(token)).json).toMatchObject({ remainingHour: 19 });
  });
});
