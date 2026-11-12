import { describe, expect, it } from 'vitest';
import { createDefaultDeck } from '../domain/appData';
import {
  accessToken,
  browser,
  env,
  mintToken,
  newAccount,
  PASSWORD,
  rest,
} from '../test/integration';
import type { PushChange } from '../sync/state';

/**
 * Data isolation, checked at the database: every request here is one any
 * HTTP client could send, not just this app.
 */

const deck = createDefaultDeck(1_700_000_000_000);
const card = (id: string, term: string) => ({
  id,
  deckId: 'default',
  term,
  definition: 'secret',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
});

async function accountWithCard(label: string, cardId = 'shared-id') {
  const account = await newAccount(label);
  const changes: PushChange[] = [
    { kind: 'deck', id: 'default', baseRevision: null, deleted: false, data: deck },
    { kind: 'card', id: cardId, baseRevision: null, deleted: false, data: card(cardId, label) },
  ];
  const results = await account.services.transport.push(changes);
  expect(results.every((r) => r.status === 'applied')).toBe(true);
  return account;
}

describe('isolation between accounts', () => {
  it("never shows one user another user's records", async () => {
    const alice = await accountWithCard('alice');
    const bob = await newAccount('bob');
    const page = await bob.services.transport.pull(0);
    expect(page.changes).toEqual([]);

    const direct = await rest('cards?select=*', { token: accessToken(bob.services.storage) });
    expect(direct).toEqual({ status: 200, json: [] });
    const own = await rest('cards?select=id,term', { token: accessToken(alice.services.storage) });
    expect(own.json).toEqual([{ id: 'shared-id', term: 'alice' }]);
  });

  it('keeps two users apart even when they use the same record IDs', async () => {
    const alice = await accountWithCard('alice2');
    const bob = await accountWithCard('bob2');
    // Bob pushes an edit to "shared-id": it can only ever reach his own row.
    await bob.services.transport.push([
      {
        kind: 'card',
        id: 'shared-id',
        baseRevision: 2,
        deleted: false,
        data: { ...card('shared-id', 'changed by bob'), updatedAt: 1_700_000_000_001 },
      },
    ]);
    const alicePage = await alice.services.transport.pull(0);
    expect(alicePage.changes.find((c) => c.kind === 'card')?.data).toMatchObject({
      term: 'alice2',
    });
  });

  it('ignores any account ID a request tries to supply', async () => {
    const alice = await accountWithCard('alice3');
    const bob = await newAccount('bob3');
    const sneaky = {
      kind: 'card',
      id: 'injected',
      baseRevision: null,
      deleted: false,
      user_id: alice.userId,
      userId: alice.userId,
      data: { ...card('injected', 'from bob'), user_id: alice.userId },
    };
    await rest('rpc/sync_push', {
      method: 'POST',
      token: accessToken(bob.services.storage),
      body: { changes: [sneaky] },
    });
    const alicePage = await alice.services.transport.pull(0);
    expect(alicePage.changes.map((c) => c.id)).not.toContain('injected');
  });

  it('refuses direct writes to the tables, even to your own rows', async () => {
    const alice = await accountWithCard('alice4');
    const token = accessToken(alice.services.storage);
    const insert = await rest('cards', {
      method: 'POST',
      token,
      body: { user_id: alice.userId, id: 'direct', revision: 99, deleted: true },
    });
    const update = await rest('cards?id=eq.shared-id', {
      method: 'PATCH',
      token,
      body: { term: 'tampered' },
    });
    const remove = await rest('cards?id=eq.shared-id', { method: 'DELETE', token });
    for (const response of [insert, update, remove]) expect(response.status).toBe(403);

    const own = await rest('cards?select=term', { token });
    expect(own.json).toEqual([{ term: 'alice4' }]);
  });
});

describe('unauthorised requests', () => {
  it('refuses the sync API to anyone not signed in', async () => {
    const pull = await rest('rpc/sync_pull', { method: 'POST', body: { since: 0 } });
    const push = await rest('rpc/sync_push', { method: 'POST', body: { changes: [] } });
    const del = await rest('rpc/delete_account', { method: 'POST', body: {} });
    for (const response of [pull, push, del]) expect(response.status).toBeGreaterThanOrEqual(401);
    const read = await rest('cards?select=*');
    expect(read.status).toBeGreaterThanOrEqual(401);
  });

  it('refuses an expired token', async () => {
    const alice = await accountWithCard('expiredtoken');
    const expired = mintToken({ sub: alice.userId, exp: Math.floor(Date.now() / 1000) - 60 });
    const response = await rest('rpc/sync_pull', {
      method: 'POST',
      token: expired,
      body: { since: 0 },
    });
    expect(response.status).toBe(401);
  });

  it('refuses a token that has been tampered with', async () => {
    const alice = await accountWithCard('tampered');
    const token = accessToken(alice.services.storage);
    const [header, payload, signature] = token.split('.');
    const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    forged.sub = '00000000-0000-0000-0000-000000000000';
    const tampered = `${header}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`;
    const response = await rest('rpc/sync_pull', {
      method: 'POST',
      token: tampered,
      body: { since: 0 },
    });
    expect(response.status).toBe(401);
  });

  it('rejects invalid records without storing them', async () => {
    const alice = await newAccount('invalid');
    const results = await alice.services.transport.push([
      { kind: 'deck', id: 'default', baseRevision: null, deleted: false, data: deck },
      {
        kind: 'card',
        id: 'bad id!',
        baseRevision: null,
        deleted: false,
        data: { ...card('bad id!', 'x') },
      },
      {
        kind: 'card',
        id: 'blank',
        baseRevision: null,
        deleted: false,
        data: { ...card('blank', ' '), definition: '' },
      },
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'rejected', 'rejected']);
    const page = await alice.services.transport.pull(0);
    expect(page.changes.map((c) => c.id)).toEqual(['default']);
  });
});

describe('account deletion', () => {
  it('deletes the account and every record in it, and nothing of anyone else', async () => {
    const alice = await accountWithCard('deleteme');
    const bob = await accountWithCard('bystander');
    expect(await alice.services.auth.deleteAccount()).toEqual({ ok: true, value: undefined });

    const admin = { key: env.secretKey, token: env.secretKey };
    const left = await rest(`cards?select=id&user_id=eq.${alice.userId}`, admin);
    expect(left.json).toEqual([]);
    const bobs = await rest(`cards?select=id&user_id=eq.${bob.userId}`, admin);
    expect(bobs.json).toEqual([{ id: 'shared-id' }]);

    const again = await browser();
    expect(await again.auth.signIn(alice.email, PASSWORD)).toMatchObject({
      ok: false,
      code: 'invalid-credentials',
    });
  });

  it('requires a recent sign-in', async () => {
    const alice = await accountWithCard('stale');
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    const stale = mintToken({
      sub: alice.userId,
      amr: [{ method: 'password', timestamp: hourAgo }],
    });
    const response = await rest('rpc/delete_account', { method: 'POST', token: stale, body: {} });
    expect(response.status).toBe(403);
    expect(response.json).toMatchObject({ hint: 'reauthentication-required' });

    // Proving the password again is enough.
    expect(await alice.services.auth.reauthenticate(PASSWORD)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await alice.services.auth.deleteAccount()).toEqual({ ok: true, value: undefined });
  });
});
