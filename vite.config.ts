/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { contentSecurityPolicy } from './src/security/csp';

/** Adds the Content Security Policy and referrer policy to the built index.html (not `vite dev`). */
function securityMetaTags(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'snap-notes-security-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: contentSecurityPolicy(supabaseUrl),
          },
          injectTo: 'head-prepend',
        },
        // Links to other sites never carry the app's address (which can hold an auth code).
        { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head' },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    // GitHub Pages serves this repository at https://abbas-4.github.io/Snap-Notes/
    base: '/Snap-Notes/',
    plugins: [react(), tailwindcss(), securityMetaTags(env.VITE_SUPABASE_URL)],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // The app's tests, and the Edge Functions' shared code (which runs in Node here).
      include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts'],
      // Run against a real Supabase stack with `npm run test:integration`.
      exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
      // Unit tests never talk to a backend, whatever a local .env file says.
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_SUPABASE_ANON_KEY: '' },
      coverage: {
        include: ['src/**/*.{ts,tsx}', 'supabase/functions/_shared/**/*.ts'],
        exclude: ['**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
      },
    },
  };
});
