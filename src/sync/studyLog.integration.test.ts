import { describe, expect, it } from 'vitest';
import type { StudySession } from '../domain/studySessions';
import { accessToken, browser, newAccount, PASSWORD, rest } from '../test/integration';
import { TestDevice } from '../test/syncDevice';
import type { PushChange } from './state';

/**
 * Study sessions and goals (Milestone 9) against the real database: the
 * migration's tables, validation, Row Level Security and the backwards
 * compatible sync_pull.
 */

function session(id: string, overrides: Partial<StudySession> = {}): StudySession {
  return {
    id,
    mode: 'quiz',
    deckId: null,
    day: '2026-11-14',
    startedAt: 1_800_000_000_000,
    endedAt: 1_800_000_060_000,
    durationMs: 60_000,
    answered: 2,
    correct: 1,
    responseMs: 4_000,
    timedAnswers: 2,
    results: [{ cardId: 'card-1', correct: 1, incorrect: 1 }],
    ...overrides,
  };
}

const push = (data: StudySession, baseRevision: number | null = null): PushChange => ({
  kind: 'session',
  id: data.id,
  baseRevision,
  deleted: false,
  data,
});

describe('study sessions and goals on the server', () => {
  it('carries a device’s sessions and goals to another device, once', async () => {
    const account = await newAccount('studylog');
    const second = await browser();
    await second.auth.signIn(account.email, PASSWORD);

    const a = new TestDevice('a');
    const card = a.addCard('hola', 'hello');
    a.answer(card.id, true);
    a.answer(card.id, false);
    a.endSession();
    a.answer(card.id, true, 'learn');
    a.setGoal('cards-per-day', 25);
    await a.link(account.services.transport);
    expect((await a.sync(account.services.transport)).pending).toBe(0);

    const b = new TestDevice('b');
    await b.link(second.transport, 'use-account');
    await b.sync(second.transport);
    expect(b.sessions).toEqual(a.sessions);
    expect(b.snapshot.analytics?.goals).toEqual(a.snapshot.analytics?.goals);

    // A session that grows, and a goal changed on the other device.
    a.answer(card.id, true, 'learn');
    b.tick(3_600_000);
    b.setGoal('cards-per-day', 40);
    await a.sync(account.services.transport);
    await b.sync(second.transport);
    await a.sync(account.services.transport);
    expect(a.sessions).toEqual(b.sessions);
    expect(a.sessions.map((s) => s.answered)).toEqual([2, 2]);
    expect(a.snapshot.analytics?.goals[0]?.target).toBe(40);
    expect(a.snapshot.analytics?.goals).toEqual(b.snapshot.analytics?.goals);
  });

  it('applies a retried upload once, and stores results exactly as sent', async () => {
    const account = await newAccount('studylog-retry');
    const data = session('retry-1');
    const [first] = await account.services.transport.push([push(data)]);
    expect(first).toMatchObject({ status: 'applied' });
    // The reply was lost; the device sends the same change again.
    const [again] = await account.services.transport.push([push(data)]);
    expect(again).toEqual(first);
    const page = await account.services.transport.pull(0);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0]?.data).toEqual(data);
  });

  it('refuses invalid sessions and goals, one record at a time', async () => {
    const account = await newAccount('studylog-invalid');
    const results = await account.services.transport.push([
      push(session('bad-1', { correct: 5 })),
      push(session('bad-2', { mode: 'study' as never })),
      push(session('bad-3', { results: [{ cardId: 'not valid!', correct: 1, incorrect: 0 }] })),
      push(session('bad-4', { endedAt: 1 })),
      {
        kind: 'goal',
        id: 'pages-per-day' as never,
        baseRevision: null,
        deleted: false,
        data: { id: 'pages-per-day' as never, target: 3, updatedAt: 1, changes: [] },
      },
      {
        kind: 'goal',
        id: 'cards-per-day',
        baseRevision: null,
        deleted: false,
        data: { id: 'cards-per-day', target: 0, updatedAt: 1, changes: [] },
      },
      push(session('good')),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'applied',
    ]);
  });

  it('keeps each account’s sessions to itself', async () => {
    const alice = await newAccount('studylog-alice');
    const bob = await newAccount('studylog-bob');
    await alice.services.transport.push([push(session('same-id'))]);
    await bob.services.transport.push([push(session('same-id', { answered: 9, correct: 9 }))]);

    const alicePage = await alice.services.transport.pull(0);
    expect(alicePage.changes.map((c) => (c.data as StudySession).answered)).toEqual([2]);
    const direct = await rest('study_sessions?select=id,answered', {
      token: accessToken(bob.services.storage),
    });
    expect(direct).toEqual({ status: 200, json: [{ id: 'same-id', answered: 9 }] });

    // Nobody can write the tables directly; anonymous callers cannot even read them.
    const write = await rest('study_sessions', {
      method: 'POST',
      token: accessToken(bob.services.storage),
      body: { id: 'direct', mode: 'quiz', revision: 1 },
    });
    expect([401, 403]).toContain(write.status);
    const anonymous = await rest('study_goals?select=*');
    expect([401, 403, 200]).toContain(anonymous.status);
    if (anonymous.status === 200) expect(anonymous.json).toEqual([]);
  });

  it('sends an app from before sessions existed only the kinds it understands', async () => {
    const account = await newAccount('studylog-old');
    await account.services.transport.push([push(session('hidden'))]);
    const token = accessToken(account.services.storage);
    // Exactly the request an older app makes: no `kinds`.
    const old = await rest('rpc/sync_pull', {
      method: 'POST',
      token,
      body: { since: 0, max_rows: 500 },
    });
    expect(old.status).toBe(200);
    expect((old.json as { changes: unknown[] }).changes).toEqual([]);
    const current = await account.services.transport.pull(0);
    expect(current.changes.map((c) => c.kind)).toEqual(['session']);
  });

  it('deletes the study log with the account', async () => {
    const account = await newAccount('studylog-delete');
    await account.services.transport.push([push(session('gone'))]);
    const token = accessToken(account.services.storage);
    const deleted = await rest('rpc/delete_account', { method: 'POST', token, body: {} });
    expect(deleted.status).toBe(204);
    const fresh = await newAccount('studylog-after');
    const page = await fresh.services.transport.pull(0);
    expect(page.changes).toEqual([]);
  });
});
