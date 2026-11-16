import { describe, expect, it } from 'vitest';
import { readGenerationReply, replySchemas } from './generation';

const reply = {
  ok: true,
  cards: [
    {
      kind: 'qa',
      difficulty: 'easy',
      question: 'Q?',
      answer: 'A',
      choices: [],
      evidence: 'Some evidence here.',
    },
  ],
  requested: 1,
  discarded: { invalid: 0, ungrounded: 0, duplicate: 0 },
  quota: { remainingHour: 3, remainingDay: 10 },
};

describe('reading replies from the generation server', () => {
  it('accepts a reply that matches the contract', () => {
    expect(readGenerationReply(replySchemas.generate, 200, reply)).toEqual({
      ok: true,
      value: reply,
    });
  });

  it('refuses a success reply that does not match, as a whole', () => {
    const odd = { ...reply, cards: [{ ...reply.cards[0], kind: 'essay' }] };
    expect(readGenerationReply(replySchemas.generate, 200, odd)).toMatchObject({
      ok: false,
      code: 'malformed-response',
    });
    expect(readGenerationReply(replySchemas.generate, 200, 'text')).toMatchObject({ ok: false });
  });

  it('keeps the server’s code, message and retry time', () => {
    const error = {
      ok: false,
      error: { code: 'rate-limited', message: 'Wait a while.', retryAfterSeconds: 90 },
    };
    expect(readGenerationReply(replySchemas.generate, 429, error)).toEqual({
      ok: false,
      code: 'rate-limited',
      message: 'Wait a while.',
      retryAfterSeconds: 90,
    });
  });

  it('classifies answers that are not from the function itself', () => {
    expect(readGenerationReply(replySchemas.status, 401, null)).toMatchObject({
      code: 'unauthenticated',
    });
    expect(readGenerationReply(replySchemas.status, 404, 'Function not found')).toMatchObject({
      code: 'not-configured',
    });
    expect(readGenerationReply(replySchemas.status, 502, '<html>')).toMatchObject({
      code: 'provider-unavailable',
    });
  });
});
