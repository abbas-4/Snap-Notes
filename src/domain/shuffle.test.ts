import { describe, expect, it } from 'vitest';
import { createSeededRandom } from './random';
import { shuffle } from './shuffle';

describe('shuffle', () => {
  it('returns a new array and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input, createSeededRandom(1));

    expect(result).not.toBe(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps every element exactly once', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    const result = shuffle(input, createSeededRandom(42));

    expect(result).toHaveLength(input.length);
    expect([...result].sort()).toEqual([...input].sort());
  });

  it('handles empty and single-item arrays', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(['only'])).toEqual(['only']);
  });

  it('is reproducible with the same seed', () => {
    const input = Array.from({ length: 20 }, (_, i) => i);

    expect(shuffle(input, createSeededRandom(7))).toEqual(shuffle(input, createSeededRandom(7)));
    expect(shuffle(input, createSeededRandom(7))).not.toEqual(
      shuffle(input, createSeededRandom(8)),
    );
  });

  it('produces every ordering of three items with roughly equal frequency', () => {
    const random = createSeededRandom(123);
    const counts = new Map<string, number>();
    const runs = 6000;

    for (let i = 0; i < runs; i++) {
      const key = shuffle(['a', 'b', 'c'], random).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    expect(counts.size).toBe(6);
    for (const count of counts.values()) {
      // Each of the 6 orderings should appear about 1000 times.
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });
});
