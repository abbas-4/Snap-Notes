/**
 * What the Edge Function needs from an AI provider: given a system prompt, a
 * user message and a JSON Schema, return the JSON text the model wrote. Each
 * provider lives in its own file and is chosen by `AI_PROVIDER`; nothing else
 * on the server, and nothing in the browser, knows which one is in use.
 */

export interface ProviderRequest {
  system: string;
  prompt: string;
  /** The reply must be JSON matching this schema. */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface ProviderReply {
  /** The model's reply: JSON text, not yet parsed or trusted. */
  text: string;
  /** `truncated` when the reply hit the output limit, so its JSON is incomplete. */
  stop: 'complete' | 'truncated';
}

export interface AiProvider {
  /** Shown to the user, so they know where their material is processed. */
  readonly displayName: string;
  generate(request: ProviderRequest): Promise<ProviderReply>;
}

export type ProviderErrorCode =
  /** Rate limited, overloaded or unreachable: worth trying again later. */
  | 'unavailable'
  | 'timeout'
  /** The provider declined the request, for example on a policy ground. */
  | 'refused'
  /** The material is larger than the provider accepts. */
  | 'too-large'
  /** The server's own setup is wrong: a bad key, an unknown model, a refused parameter. */
  | 'misconfigured';

/** A provider failure, classified. `detail` is for server logs only and never reaches the user. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ProviderErrorCode, detail: string, retryAfterSeconds?: number) {
    super(detail);
    this.name = 'ProviderError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
