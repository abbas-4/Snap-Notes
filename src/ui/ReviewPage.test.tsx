import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MASTERED_INTERVAL_DAYS } from '../domain/srs';
import type { MemoryStorage } from '../test/memoryStorage';
import {
  makeAppData,
  makeCard,
  makeDeck,
  makeProgress,
  renderApp,
  storageWithProgress,
  storedProgress,
} from '../test/renderApp';

const DAY = 86_400_000;
const now = Date.now();

const biology = makeDeck({ id: 'biology', name: 'Biology' });
const myCards = makeDeck({ id: 'default', name: 'My Cards' });

const dueCard = makeCard({ id: 'due-1', term: 'Mitochondria', definition: 'The powerhouse' });
const overdueCard = makeCard({ id: 'over-1', term: 'Ribosome', definition: 'Builds proteins' });
const newCard = makeCard({ id: 'new-1', term: 'Nucleus', definition: 'Holds the DNA' });
const futureCard = makeCard({ id: 'later-1', term: 'Golgi', definition: 'Packages proteins' });

function collection() {
  return makeAppData([dueCard, overdueCard, newCard, futureCard], [myCards]);
}

/** Two cards waiting (one of them since an earlier day), one new, one scheduled. */
function waiting() {
  return [
    makeProgress({ cardId: 'due-1', dueAt: now - 60_000 }),
    makeProgress({ cardId: 'over-1', dueAt: now - 3 * DAY }),
    makeProgress({ cardId: 'later-1', dueAt: now + 5 * DAY }),
  ];
}

function record(storage: MemoryStorage, cardId: string) {
  return storedProgress(storage).records.find((entry) => entry.cardId === cardId);
}

describe('the review dashboard', () => {
  it('says what is waiting and offers to start', () => {
    renderApp({ storage: storageWithProgress(collection(), waiting()), route: '/review' });

    expect(screen.getByRole('heading', { level: 1, name: 'Review' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2 cards ready to review' })).toBeInTheDocument();
    expect(
      screen.getByText('One has been waiting since an earlier day, so it comes first.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start reviewing 2' })).toHaveAttribute(
      'href',
      '/review?mode=due',
    );
  });

  it('counts new, learning and mastered cards from the saved records', () => {
    const records = [
      makeProgress({ cardId: 'due-1', dueAt: now - 60_000, stage: 'learning', intervalDays: 0 }),
      makeProgress({
        cardId: 'later-1',
        dueAt: now + 30 * DAY,
        stage: 'mastered',
        intervalDays: MASTERED_INTERVAL_DAYS + 9,
      }),
    ];
    renderApp({ storage: storageWithProgress(collection(), records), route: '/review' });

    const newTile = screen.getByText('New').closest('div') as HTMLElement;
    expect(within(newTile).getByText('2')).toBeInTheDocument();
    const learning = screen.getByText('Learning').closest('div') as HTMLElement;
    expect(within(learning).getByText('1')).toBeInTheDocument();
    const mastered = screen.getByText('Mastered').closest('div') as HTMLElement;
    expect(within(mastered).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2 of 4')).toBeInTheDocument();
  });

  it('shows an encouraging empty state with the next review when nothing is due', () => {
    const records = [makeProgress({ cardId: 'due-1', dueAt: now + DAY })];
    renderApp({
      storage: storageWithProgress(makeAppData([dueCard], [myCards]), records),
      route: '/review',
    });

    expect(screen.getByRole('heading', { name: 'You’re all caught up!' })).toBeInTheDocument();
    expect(
      screen.getByText('Today’s reviews are done. The next card is due tomorrow.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Start reviewing/ })).not.toBeInTheDocument();
  });

  it('offers new, difficult and whole-collection sessions with their sizes', () => {
    const records = [
      ...waiting(),
      makeProgress({ cardId: 'due-1', dueAt: now - 60_000, ease: 1.5, incorrect: 3, reviews: 5 }),
    ];
    renderApp({ storage: storageWithProgress(collection(), records), route: '/review' });

    expect(screen.getByRole('link', { name: 'Learn new cards (1)' })).toHaveAttribute(
      'href',
      '/review?mode=new',
    );
    expect(screen.getByRole('link', { name: 'Practise difficult cards (1)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review everything (4)' })).toHaveAttribute(
      'href',
      '/review?mode=all',
    );
  });

  it('lists decks with what each one has waiting', () => {
    const data = makeAppData(
      [dueCard, makeCard({ id: 'bio-1', deckId: 'biology' })],
      [myCards, biology],
    );
    renderApp({
      storage: storageWithProgress(data, [makeProgress({ cardId: 'due-1', dueAt: now - DAY })]),
      route: '/review',
    });

    expect(screen.getByRole('link', { name: 'Review Biology' })).toHaveAttribute(
      'href',
      '/review?deck=biology',
    );
    expect(screen.getByText('1 due · 1 card')).toBeInTheDocument();
  });

  it('narrows to one deck, and says so', () => {
    const data = makeAppData(
      [dueCard, makeCard({ id: 'bio-1', deckId: 'biology', term: 'Osmosis', definition: 'Water' })],
      [myCards, biology],
    );
    renderApp({
      storage: storageWithProgress(data, [makeProgress({ cardId: 'due-1', dueAt: now - DAY })]),
      route: '/review?deck=biology',
    });

    expect(screen.getByText('Biology')).toBeInTheDocument();
    // The due card belongs to the other deck, so this one has nothing waiting.
    expect(screen.getByRole('heading', { name: 'You’re all caught up!' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Learn new cards (1)' })).toHaveAttribute(
      'href',
      '/review?mode=new&deck=biology',
    );
  });

  it('says so when the deck in the link is gone', () => {
    renderApp({
      storage: storageWithProgress(collection(), waiting()),
      route: '/review?deck=missing',
    });
    expect(screen.getByRole('heading', { name: 'Deck not found' })).toBeInTheDocument();
  });
});

describe('a review session', () => {
  it('shows due cards first, and grades them', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(collection(), waiting());
    renderApp({ storage, route: '/review?mode=due' });

    // The card waiting longest comes first.
    expect(screen.getByRole('heading', { level: 2, name: 'Ribosome' })).toBeInTheDocument();
    expect(screen.getByText('0 of 2 done')).toBeInTheDocument();
    expect(screen.queryByText('Builds proteins')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(screen.getByText('Builds proteins')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Good/ }));

    const saved = record(storage, 'over-1');
    expect(saved).toMatchObject({ reviews: 2, correct: 2, streak: 2 });
    expect(saved!.dueAt).toBeGreaterThan(Date.now());
    expect(screen.getByRole('heading', { level: 2, name: 'Mitochondria' })).toBeInTheDocument();
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
  });

  it('brings a card graded "Again" back before the session ends', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(collection(), waiting());
    renderApp({ storage, route: '/review?mode=due' });

    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Again/ }));

    const saved = record(storage, 'over-1');
    expect(saved).toMatchObject({ incorrect: 1, streak: 0, intervalDays: 0, stage: 'learning' });
    expect(saved!.dueAt).toBeLessThan(Date.now() + 15 * 60_000);

    // The next card is shown, and the missed one is still to come.
    expect(screen.getByRole('heading', { level: 2, name: 'Mitochondria' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Ribosome' })).toBeInTheDocument();
  });

  it('can be graded from the keyboard', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(collection(), waiting());
    renderApp({ storage, route: '/review?mode=due' });

    await user.keyboard(' ');
    expect(screen.getByText('Builds proteins')).toBeInTheDocument();
    await user.keyboard('4');

    expect(record(storage, 'over-1')).toMatchObject({ correct: 2 });
    expect(screen.getByRole('heading', { level: 2, name: 'Mitochondria' })).toBeInTheDocument();
  });

  it('finishes with a summary of what was graded', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(makeAppData([dueCard], [myCards]), [
      makeProgress({ cardId: 'due-1', dueAt: now - DAY }),
    ]);
    renderApp({ storage, route: '/review?mode=due' });

    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Easy/ }));

    expect(screen.getByRole('heading', { name: 'Review complete' })).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(
      screen.getByText(/You graded 1 answer, 100% remembered. Every card has been rescheduled./),
    ).toBeInTheDocument();
  });

  it('starts new cards and schedules them for the first time', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(collection(), waiting());
    renderApp({ storage, route: '/review?mode=new' });

    expect(screen.getByRole('heading', { level: 2, name: 'Nucleus' })).toBeInTheDocument();
    expect(screen.getByText('New card')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));

    expect(record(storage, 'new-1')).toMatchObject({
      reviews: 1,
      correct: 1,
      streak: 1,
      intervalDays: 1,
      deckId: 'default',
    });
  });

  it('ends early and keeps what was already graded', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(collection(), waiting());
    renderApp({ storage, route: '/review?mode=due' });

    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Hard/ }));
    await user.click(screen.getByRole('button', { name: 'End session' }));

    expect(screen.getByRole('heading', { name: 'Session ended' })).toBeInTheDocument();
    expect(record(storage, 'over-1')?.reviews).toBe(2);
    expect(screen.getByRole('button', { name: 'Finish the last 1' })).toBeInTheDocument();
  });

  it('explains an empty session instead of showing a blank screen', () => {
    renderApp({
      storage: storageWithProgress(collection(), waiting()),
      route: '/review?mode=difficult',
    });

    expect(screen.getByRole('heading', { name: 'No difficult cards' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to review' })).toHaveAttribute('href', '/review');
  });

  it('only reviews the deck in the link', async () => {
    const user = userEvent.setup();
    const data = makeAppData(
      [dueCard, makeCard({ id: 'bio-1', deckId: 'biology', term: 'Osmosis', definition: 'Water' })],
      [myCards, biology],
    );
    const storage = storageWithProgress(data, [
      makeProgress({ cardId: 'due-1', dueAt: now - DAY }),
      makeProgress({ cardId: 'bio-1', deckId: 'biology', dueAt: now - DAY }),
    ]);
    renderApp({ storage, route: '/review?mode=due&deck=biology' });

    expect(screen.getByRole('heading', { level: 2, name: 'Osmosis' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));

    expect(screen.getByRole('heading', { name: 'Review complete' })).toBeInTheDocument();
    expect(record(storage, 'due-1')?.reviews).toBe(1);
  });
});

describe('progress that lasts', () => {
  it('is still there after the app is closed and opened again', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(collection(), waiting());
    const first = renderApp({ storage, route: '/review?mode=due' });

    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));
    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));
    first.unmount();

    // A fresh start reading the same browser storage, as a reload would.
    renderApp({ storage, route: '/review' });
    expect(screen.getByRole('heading', { name: 'You’re all caught up!' })).toBeInTheDocument();
    const reviewed = screen.getByText('Cards reviewed').closest('div') as HTMLElement;
    expect(within(reviewed).getByText('3 of 4')).toBeInTheDocument();
  });

  it('runs without saving when browser storage is unavailable', async () => {
    const user = userEvent.setup();
    renderApp({ storage: null, route: '/review' });

    expect(screen.getByRole('heading', { level: 1, name: 'Review' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Your statistics' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your progress' })).toBeInTheDocument();
  });

  it('keeps going when the saved progress is unreadable', () => {
    const storage = storageWithProgress(collection(), waiting());
    storage.setItem('snapnotes.progress.v1', 'not json at all');
    renderApp({ storage, route: '/review' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Saved review progress could not be read, so it has been started again.',
    );
    // The cards are untouched, and everything counts as new again.
    expect(screen.getByRole('heading', { name: 'You’re all caught up!' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Learn new cards (4)' })).toBeInTheDocument();
  });
});
