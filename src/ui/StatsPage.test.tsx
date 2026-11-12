import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { addDays, dayKey } from '../domain/srs';
import {
  makeAppData,
  makeCard,
  makeDeck,
  makeProgress,
  renderApp,
  storageWithProgress,
  storedCards,
  storedProgress,
} from '../test/renderApp';

const DAY = 86_400_000;
const now = Date.now();
const myCards = makeDeck({ id: 'default', name: 'My Cards' });

const first = makeCard({ id: 'card-1', term: 'Mitosis', definition: 'Cell division' });
const second = makeCard({ id: 'card-2', term: 'Osmosis', definition: 'Water moves' });
const third = makeCard({ id: 'card-3', term: 'Enzyme', definition: 'A catalyst' });

function data() {
  return makeAppData([first, second, third], [myCards]);
}

function records() {
  return [
    makeProgress({ cardId: 'card-1', reviews: 4, correct: 3, incorrect: 1, dueAt: now + DAY }),
    makeProgress({
      cardId: 'card-2',
      reviews: 6,
      correct: 6,
      incorrect: 0,
      stage: 'mastered',
      intervalDays: 30,
      dueAt: now + 10 * DAY,
    }),
  ];
}

function history() {
  return [
    { day: dayKey(addDays(now, -2)), reviews: 4, correct: 3 },
    { day: dayKey(addDays(now, -1)), reviews: 3, correct: 3 },
    { day: dayKey(now), reviews: 3, correct: 3 },
  ];
}

function tile(label: string): HTMLElement {
  return screen.getByText(label).closest('div') as HTMLElement;
}

describe('the statistics page', () => {
  it('reports totals taken from the saved records', () => {
    renderApp({
      storage: storageWithProgress(data(), records(), history()),
      route: '/stats',
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Your progress' })).toBeInTheDocument();
    expect(within(tile('Reviews completed')).getByText('10')).toBeInTheDocument();
    expect(within(tile('Reviews completed')).getByText('9 correct · 1 missed')).toBeInTheDocument();
    expect(within(tile('Accuracy')).getByText('90%')).toBeInTheDocument();
    expect(within(tile('Cards mastered')).getByText('1 of 3')).toBeInTheDocument();
  });

  it('counts today’s reviews and the streak from the activity log', () => {
    renderApp({
      storage: storageWithProgress(data(), records(), history()),
      route: '/stats',
    });

    expect(within(tile('Reviewed today')).getByText('3 reviews')).toBeInTheDocument();
    expect(within(tile('Current streak')).getByText('3 days')).toBeInTheDocument();
    expect(within(tile('Longest streak')).getByText('3 days')).toBeInTheDocument();
    expect(screen.getByText('10 reviews in the last 14 days.')).toBeInTheDocument();
  });

  it('lists the reviews coming up', () => {
    renderApp({
      storage: storageWithProgress(data(), records(), history()),
      route: '/stats',
    });

    const upcoming = screen.getByRole('heading', { name: 'Coming up' })
      .parentElement as HTMLElement;
    expect(within(upcoming).getByText(/tomorrow/)).toBeInTheDocument();
    expect(within(upcoming).getByText('1 card')).toBeInTheDocument();
  });

  it('invents nothing for a collection that has never been reviewed', () => {
    renderApp({ storage: storageWithProgress(data()), route: '/stats' });

    expect(screen.getByRole('heading', { name: 'No reviews yet' })).toBeInTheDocument();
    expect(screen.queryByText('Accuracy')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start reviewing' })).toHaveAttribute(
      'href',
      '/review',
    );
  });

  it('shows the day-by-day activity as text for screen readers', () => {
    renderApp({
      storage: storageWithProgress(data(), records(), history()),
      route: '/stats',
    });

    const chart = screen.getByRole('heading', { name: /Last 14 days/ })
      .parentElement as HTMLElement;
    expect(
      within(chart)
        .getAllByRole('listitem')
        .some((item) => /3 reviews/.test(item.textContent ?? '')),
    ).toBe(true);
  });
});

describe('resetting all progress', () => {
  it('asks before it forgets anything', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(data(), records(), history());
    renderApp({ storage, route: '/stats' });

    await user.click(screen.getByRole('button', { name: 'Reset all progress' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Reset the learning progress for every card?' }),
    ).toBeInTheDocument();
    expect(storedProgress(storage).records).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(storedProgress(storage).records).toHaveLength(2);
  });

  it('forgets every record and streak, and keeps every card', async () => {
    const user = userEvent.setup();
    const storage = storageWithProgress(data(), records(), history());
    renderApp({ storage, route: '/stats' });

    await user.click(screen.getByRole('button', { name: 'Reset all progress' }));
    await user.click(screen.getByRole('button', { name: 'Yes, reset progress' }));

    expect(storedProgress(storage)).toMatchObject({ records: [], history: [] });
    expect(storedCards(storage).map((card) => card.id)).toEqual(['card-1', 'card-2', 'card-3']);
    expect(
      screen.getByText('All learning progress has been reset. Your cards and decks are unchanged.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No reviews yet' })).toBeInTheDocument();
  });

  it('says there is nothing to reset when nothing has been reviewed', () => {
    renderApp({ storage: storageWithProgress(data()), route: '/stats' });

    expect(screen.getByText('There is no learning progress to reset yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset all progress' })).not.toBeInTheDocument();
  });
});
