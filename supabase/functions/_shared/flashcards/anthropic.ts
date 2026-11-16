import Anthropic from '@anthropic-ai/sdk';
import {
  ProviderError,
  type AiProvider,
  type ProviderReply,
  type ProviderRequest,
} from './provider.ts';

/**
 * The Anthropic (Claude) provider, through the official SDK. The API key is
 * read from the Edge Function's secrets by the caller and never leaves the
 * server.
 */

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/** A single request may take this long before it is abandoned. */
const REQUEST_TIMEOUT_MS = 60_000;

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  /** For tests: a stand-in for the HTTP layer. */
  fetch?: typeof fetch;
}

function retryAfter(headers: Headers | undefined): number | undefined {
  const value = Number(headers?.get('retry-after'));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined;
}

/** Sorts the SDK's typed errors into what the app can tell the user. */
export function classifyAnthropicError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  // Most specific first: a timeout is also a connection error.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('timeout', 'request timed out');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('unavailable', 'could not connect');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError('unavailable', 'rate limited (429)', retryAfter(error.headers));
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError('misconfigured', 'API key rejected (401)');
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError('misconfigured', 'permission denied (403)');
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new ProviderError('misconfigured', 'model not found (404)');
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    if (status === 413) return new ProviderError('too-large', 'request too large (413)');
    // 500 api_error and 529 overloaded_error are worth retrying later.
    if (status !== undefined && status >= 500) {
      return new ProviderError(
        'unavailable',
        `server error (${status})`,
        retryAfter(error.headers),
      );
    }
    return new ProviderError('misconfigured', `request rejected (${status ?? 'no status'})`);
  }
  return new ProviderError('unavailable', 'unexpected failure');
}

export function createAnthropicProvider(options: AnthropicOptions): AiProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    // One automatic retry for 429, 5xx and dropped connections; the user can retry after that.
    maxRetries: 1,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const model = options.model?.trim() || DEFAULT_ANTHROPIC_MODEL;

  return {
    displayName: 'Anthropic (Claude)',
    async generate(request: ProviderRequest): Promise<ProviderReply> {
      let message;
      try {
        message = await client.beta.messages.create({
          model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
          // Structured outputs: the reply is JSON that matches the schema.
          // Effort set explicitly: writing cards needs care, not maximum depth.
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: request.schema },
          },
          // If the model declines on a policy ground, the API retries on its
          // default fallback model within the same request.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (error) {
        throw classifyAnthropicError(error);
      }

      if (message.stop_reason === 'refusal') {
        throw new ProviderError('refused', 'the model declined the request');
      }
      const text = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      return { text, stop: message.stop_reason === 'max_tokens' ? 'truncated' : 'complete' };
    },
  };
}
