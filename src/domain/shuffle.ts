import type { RandomFn } from './random';

/** Fisher–Yates shuffle. Returns a new array and never mutates the input. */
export function shuffle<T>(items: readonly T[], random: RandomFn = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}
