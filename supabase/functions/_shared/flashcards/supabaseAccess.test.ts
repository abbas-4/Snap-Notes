// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allowedOriginsFromEnv, providerFromEnv } from './config.ts';
import { createSupabaseAccess } from './supabaseAccess.ts';

function server(routes: Record<string, { status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const route = routes[new URL(String(input)).pathname];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const options = { url: 'https://project.supabase.co/', publishableKey: 'sb_publishable_x' };

describe('checking the caller with the auth server', () => {
  it('returns the user ID for a valid token, sending the token and the public key only', async () => {
    const { fetch, calls } = server({ '/auth/v1/user': { status: 200, body: { id: 'user-1' } } });
    const access = createSupabaseAccess({ ...options, fetch });
    expect(await access.authenticate('Bearer t')).toBe('user-1');
    expect(calls[0]!.url).toBe('https://project.supabase.co/auth/v1/user');
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer t');
    expect(new Headers(calls[0]!.init?.headers).get('apikey')).toBe('sb_publishable_x');
  });

  it('returns null for a refused token, and throws when the server fails', async () => {
    const refused = createSupabaseAccess({
      ...options,
      fetch: server({ '/auth/v1/user': { status: 401, body: {} } }).fetch,
    });
    expect(await refused.authenticate('Bearer t')).toBeNull();
    const broken = createSupabaseAccess({
      ...options,
      fetch: server({ '/auth/v1/user': { status: 500, body: {} } }).fetch,
    });
    await expect(broken.authenticate('Bearer t')).rejects.toThrow('500');
  });
});

describe('reserving a request', () => {
  const allowed = {
    allowed: true,
    userId: 'user-1',
    retryAfterSeconds: 0,
    remainingHour: 4,
    remainingDay: 30,
  };

  it('calls the database function with the caller’s own token', async () => {
    const { fetch, calls } = server({
      '/rest/v1/rpc/ai_generation_begin': { status: 200, body: allowed },
    });
    const access = createSupabaseAccess({ ...options, fetch });
    expect(await access.reserve('Bearer t')).toEqual({
      allowed: true,
      quota: { remainingHour: 4, remainingDay: 30 },
    });
    expect(calls[0]!.init?.method).toBe('POST');
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer t');
  });

  it('passes on a refusal with when to retry', async () => {
    const { fetch } = server({
      '/rest/v1/rpc/ai_generation_begin': {
        status: 200,
        body: { ...allowed, allowed: false, retryAfterSeconds: 300, remainingHour: 0 },
      },
    });
    expect(await createSupabaseAccess({ ...options, fetch }).reserve('Bearer t')).toEqual({
      allowed: false,
      scope: 'account',
      retryAfterSeconds: 300,
      quota: { remainingHour: 0, remainingDay: 30 },
    });
  });

  it('tells a project-wide refusal apart from an account one', async () => {
    const { fetch } = server({
      '/rest/v1/rpc/ai_generation_begin': {
        status: 200,
        body: { ...allowed, allowed: false, reason: 'project', retryAfterSeconds: 90 },
      },
    });
    expect(await createSupabaseAccess({ ...options, fetch }).reserve('Bearer t')).toMatchObject({
      allowed: false,
      scope: 'project',
      retryAfterSeconds: 90,
    });
  });

  it('returns null for a refused token, and throws on an unexpected reply', async () => {
    const refused = server({ '/rest/v1/rpc/ai_generation_begin': { status: 403, body: {} } });
    expect(
      await createSupabaseAccess({ ...options, fetch: refused.fetch }).reserve('Bearer t'),
    ).toBeNull();
    const odd = server({
      '/rest/v1/rpc/ai_generation_begin': { status: 200, body: { allowed: 'yes' } },
    });
    await expect(
      createSupabaseAccess({ ...options, fetch: odd.fetch }).reserve('Bearer t'),
    ).rejects.toThrow();
  });
});

describe('configuration', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];

  it('switches generation off without a key, and refuses an unknown provider', () => {
    expect(providerFromEnv(env({}))).toEqual({ ok: true, provider: null });
    expect(providerFromEnv(env({ ANTHROPIC_API_KEY: '  ' }))).toEqual({ ok: true, provider: null });
    expect(providerFromEnv(env({ AI_PROVIDER: 'other', ANTHROPIC_API_KEY: 'k' }))).toMatchObject({
      ok: false,
    });
    const setup = providerFromEnv(env({ ANTHROPIC_API_KEY: 'sk-test' }));
    expect(setup.ok && setup.provider?.displayName).toBe('Anthropic (Claude)');
  });

  it('reads the allowed origins', () => {
    expect(allowedOriginsFromEnv(env({}))).toBe('*');
    expect(allowedOriginsFromEnv(env({ AI_ALLOWED_ORIGINS: '*' }))).toBe('*');
    expect(
      allowedOriginsFromEnv(
        env({ AI_ALLOWED_ORIGINS: 'https://abbas-4.github.io/, http://localhost:5173' }),
      ),
    ).toEqual(['https://abbas-4.github.io', 'http://localhost:5173']);
  });
});
