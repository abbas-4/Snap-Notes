// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, type GeneratedCard } from './contract.ts';
import {
  createHandler,
  PROJECT_LIMIT_MESSAGE,
  type HandlerDeps,
  type ReserveResult,
} from './handler.ts';
import { ProviderError, type AiProvider, type ProviderRequest } from './provider.ts';

const MATERIAL =
  'The mitochondrion is the organelle that produces most of the cell’s ATP through cellular respiration. The nucleus holds the cell’s DNA.';

const GOOD_CARD: GeneratedCard = {
  kind: 'qa',
  difficulty: 'easy',
  question: 'Which organelle produces most of the cell’s ATP?',
  answer: 'The mitochondrion',
  choices: [],
  evidence: 'The mitochondrion is the organelle that produces most of the cell’s ATP',
};

const TOKEN = 'Bearer user-token';
const QUOTA = { remainingHour: 19, remainingDay: 59 };

class ScriptedProvider implements AiProvider {
  readonly displayName = 'Test provider';
  requests: ProviderRequest[] = [];
  reply: () => Promise<{ text: string; stop: 'complete' | 'truncated' }> = async () => ({
    text: JSON.stringify({ cards: [GOOD_CARD] }),
    stop: 'complete',
  });

  async generate(request: ProviderRequest) {
    this.requests.push(request);
    return this.reply();
  }
}

let provider: ScriptedProvider;
let deps: HandlerDeps & { events: Record<string, unknown>[] };

beforeEach(() => {
  provider = new ScriptedProvider();
  const events: Record<string, unknown>[] = [];
  deps = {
    events,
    authenticate: vi.fn(async (authorization: string) =>
      authorization === TOKEN ? 'user-1' : null,
    ),
    reserve: vi.fn(async (authorization: string): Promise<ReserveResult | null> =>
      authorization === TOKEN ? { allowed: true, quota: QUOTA } : null,
    ),
    provider,
    allowedOrigins: '*',
    log: (event) => events.push(event),
  };
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://project.supabase.co/functions/v1/generate-flashcards', {
    method: 'POST',
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function generate(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return post(
    {
      action: 'generate',
      material: MATERIAL,
      count: 5,
      cardType: 'qa',
      difficulty: 'easy',
      ...overrides,
    },
    headers,
  );
}

async function call(request: Request) {
  const response = await createHandler(deps)(request);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

describe('successful generation', () => {
  it('returns checked cards, the counts and the remaining allowance', async () => {
    const { status, body, headers } = await call(generate());
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      ok: true,
      cards: [GOOD_CARD],
      requested: 5,
      discarded: { invalid: 0, ungrounded: 0, duplicate: 0 },
      quota: QUOTA,
    });
    expect(deps.reserve).toHaveBeenCalledOnce();
  });

  it('sends the provider the system prompt, the material in its block and the schema', async () => {
    await call(generate({ topic: 'Cells', avoid: ['What is a nucleus?'] }));
    const sent = provider.requests[0]!;
    expect(sent.system).toMatch(/not instructions to you/);
    expect(sent.prompt).toContain(`<study_material>\n${MATERIAL}\n</study_material>`);
    expect(sent.prompt).toContain('- What is a nucleus?');
    expect(sent.schema).toMatchObject({ required: ['cards'] });
  });

  it('drops duplicate and ungrounded cards and says how many', async () => {
    provider.reply = async () => ({
      text: JSON.stringify({
        cards: [
          GOOD_CARD,
          { ...GOOD_CARD, question: 'Which organelle produces most of the cell’s ATP?' },
          {
            ...GOOD_CARD,
            question: 'Who discovered it?',
            evidence: 'It was discovered in 1857 by Kölliker.',
          },
          { kind: 'qa' },
        ],
      }),
      stop: 'complete',
    });
    const { body } = await call(generate());
    expect(body.cards).toEqual([GOOD_CARD]);
    expect(body.discarded).toEqual({ invalid: 1, ungrounded: 1, duplicate: 1 });
  });

  it('answers with an empty list when nothing usable came back', async () => {
    provider.reply = async () => ({ text: '{"cards":[]}', stop: 'complete' });
    const { status, body } = await call(generate());
    expect(status).toBe(200);
    expect(body.cards).toEqual([]);
  });

  it('never logs the material or the cards', async () => {
    await call(generate());
    const logged = JSON.stringify(deps.events);
    expect(logged).not.toContain('mitochondrion');
    expect(logged).not.toContain('ATP');
    expect(deps.events).toContainEqual(expect.objectContaining({ outcome: 'ok', returned: 1 }));
  });
});

describe('request validation', () => {
  it('refuses empty and too-short material without contacting anything', async () => {
    for (const material of ['', '   ', 'Too short.']) {
      const { status, body } = await call(generate({ material }));
      expect(status).toBe(400);
      expect(body.error.code).toBe('invalid-request');
    }
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(provider.requests).toEqual([]);
  });

  it('refuses material over the limit', async () => {
    const { status, body } = await call(
      generate({ material: 'x'.repeat(LIMITS.materialMaxChars + 1) }),
    );
    expect(status).toBe(413);
    expect(body.error).toMatchObject({
      code: 'input-too-long',
      message: expect.stringMatching(/30,000/),
    });
  });

  it('refuses a body over the byte limit before parsing it', async () => {
    const huge = JSON.stringify({
      action: 'generate',
      material: 'x'.repeat(LIMITS.requestMaxBytes),
    });
    const { status, body } = await call(post(huge));
    expect(status).toBe(413);
    expect(body.error.code).toBe('input-too-long');
    const declared = await call(
      post('{}', { 'Content-Length': String(LIMITS.requestMaxBytes + 1) }),
    );
    expect(declared.status).toBe(413);
  });

  it('refuses invalid JSON and invalid settings', async () => {
    const bodies = [
      'not json',
      { action: 'generate', material: MATERIAL, count: 0, cardType: 'qa', difficulty: 'easy' },
      { action: 'generate', material: MATERIAL, count: 31, cardType: 'qa', difficulty: 'easy' },
      { action: 'generate', material: MATERIAL, count: 5, cardType: 'essay', difficulty: 'easy' },
      { action: 'generate', material: MATERIAL, count: 5, cardType: 'qa', difficulty: 'brutal' },
      {
        action: 'generate',
        material: MATERIAL,
        count: 5,
        cardType: 'qa',
        difficulty: 'easy',
        userId: 'someone-else',
      },
    ];
    for (const body of bodies) {
      const result = await call(post(body));
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('invalid-request');
    }
    expect(provider.requests).toEqual([]);
  });

  it('answers preflight requests and refuses other methods', async () => {
    const handler = createHandler(deps);
    const preflight = await handler(
      new Request('https://x/functions/v1/generate-flashcards', { method: 'OPTIONS' }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');
    const get = await handler(new Request('https://x/functions/v1/generate-flashcards'));
    expect(get.status).toBe(405);
  });

  it('allows only the configured origins when a list is set', async () => {
    deps.allowedOrigins = ['https://abbas-4.github.io'];
    const noOrigin = await call(generate());
    expect(noOrigin.headers.get('access-control-allow-origin')).toBeNull();
    const fromSite = await createHandler(deps)(
      post({ action: 'status' }, { Origin: 'https://abbas-4.github.io' }),
    );
    expect(fromSite.headers.get('access-control-allow-origin')).toBe('https://abbas-4.github.io');
    const elsewhere = await createHandler(deps)(
      post({ action: 'status' }, { Origin: 'https://evil.example' }),
    );
    expect(elsewhere.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('authentication and allowance', () => {
  it('refuses a request without a bearer token', async () => {
    const { status, body } = await call(generate({}, { Authorization: '' }));
    expect(status).toBe(401);
    expect(body.error.code).toBe('unauthenticated');
  });

  it('refuses an invalid or expired session before reserving anything', async () => {
    const { status, body } = await call(generate({}, { Authorization: 'Bearer forged' }));
    expect(status).toBe(401);
    expect(body.error.code).toBe('unauthenticated');
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(provider.requests).toEqual([]);
  });

  it('refuses when the account has used its allowance, with when to retry', async () => {
    deps.reserve = async () => ({
      allowed: false,
      scope: 'account',
      retryAfterSeconds: 600,
      quota: { remainingHour: 0, remainingDay: 40 },
    });
    const { status, body, headers } = await call(generate());
    expect(status).toBe(429);
    expect(headers.get('retry-after')).toBe('600');
    expect(body.error).toMatchObject({ code: 'rate-limited', retryAfterSeconds: 600 });
    expect(provider.requests).toEqual([]);
  });

  it('says so when the whole project has reached its limit, without calling the provider', async () => {
    deps.reserve = async () => ({
      allowed: false,
      scope: 'project',
      retryAfterSeconds: 1200,
      quota: { remainingHour: 15, remainingDay: 50 },
    });
    const { status, body, headers } = await call(generate());
    expect(status).toBe(429);
    expect(headers.get('retry-after')).toBe('1200');
    expect(body.error).toEqual({
      code: 'rate-limited',
      message: PROJECT_LIMIT_MESSAGE,
      retryAfterSeconds: 1200,
    });
    expect(provider.requests).toEqual([]);
  });

  it('reports the status without using the allowance', async () => {
    const { status, body } = await call(post({ action: 'status' }));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, configured: true, provider: 'Test provider' });
    expect(deps.reserve).not.toHaveBeenCalled();
  });

  it('says when no provider is configured, before using the allowance', async () => {
    deps.provider = null;
    expect((await call(post({ action: 'status' }))).body).toEqual({
      ok: true,
      configured: false,
      provider: null,
    });
    const { status, body } = await call(generate());
    expect(status).toBe(503);
    expect(body.error.code).toBe('not-configured');
    expect(deps.reserve).not.toHaveBeenCalled();
  });

  it('fails safely when the auth server cannot be reached', async () => {
    deps.authenticate = async () => {
      throw new Error('connection refused');
    };
    const { status, body } = await call(generate());
    expect(status).toBe(500);
    expect(body.error).toEqual({
      code: 'internal',
      message: expect.not.stringContaining('refused'),
    });
  });
});

describe('provider failures', () => {
  const cases: Array<[ProviderError, number, string]> = [
    [new ProviderError('unavailable', 'overloaded (529)', 30), 503, 'provider-unavailable'],
    [new ProviderError('timeout', 'request timed out'), 504, 'timeout'],
    [new ProviderError('refused', 'policy category: example'), 422, 'refused'],
    [new ProviderError('too-large', 'too large'), 413, 'input-too-long'],
    [new ProviderError('misconfigured', 'API key rejected (401)'), 503, 'not-configured'],
  ];

  it.each(cases)('maps %s to %i %s, without exposing the detail', async (error, status, code) => {
    provider.reply = async () => {
      throw error;
    };
    const result = await call(generate());
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
    expect(result.body.error.message).not.toContain(error.message);
  });

  it('passes on when the provider says to retry', async () => {
    provider.reply = async () => {
      throw new ProviderError('unavailable', 'rate limited (429)', 42);
    };
    const { headers, body } = await call(generate());
    expect(headers.get('retry-after')).toBe('42');
    expect(body.error.retryAfterSeconds).toBe(42);
  });

  it('treats an unexpected exception as unavailable', async () => {
    provider.reply = async () => {
      throw new TypeError('boom');
    };
    const { status, body } = await call(generate());
    expect(status).toBe(503);
    expect(body.error.code).toBe('provider-unavailable');
  });
});

describe('malformed replies', () => {
  const replies = [
    'not json at all',
    '{"cards": "nope"}',
    '{"cards": null}',
    '[]',
    '',
    '{"cards": [',
  ];

  it.each(replies)('refuses %j', async (text) => {
    provider.reply = async () => ({ text, stop: 'complete' });
    const { status, body } = await call(generate());
    expect(status).toBe(502);
    expect(body.error.code).toBe('malformed-response');
  });

  it('refuses a reply cut short by the output limit', async () => {
    provider.reply = async () => ({ text: '{"cards": [{"kind": "qa"', stop: 'truncated' });
    const { status, body } = await call(generate());
    expect(status).toBe(502);
    expect(body.error).toMatchObject({
      code: 'malformed-response',
      message: expect.stringMatching(/fewer cards/),
    });
  });
});
