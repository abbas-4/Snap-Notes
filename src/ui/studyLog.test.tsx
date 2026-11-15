import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ANALYTICS_STORAGE_KEY, type AnalyticsData } from '../storage/analyticsStore';
import { PROGRESS_STORAGE_KEY } from '../storage/progressStore';
import type { MemoryStorage } from '../test/memoryStorage';
import { makeCard, renderApp, storageWithCards } from '../test/renderApp';

/**
 * Every study mode that has answers writes them to the study log, as it
 * happens, without changing how the mode itself works.
 */

const capitals = [
  makeCard({ id: 'fr', term: 'France', definition: 'Paris' }),
  makeCard({ id: 'de', term: 'Germany', definition: 'Berlin' }),
  makeCard({ id: 'it', term: 'Italy', definition: 'Rome' }),
  makeCard({ id: 'es', term: 'Spain', definition: 'Madrid' }),
];
const capitalOf = new Map(capitals.map((card) => [card.term, card.definition]));
const idOf = new Map(capitals.map((card) => [card.term, card.id]));

function log(storage: MemoryStorage): AnalyticsData {
  const raw = storage.getItem(ANALYTICS_STORAGE_KEY);
  return raw === null
    ? { version: 1, sessions: [], goals: [] }
    : (JSON.parse(raw) as AnalyticsData);
}

describe('recording answers', () => {
  it('Review: each grade, timed, in one session alongside the saved progress', async () => {
    const user = userEvent.setup();
    const storage = storageWithCards(capitals);
    renderApp({ storage, route: '/review?mode=new' });
    for (const grade of [/^Good/, /^Again/]) {
      await user.click(await screen.findByRole('button', { name: 'Show answer' }));
      await user.click(screen.getByRole('button', { name: grade }));
    }
    const [session] = log(storage).sessions;
    expect(session).toMatchObject({ mode: 'review', deckId: null, answered: 2, correct: 1 });
    expect(session?.timedAnswers).toBe(2);
    expect(log(storage).sessions).toHaveLength(1);
    // The day's review log says the same, so analytics can tell the two apart.
    const history = JSON.parse(storage.getItem(PROGRESS_STORAGE_KEY)!).history;
    expect(history[0]).toMatchObject({ reviews: 2, correct: 1 });
  });

  it('Quiz: each answer once, and a restart starts a new session', async () => {
    const user = userEvent.setup();
    const storage = storageWithCards(capitals);
    renderApp({ storage, route: '/quiz' });
    const question = () => screen.getByRole('heading', { level: 2 }).textContent!;
    const choices = () =>
      within(screen.getByRole('list', { name: 'Answer choices' })).getAllByRole('button');

    const first = question();
    await user.click(
      choices().find((b) => b.textContent!.slice(1).startsWith(capitalOf.get(first)!))!,
    );
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    const second = question();
    await user.click(
      choices().find((b) => !b.textContent!.slice(1).startsWith(capitalOf.get(second)!))!,
    );

    let sessions = log(storage).sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ mode: 'quiz', answered: 2, correct: 1 });
    expect(sessions[0]?.results).toEqual([
      { cardId: idOf.get(first), correct: 1, incorrect: 0 },
      { cardId: idOf.get(second), correct: 0, incorrect: 1 },
    ]);

    await user.click(screen.getByRole('button', { name: 'Restart' }));
    await user.click(choices()[0]!);
    sessions = log(storage).sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[1]?.answered).toBe(1);
  });

  it('Learn: "know it" as correct and "still learning" as missed, on the deck in scope', async () => {
    const user = userEvent.setup();
    const storage = storageWithCards(capitals);
    renderApp({ storage, route: '/learn?deck=default' });
    await user.keyboard(' ');
    await user.keyboard('1');
    await user.keyboard(' ');
    await user.keyboard('2');
    const [session] = log(storage).sessions;
    expect(session).toMatchObject({ mode: 'learn', deckId: 'default', answered: 2, correct: 1 });
    expect(session?.results).toHaveLength(2);
  });

  it('Match: each pairing against its term’s card', async () => {
    const user = userEvent.setup();
    const storage = storageWithCards(capitals);
    renderApp({ storage, route: '/match' });
    const tiles = (list: string) =>
      within(screen.getByRole('list', { name: list })).getAllByRole('button');
    const text = (button: HTMLElement) => button.querySelector('span')?.textContent ?? '';
    const term = tiles('Terms')[0]!;
    const name = text(term);
    const wrong = tiles('Definitions').find((b) => text(b) !== capitalOf.get(name))!;
    await user.click(term);
    await user.click(wrong);
    await user.click(term);
    await user.click(tiles('Definitions').find((b) => text(b) === capitalOf.get(name))!);

    const [session] = log(storage).sessions;
    expect(session).toMatchObject({ mode: 'match', answered: 2, correct: 1, timedAnswers: 0 });
    expect(session?.results).toEqual([{ cardId: idOf.get(name), correct: 1, incorrect: 1 }]);
  });

  it('Study (flipping cards) records nothing: it has no answers', async () => {
    const user = userEvent.setup();
    const storage = storageWithCards(capitals);
    renderApp({ storage, route: '/study' });
    await user.keyboard(' ');
    await user.keyboard('{ArrowRight}');
    expect(log(storage).sessions).toEqual([]);
  });
});

describe('resetting all progress', () => {
  it('forgets the study sessions too, but keeps goals, cards and decks', async () => {
    const user = userEvent.setup();
    const storage = storageWithCards(capitals);
    storage.setItem(
      ANALYTICS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sessions: [],
        goals: [{ id: 'cards-per-day', target: 5, updatedAt: 1, changes: [{ at: 1, target: 5 }] }],
      }),
    );
    renderApp({ storage, route: '/review?mode=new' });
    await user.click(await screen.findByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));
    expect(log(storage).sessions).toHaveLength(1);

    await user.click(screen.getByRole('link', { name: 'Review' }));
    await user.click(await screen.findByRole('link', { name: /statistics|progress/i }));
    await user.click(await screen.findByRole('button', { name: 'Reset all progress' }));
    await user.click(screen.getByRole('button', { name: 'Yes, reset progress' }));
    expect(log(storage).sessions).toEqual([]);
    expect(log(storage).goals).toHaveLength(1);
    expect(JSON.parse(storage.getItem(PROGRESS_STORAGE_KEY)!).history).toEqual([]);
  });
});
