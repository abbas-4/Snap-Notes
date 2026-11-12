import { describe, expect, it } from 'vitest';
import { authMessage, classifyAuthError, emailProblem, passwordProblem } from './auth';
import { isSecretKey, readCloudConfig } from './config';
import { classifyRpcFailure, parsePullPage, parsePushResults } from './syncProtocol';

const APP = 'https://abbas-4.github.io/Snap-Notes/';

/** A JWT-shaped key with the given role, as Supabase's legacy keys are. */
function legacyKey(role: string): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode({ role, iss: 'supabase' })}.signature`;
}

describe('readCloudConfig', () => {
  it('leaves accounts off when nothing is configured', () => {
    expect(readCloudConfig({}, APP)).toEqual({ ok: false, reason: 'missing' });
  });

  it('accepts a project URL and its publishable key', () => {
    expect(
      readCloudConfig(
        {
          VITE_SUPABASE_URL: 'https://abcd.supabase.co/',
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
        },
        APP,
      ),
    ).toEqual({
      ok: true,
      config: { url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_x', appUrl: APP },
    });
  });

  it('accepts the legacy anon key under its old name', () => {
    const result = readCloudConfig(
      { VITE_SUPABASE_URL: 'https://abcd.supabase.co', VITE_SUPABASE_ANON_KEY: legacyKey('anon') },
      APP,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a secret or service-role key, which must never reach a browser', () => {
    for (const key of ['sb_secret_abc', legacyKey('service_role')]) {
      expect(
        readCloudConfig(
          { VITE_SUPABASE_URL: 'https://abcd.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key },
          APP,
        ),
      ).toMatchObject({ ok: false, reason: 'secret-key' });
    }
    expect(isSecretKey('sb_publishable_abc')).toBe(false);
    expect(isSecretKey(legacyKey('anon'))).toBe(false);
  });

  it('requires https, except on this machine', () => {
    const http = (url: string) =>
      readCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }, APP).ok;
    expect(http('http://abcd.supabase.co')).toBe(false);
    expect(http('http://127.0.0.1:54321')).toBe(true);
    expect(http('http://localhost:54321')).toBe(true);
  });

  it('reports half a configuration instead of guessing', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://abcd.supabase.co' }, APP)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('uses an explicit app URL for email links, without any query or hash', () => {
    const result = readCloudConfig(
      {
        VITE_SUPABASE_URL: 'https://abcd.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'k',
        VITE_APP_URL: 'https://notes.example/app/?x=1#/home',
      },
      APP,
    );
    expect(result.ok && result.config.appUrl).toBe('https://notes.example/app/');
  });
});

describe('form checks', () => {
  it('matches the server password rule', () => {
    expect(passwordProblem('short1')).toMatch(/8 characters/);
    expect(passwordProblem('longenough')).toMatch(/letters and numbers/);
    expect(passwordProblem('12345678')).toMatch(/letters and numbers/);
    expect(passwordProblem('studyhard2026')).toBeNull();
  });

  it('checks the email lightly', () => {
    expect(emailProblem('')).toMatch(/Enter your email/);
    expect(emailProblem('not an email')).toMatch(/valid/);
    expect(emailProblem(' me@example.test ')).toBeNull();
  });
});

describe('classifyAuthError', () => {
  it('maps provider codes to messages written for people', () => {
    expect(classifyAuthError({ code: 'invalid_credentials' })).toBe('invalid-credentials');
    expect(classifyAuthError({ code: 'user_already_exists' })).toBe('email-taken');
    expect(classifyAuthError({ code: 'over_request_rate_limit' })).toBe('rate-limited');
    expect(classifyAuthError({ code: 'refresh_token_not_found' })).toBe('session-expired');
    expect(classifyAuthError({ code: 'flow_state_expired' })).toBe('link-expired');
  });

  it('recognises a lost connection', () => {
    expect(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe('network');
    expect(classifyAuthError({ message: 'Failed to fetch' })).toBe('network');
  });

  it('never shows the raw provider message', () => {
    const code = classifyAuthError({ code: 'something_new', message: 'internal detail' });
    expect(code).toBe('unknown');
    expect(authMessage(code)).not.toContain('internal detail');
  });
});

describe('sync protocol', () => {
  const deck = { id: 'default', name: 'My Cards', createdAt: 1, updatedAt: 1 };

  it('reads a page of changes, tombstones included', () => {
    expect(
      parsePullPage({
        changes: [
          { kind: 'deck', id: 'default', revision: 1, deleted: false, data: deck },
          { kind: 'card', id: 'gone', revision: 2, deleted: true, data: null },
        ],
        cursor: 2,
        hasMore: false,
        latest: 2,
      }),
    ).toEqual({
      changes: [
        { kind: 'deck', id: 'default', revision: 1, deleted: false, data: deck },
        { kind: 'card', id: 'gone', revision: 2, deleted: true, data: null },
      ],
      cursor: 2,
      hasMore: false,
    });
  });

  it('refuses a reply holding an invalid record, so none of it is applied', () => {
    expect(() =>
      parsePullPage({
        changes: [{ kind: 'deck', id: 'x', revision: 1, deleted: false, data: { id: 'x' } }],
        cursor: 1,
        hasMore: false,
      }),
    ).toThrow(expect.objectContaining({ kind: 'protocol' }));
    expect(() => parsePullPage({ nope: true })).toThrow(
      expect.objectContaining({ kind: 'protocol' }),
    );
  });

  it('reads push results, with the server copy of a conflict validated too', () => {
    expect(
      parsePushResults({
        results: [
          { kind: 'deck', id: 'default', status: 'applied', revision: 4 },
          {
            kind: 'deck',
            id: 'other',
            status: 'conflict',
            reason: 'changed',
            current: { kind: 'deck', id: 'other', revision: 3, deleted: true, data: null },
          },
          { kind: 'card', id: 'bad', status: 'rejected', reason: 'invalid', message: 'too long' },
        ],
      }),
    ).toHaveLength(3);
  });

  it('sorts failures into what to do about them', () => {
    expect(classifyRpcFailure({ status: 0 })).toMatchObject({ kind: 'network', retryable: true });
    expect(classifyRpcFailure({ status: 401 })).toMatchObject({ kind: 'auth', retryable: false });
    expect(classifyRpcFailure({ status: 403, code: '42501' })).toMatchObject({ kind: 'auth' });
    expect(classifyRpcFailure({ status: 503 })).toMatchObject({ kind: 'server', retryable: true });
    expect(classifyRpcFailure({ status: 429 })).toMatchObject({ kind: 'server', retryable: true });
    expect(classifyRpcFailure({ status: 400, code: '22023' })).toMatchObject({
      kind: 'protocol',
      retryable: false,
    });
  });
});
