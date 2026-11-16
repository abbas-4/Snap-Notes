import type {
  GenerateReply,
  GenerateRequest,
  GeneratedCard,
  StatusReply,
} from '../../supabase/functions/_shared/flashcards/contract.ts';
import {
  CANCELLED,
  type GenerationClient,
  type GenerationFailure,
  type GenerationResult,
} from '../cloud/generation';

type Script = GenerationResult<GenerateReply> | ((request: GenerateRequest) => GenerateReply);

/**
 * A scripted stand-in for the `generate-flashcards` Edge Function, for UI
 * tests. Each `generate` call takes the next scripted answer; a test can also
 * hold a call open with `hold()` to look at the page while it is generating.
 */
export class FakeGeneration implements GenerationClient {
  statusReply: GenerationResult<StatusReply> = {
    ok: true,
    value: { ok: true, configured: true, provider: 'Anthropic (Claude)' },
  };
  requests: GenerateRequest[] = [];
  private script: Script[] = [];
  private held: (() => void) | null = null;
  private holding = false;

  /** Queues the next answer: cards, a failure, or a function of the request. */
  next(answer: Script): this {
    this.script.push(answer);
    return this;
  }

  /** Queues a successful reply carrying these cards. */
  nextCards(cards: GeneratedCard[], discarded = { invalid: 0, ungrounded: 0, duplicate: 0 }) {
    return this.next((request) => ({
      ok: true,
      cards,
      requested: request.count,
      discarded,
      quota: { remainingHour: 19, remainingDay: 59 },
    }));
  }

  nextFailure(failure: Omit<GenerationFailure, 'ok'>) {
    return this.next({ ok: false, ...failure });
  }

  /** The next call waits until `release()`. */
  hold() {
    this.holding = true;
  }

  release() {
    this.holding = false;
    this.held?.();
    this.held = null;
  }

  async status() {
    await Promise.resolve();
    return this.statusReply;
  }

  async generate(
    request: GenerateRequest,
    signal?: AbortSignal,
  ): Promise<GenerationResult<GenerateReply>> {
    this.requests.push(request);
    if (this.holding) {
      await new Promise<void>((resolve) => {
        this.held = resolve;
        signal?.addEventListener('abort', () => resolve());
      });
    } else {
      await Promise.resolve();
    }
    if (signal?.aborted) return CANCELLED;
    const answer = this.script.shift();
    if (answer === undefined) throw new Error('FakeGeneration: no scripted answer left');
    return typeof answer === 'function' ? { ok: true, value: answer(request) } : answer;
  }
}

let counter = 0;

/** A valid generated card whose evidence is `evidence`; pass material containing it. */
export function makeGeneratedCard(overrides: Partial<GeneratedCard> = {}): GeneratedCard {
  counter += 1;
  return {
    kind: 'qa',
    difficulty: 'medium',
    question: `What is concept ${counter}?`,
    answer: `Answer number ${counter}`,
    choices: [],
    evidence: `Concept ${counter} is explained here.`,
    ...overrides,
  };
}
