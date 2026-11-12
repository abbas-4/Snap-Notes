// Runs the integration tests (src/**/*.integration.test.ts) against a local Supabase stack.
//
//   npm run db:start           start the stack once (Docker must be running)
//   npm run test:integration   then run these tests as often as you like
//
// The tests talk to the real auth server, PostgREST, Postgres (with its Row Level Security
// policies) and the Mailpit inbox that catches the stack's emails. The connection details are
// read from `supabase status`; they are the fixed, public defaults of a local development stack,
// never a hosted project's keys.
//
// Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_JWT_SECRET and
// MAILPIT_URL to point the tests somewhere else instead (for example in CI).
import { spawnSync } from 'node:child_process';

const SUPABASE_CLI = 'supabase@2.122.0';

function localStatus() {
  const result = spawnSync('npx', ['--yes', SUPABASE_CLI, 'status', '-o', 'json'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

const env = { ...process.env };
if (!env.SUPABASE_URL) {
  const status = localStatus();
  if (!status) {
    console.error(
      'The local Supabase stack is not running. Start Docker, then run `npm run db:start`.',
    );
    process.exit(1);
  }
  const api = status.API_URL;
  // Only ever a local stack: these tests create and delete accounts.
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(api)) {
    console.error(`Refusing to run integration tests against ${api}.`);
    process.exit(1);
  }
  env.SUPABASE_URL = api;
  env.SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  env.SUPABASE_SECRET_KEY = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  env.SUPABASE_JWT_SECRET = status.JWT_SECRET;
  env.MAILPIT_URL = status.MAILPIT_URL ?? status.INBUCKET_URL;
}

const run = spawnSync(
  'npx',
  ['vitest', 'run', '--config', 'vitest.integration.config.ts', ...process.argv.slice(2)],
  { stdio: 'inherit', env },
);
process.exit(run.status ?? 1);
