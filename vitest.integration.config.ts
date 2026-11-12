import { defineConfig } from 'vitest/config';

// Integration tests run in Node against a real Supabase stack; see scripts/test-integration.mjs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // One account at a time keeps the auth server's rate limits out of the way.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
