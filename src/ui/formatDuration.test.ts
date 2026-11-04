import { describe, expect, it } from 'vitest';
import { formatElapsed, spokenDuration } from './formatDuration';

describe('formatElapsed', () => {
  it('shows minutes and zero-padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(5_999)).toBe('0:05');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(754_000)).toBe('12:34');
  });

  it('adds hours past an hour', () => {
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
  });

  it('never goes negative', () => {
    expect(formatElapsed(-500)).toBe('0:00');
  });
});

describe('spokenDuration', () => {
  it('names each unit, singular or plural, skipping zeros', () => {
    expect(spokenDuration(0)).toBe('0 seconds');
    expect(spokenDuration(1_000)).toBe('1 second');
    expect(spokenDuration(65_000)).toBe('1 minute 5 seconds');
    expect(spokenDuration(120_000)).toBe('2 minutes');
    expect(spokenDuration(3_601_000)).toBe('1 hour 1 second');
  });
});
