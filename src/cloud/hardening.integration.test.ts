import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultDeck } from '../domain/appData';
import type { PushChange } from '../sync/state';
import {
  accessToken,
  browser,
  claimsOf,
  env,
  mintToken,
  newAccount,
  PASSWORD,
  rest,
  setLimit,
  sql,
} from '../test/integration';

/**
 * Security regression tests for the hardening in
 * supabase/migrations/20261120000000_security_hardening.sql, against the real
 * local stack. Every request is one any HTTP client could send.
 */

const FUNCTION_URL = `${env.url}/functions/v1/generate-flashcards`;
const deck = createDefaultDeck(1_700_000_000_000);

function card(id: string, text = 'term'): PushChange {
  return {
    kind: 'card',
    id,
    baseRevision: null,
    deleted: false,
    data: {
      id,
      deckId: 'default',
      term: text,
      definition: 'definition',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
  };
}

const deckChange: PushChange = {
  kind: 'deck',
  id: 'default',
  baseRevision: null,
  deleted: false,
  data: deck,
};

const pull = (token: string) =>
  rest('rpc/sync_pull', { method: 'POST', token, body: { since: 0 } });
const push = (token: string, changes: unknown[]) =>
  rest('rpc/sync_push', { method: 'POST', token, body: { changes } });
const begin = (token: string) =>
  rest('rpc/ai_generation_begin', { method: 'POST', token, body: {} });
const deleteAccount = (token: string) =>
  rest('rpc/delete_account', { method: 'POST', token, body: {} });

async function callFunction(token: string) {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      apikey: env.publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'status' }),
  });
  return response.status;
}

/** Every API function refuses this token, and nothing it asked for happened. */
async function expectRefusedEverywhere(token: string) {
  const responses = await Promise.all([
    pull(token),
    push(token, [deckChange]),
    begin(token),
    deleteAccount(token),
  ]);
  for (const response of responses) {
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(response.status).toBeLessThan(500);
  }
}

const restore: Array<() => void> = [];
afterEach(() => {
  while (restore.length > 0) restore.pop()!();
});
function limit(key: string, value: number) {
  const previous = setLimit(key, value);
  restore.push(() => setLimit(key, previous));
}

beforeAll(() => {
  sql('delete from snapnotes_private.ai_generation_requests');
});

describe('revoked sessions', () => {
  it('refuses a token from a session signed out on every device', async () => {
    const alice = await newAccount('revoked-global');
    const token = accessToken(alice.services.storage);
    expect((await pull(token)).status).toBe(200);

    expect(await alice.services.auth.signOut('global')).toEqual({ ok: true, value: undefined });

    await expectRefusedEverywhere(token);
    expect(await callFunction(token)).toBe(401);
    // The account itself is untouched: signing in again works and sees the data.
    const again = await browser();
    expect(await again.auth.signIn(alice.email, PASSWORD)).toEqual({ ok: true, value: undefined });
    expect((await pull(accessToken(again.storage))).status).toBe(200);
  });

  it('refuses a token from a session signed out on this device only, but not the others', async () => {
    const alice = await newAccount('revoked-local');
    const laptop = alice.services;
    const phone = await browser();
    expect(await phone.auth.signIn(alice.email, PASSWORD)).toEqual({ ok: true, value: undefined });
    const laptopToken = accessToken(laptop.storage);
    const phoneToken = accessToken(phone.storage);

    expect(await laptop.auth.signOut('local')).toEqual({ ok: true, value: undefined });

    await expectRefusedEverywhere(laptopToken);
    expect((await pull(phoneToken)).status).toBe(200);
  });

  it('refuses a validly signed token whose session does not exist or belongs to someone else', async () => {
    const alice = await newAccount('session-forged');
    const bob = await newAccount('session-owner');
    const bobSession = claimsOf(accessToken(bob.services.storage)).session_id;

    const noSession = mintToken({ sub: alice.userId });
    const unknownSession = mintToken({ sub: alice.userId, session_id: randomUUID() });
    const borrowedSession = mintToken({ sub: alice.userId, session_id: bobSession });
    const garbledSession = mintToken({ sub: alice.userId, session_id: 'not-a-uuid' });
    for (const token of [noSession, unknownSession, borrowedSession, garbledSession]) {
      await expectRefusedEverywhere(token);
    }
    // Neither account lost anything.
    expect((await pull(accessToken(alice.services.storage))).status).toBe(200);
    expect((await pull(accessToken(bob.services.storage))).status).toBe(200);
  });

  it('refuses anonymous sessions, which the app never uses', async () => {
    const alice = await newAccount('anonymous-claim');
    const anonymous = mintToken({
      sub: alice.userId,
      session_id: claimsOf(accessToken(alice.services.storage)).session_id,
      is_anonymous: true,
    });
    await expectRefusedEverywhere(anonymous);
  });

  it('tells the app the session has ended, so it signs the user out instead of retrying', async () => {
    const alice = await newAccount('revoked-app');
    const other = await browser();
    expect(await other.auth.signIn(alice.email, PASSWORD)).toEqual({ ok: true, value: undefined });
    expect(await other.auth.signOut('global')).toEqual({ ok: true, value: undefined });
    await expect(alice.services.transport.pull(0)).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('storage limits per account', () => {
  it('rejects new records past the row limit, one by one, and still accepts deletions', async () => {
    limit('storage_max_rows', 4);
    const alice = await newAccount('quota-rows');
    const results = await alice.services.transport.push([
      deckChange,
      card('c1'),
      card('c2'),
      card('c3'),
      card('c4'),
      card('c5'),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
      'rejected',
      'rejected',
    ]);
    expect(results[4]).toMatchObject({ reason: 'quota', message: expect.stringMatching(/limit/) });

    const c1 = results[1] as { revision: number };
    const removed = await alice.services.transport.push([
      { kind: 'card', id: 'c1', baseRevision: c1.revision, deleted: true, data: null },
    ]);
    expect(removed[0]).toMatchObject({ status: 'applied' });

    const page = await alice.services.transport.pull(0);
    expect(page.changes.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3', 'default']);
  });

  it('rejects text past the byte limit without storing any of it', async () => {
    limit('storage_max_text_bytes', 10_000);
    const alice = await newAccount('quota-bytes');
    const results = await alice.services.transport.push([
      deckChange,
      card('small', 'a'.repeat(1_000)),
      card('large', 'b'.repeat(20_000)),
      card('after', 'c'.repeat(1_000)),
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'rejected', 'applied']);
    const page = await alice.services.transport.pull(0);
    expect(page.changes.map((c) => c.id)).not.toContain('large');
  });

  it("counts each account's storage separately", async () => {
    limit('storage_max_rows', 3);
    const alice = await newAccount('quota-a');
    const bob = await newAccount('quota-b');
    await alice.services.transport.push([deckChange, card('a1'), card('a2')]);
    const bobs = await bob.services.transport.push([deckChange, card('b1'), card('b2')]);
    expect(bobs.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
  });
});

describe('AI generation cost limits', () => {
  it('caps requests across all accounts together', async () => {
    sql('delete from snapnotes_private.ai_generation_requests');
    limit('ai_project_per_hour', 3);
    const accounts = await Promise.all(
      ['cap-a', 'cap-b', 'cap-c', 'cap-d'].map((label) => newAccount(label)),
    );
    const tokens = accounts.map((a) => accessToken(a.services.storage));
    const first = [await begin(tokens[0]!), await begin(tokens[1]!), await begin(tokens[2]!)];
    for (const r of first) expect(r.json).toMatchObject({ allowed: true });

    const refused = await begin(tokens[3]!);
    expect(refused.json).toMatchObject({ allowed: false, reason: 'project' });
    const wait = (refused.json as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(3600);
    // A fresh account does not get around it either.
    const fresh = await newAccount('cap-fresh');
    expect((await begin(accessToken(fresh.services.storage))).json).toMatchObject({
      allowed: false,
      reason: 'project',
    });
  });

  it('never lets parallel requests from one account past its allowance', async () => {
    sql('delete from snapnotes_private.ai_generation_requests');
    const alice = await newAccount('parallel');
    const token = accessToken(alice.services.storage);
    const replies = await Promise.all(Array.from({ length: 30 }, () => begin(token)));
    const allowed = replies.filter((r) => (r.json as { allowed?: boolean }).allowed === true);
    expect(allowed).toHaveLength(20);
    expect(replies.every((r) => r.status === 200)).toBe(true);
  });

  it('never lets parallel requests from many accounts past the project cap', async () => {
    sql('delete from snapnotes_private.ai_generation_requests');
    limit('ai_project_per_hour', 7);
    const accounts = await Promise.all(
      ['par-a', 'par-b', 'par-c'].map((label) => newAccount(label)),
    );
    const replies = await Promise.all(
      accounts.flatMap((a) =>
        Array.from({ length: 5 }, () => begin(accessToken(a.services.storage))),
      ),
    );
    const allowed = replies.filter((r) => (r.json as { allowed?: boolean }).allowed === true);
    expect(allowed).toHaveLength(7);
  });
});

describe('the database schema', () => {
  // Guards against a future migration exposing something by accident: Supabase
  // grants every privilege on new public tables and functions to the API roles.

  it('has Row Level Security on every table the API can reach, and lets no one write directly', () => {
    const tables = sql(`
      select c.relname as name, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')`);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(table).toMatchObject({ rls: true });

    const grants = sql(`
      select grantee, table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
        and not (grantee = 'authenticated' and privilege_type = 'SELECT')`);
    expect(grants).toEqual([]);
  });

  it('keeps the private schema private', () => {
    const rows = sql(`
      select
        has_schema_privilege('anon', 'snapnotes_private', 'usage') as anon,
        has_schema_privilege('authenticated', 'snapnotes_private', 'usage') as authenticated`);
    expect(rows).toEqual([{ anon: false, authenticated: false }]);
  });

  it('lets only signed-in users call the API functions, all with a fixed search path', () => {
    const functions = sql(`
      select n.nspname as schema, p.proname as name, p.prosecdef as definer,
        coalesce(array_to_string(p.proconfig, ','), '') as config,
        has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'snapnotes_private')`);
    for (const fn of functions) {
      expect(fn.config, `${String(fn.name)} search_path`).toMatch(/search_path=/);
      expect(fn.anon, `${String(fn.name)} callable by anon`).toBe(false);
      if (fn.schema === 'snapnotes_private') expect(fn.authenticated).toBe(false);
    }
    const api = functions
      .filter((fn) => fn.schema === 'public')
      .map((fn) => fn.name)
      .sort();
    expect(api).toEqual(['ai_generation_begin', 'delete_account', 'sync_pull', 'sync_push']);
  });
});
