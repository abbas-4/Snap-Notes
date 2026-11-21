import { spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import type { CloudConfig } from '../cloud/config';
import { createSupabaseServices, type CloudServices } from '../cloud/supabaseServices';
import { MemoryStorage } from './memoryStorage';

/** Helpers for tests that run against the local Supabase stack (see scripts/test-integration.mjs). */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run these tests with npm run test:integration.`);
  return value;
}

export const env = {
  url: required('SUPABASE_URL'),
  publishableKey: required('SUPABASE_PUBLISHABLE_KEY'),
  secretKey: required('SUPABASE_SECRET_KEY'),
  jwtSecret: required('SUPABASE_JWT_SECRET'),
  mailpit: required('MAILPIT_URL'),
};

export const APP_URL = 'http://localhost:5173/Snap-Notes/';

export const config: CloudConfig = {
  url: env.url,
  publishableKey: env.publishableKey,
  appUrl: APP_URL,
};

export const PASSWORD = 'correct horse 42';

export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

/** A separate browser: its own storage, its own session. */
export async function browser(
  storage: Storage = new MemoryStorage(),
  fetchImpl?: typeof fetch,
): Promise<CloudServices & { storage: Storage }> {
  const services = await createSupabaseServices(config, {
    storage,
    autoRefreshToken: false,
    fetch: fetchImpl,
  });
  return { ...services, storage };
}

/** A new account, signed in on a new browser. */
export async function newAccount(label: string) {
  const email = uniqueEmail(label);
  const services = await browser();
  const signedUp = await services.auth.signUp(email, PASSWORD);
  if (!signedUp.ok) throw new Error(`sign up failed: ${signedUp.message}`);
  const { session } = await services.auth.getSession();
  if (!session) throw new Error('no session after sign up');
  return { email, userId: session.user.id, services };
}

/** Calls PostgREST directly, the way any HTTP client could, bypassing the app. */
export async function rest(
  path: string,
  init: { method?: string; token?: string | null; body?: unknown; key?: string } = {},
) {
  const headers: Record<string, string> = {
    apikey: init.key ?? env.publishableKey,
    'Content-Type': 'application/json',
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(`${env.url}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

/** The access token a browser is using right now. */
export function accessToken(storage: Storage): string {
  const raw = storage.getItem('snapnotes.auth.v1');
  if (!raw) throw new Error('not signed in');
  return (JSON.parse(raw) as { access_token: string }).access_token;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/**
 * A token signed with the local stack's development secret, for checking how
 * the server treats claims a real session would not normally carry (an old
 * sign-in, an expiry in the past). Only possible because the local secret is
 * public; a hosted project's secret never leaves the server.
 */
export function mintToken(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: now + 600,
      ...claims,
    }),
  );
  const signature = createHmac('sha256', env.jwtSecret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${base64url(signature)}`;
}

/** The newest email Mailpit caught for an address. */
export async function latestEmail(to: string, attempts = 20): Promise<string> {
  for (let i = 0; i < attempts; i += 1) {
    const search = await fetch(
      `${env.mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const found = (await search.json()) as { messages?: Array<{ ID: string }> };
    const id = found.messages?.[0]?.ID;
    if (id) {
      const message = await fetch(`${env.mailpit}/api/v1/message/${id}`);
      const body = (await message.json()) as { Text?: string; HTML?: string };
      return `${body.Text ?? ''}\n${body.HTML ?? ''}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no email for ${to}`);
}

/** Follows an email's verification link the way a browser would, returning where it lands. */
export async function followEmailLink(email: string): Promise<URL> {
  const match = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(email);
  if (!match) throw new Error('no verification link in the email');
  const link = match[0].replace(/&amp;/g, '&');
  const response = await fetch(link, { redirect: 'manual' });
  const location = response.headers.get('location');
  if (!location) throw new Error(`the link did not redirect (${response.status})`);
  return new URL(location);
}

/** The claims of an access token, decoded without checking it (tests read their own tokens). */
export function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
}

/**
 * Runs SQL as the database owner on the *local* stack, for test setup the API
 * deliberately cannot do (changing a limit, clearing the AI request log). Uses
 * the Supabase CLI, so it needs no database driver and never sees a password.
 */
export function sql(query: string): Array<Record<string, unknown>> {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.url)) {
    throw new Error(`Refusing to run SQL against ${env.url}: only the local stack.`);
  }
  const result = spawnSync(
    'npx',
    ['--yes', 'supabase@2.122.0', 'db', 'query', '--local', '--output-format', 'json', query],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`SQL failed: ${result.stderr || result.stdout}`);
  // Statements without rows (DELETE, UPDATE) print a command tag such as "DELETE 3", not JSON.
  if (!result.stdout.trimStart().startsWith('{')) return [];
  return (JSON.parse(result.stdout) as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

/** Sets one of the limits in snapnotes_private.settings, returning the previous value. */
export function setLimit(key: string, value: number): number {
  if (!/^[a-z_]+$/.test(key) || !Number.isInteger(value)) throw new Error('bad limit');
  const [row] = sql(`select value from snapnotes_private.settings where key = '${key}'`);
  if (!row) throw new Error(`no setting ${key}`);
  sql(`update snapnotes_private.settings set value = ${value} where key = '${key}'`);
  return Number(row.value);
}
