// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  classifyAnthropicError,
  createAnthropicProvider,
  DEFAULT_ANTHROPIC_MODEL,
} from './anthropic.ts';
import { ProviderError, type ProviderRequest } from './provider.ts';

/**
 * The provider runs through the real Anthropic SDK; only the HTTP layer is
 * replaced, so these tests check the request it sends and how every kind of
 * answer is classified, without a key or a network.
 */

const REQUEST: ProviderRequest = {
  system: 'system prompt',
  prompt: 'user prompt',
  schema: { type: 'object' },
  maxOutputTokens: 1000,
};

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function scripted(status: number, body: unknown, headers: Record<string, string> = {}) {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: DEFAULT_ANTHROPIC_MODEL,
    content: [{ type: 'text', text: '{"cards":[]}' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

describe('the Anthropic provider', () => {
  it('sends the prompt with structured output, explicit effort and refusal fallback', async () => {
    const { fetch, sent } = scripted(200, message());
    const provider = createAnthropicProvider({ apiKey: 'sk-test', fetch });
    const reply = await provider.generate(REQUEST);

    expect(reply).toEqual({ text: '{"cards":[]}', stop: 'complete' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]!.headers.get('authorization')).toBe('Bearer sk-test');
    expect(sent[0]!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(sent[0]!.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1000,
      system: 'system prompt',
      messages: [{ role: 'user', content: 'user prompt' }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: { type: 'object' } },
      },
      fallbacks: 'default',
    });
  });

  it('uses the configured model', async () => {
    const { fetch, sent } = scripted(200, message());
    await createAnthropicProvider({ apiKey: 'k', model: ' claude-sonnet-5-5 ', fetch }).generate(
      REQUEST,
    );
    expect(sent[0]!.body.model).toBe('claude-sonnet-5-5');
  });

  it('joins the text blocks and ignores the rest', async () => {
    const { fetch } = scripted(
      200,
      message({
        content: [
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'text', text: '{"cards":' },
          { type: 'text', text: '[]}' },
        ],
      }),
    );
    const reply = await createAnthropicProvider({ apiKey: 'k', fetch }).generate(REQUEST);
    expect(reply.text).toBe('{"cards":[]}');
  });

  it('reports a reply cut off by the output limit', async () => {
    const { fetch } = scripted(200, message({ stop_reason: 'max_tokens' }));
    expect(await createAnthropicProvider({ apiKey: 'k', fetch }).generate(REQUEST)).toMatchObject({
      stop: 'truncated',
    });
  });

  it('reports a refusal', async () => {
    const { fetch } = scripted(200, message({ stop_reason: 'refusal', content: [] }));
    await expect(
      createAnthropicProvider({ apiKey: 'k', fetch }).generate(REQUEST),
    ).rejects.toMatchObject({ code: 'refused' });
  });

  const errors: Array<[number, Record<string, string>, string, number | undefined]> = [
    [429, { 'retry-after': '17' }, 'unavailable', 17],
    [529, {}, 'unavailable', undefined],
    [500, {}, 'unavailable', undefined],
    [401, {}, 'misconfigured', undefined],
    [403, {}, 'misconfigured', undefined],
    [404, {}, 'misconfigured', undefined],
    [400, {}, 'misconfigured', undefined],
    [413, {}, 'too-large', undefined],
  ];

  it.each(errors)('classifies HTTP %i as %s', async (status, headers, code, retryAfter) => {
    const { fetch, sent } = scripted(
      status,
      { type: 'error', error: { type: 'some_error', message: 'details' } },
      // No automatic retries in this test: the SDK waits before retrying.
      { ...headers, 'x-should-retry': 'false' },
    );
    const provider = createAnthropicProvider({ apiKey: 'k', fetch });
    const error = await provider.generate(REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code, retryAfterSeconds: retryAfter });
    expect(sent).toHaveLength(1);
  });

  it('classifies timeouts and lost connections', () => {
    expect(classifyAnthropicError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({
      code: 'timeout',
    });
    expect(
      classifyAnthropicError(new Anthropic.APIConnectionError({ message: 'socket hang up' })),
    ).toMatchObject({ code: 'unavailable' });
    expect(classifyAnthropicError(new Error('anything else'))).toMatchObject({
      code: 'unavailable',
    });
  });
});
