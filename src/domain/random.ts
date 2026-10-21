/** Returns a number in [0, 1), like `Math.random`. Injected so results can be reproduced in tests. */
export type RandomFn = () => number;

/**
 * Small deterministic generator (mulberry32). The same seed always yields the
 * same sequence, which makes shuffles and quizzes reproducible in tests.
 */
export function createSeededRandom(seed: number): RandomFn {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
