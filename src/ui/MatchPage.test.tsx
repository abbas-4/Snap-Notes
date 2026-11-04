import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCard, renderApp, storageWithCards } from '../test/renderApp';

const capitals = [
  makeCard({ term: 'France', definition: 'Paris' }),
  makeCard({ term: 'Germany', definition: 'Berlin' }),
  makeCard({ term: 'Italy', definition: 'Rome' }),
];
const definitionOf = new Map(capitals.map((card) => [card.term, card.definition]));

function renderMatch(cards = capitals) {
  return renderApp({ storage: storageWithCards(cards), route: '/match' });
}

function tiles(list: 'Terms' | 'Definitions') {
  return within(screen.getByRole('list', { name: list })).getAllByRole('button');
}

function tileText(button: HTMLElement) {
  return button.querySelector('span')?.textContent ?? '';
}

function tile(list: 'Terms' | 'Definitions', text: string) {
  const found = tiles(list).find((button) => tileText(button) === text);
  if (!found) throw new Error(`No ${list} tile "${text}"`);
  return found;
}

function term(text: string) {
  return tile('Terms', text);
}

function definition(text: string) {
  return tile('Definitions', text);
}

function wrongDefinitionFor(termText: string) {
  return [...definitionOf.values()].find((d) => d !== definitionOf.get(termText))!;
}

function statusText() {
  return screen.getByRole('status').textContent;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MatchPage', () => {
  describe('with too few cards', () => {
    it('explains that there are no cards', () => {
      renderApp({ route: '/match' });

      expect(
        screen.getByRole('heading', { name: 'Not enough cards to match' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/You have no cards yet/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Add a card' })).toBeInTheDocument();
    });

    it('needs two cards with different terms and definitions', () => {
      renderMatch([
        makeCard({ term: 'One', definition: 'Same' }),
        makeCard({ term: 'Two', definition: ' same ' }),
      ]);

      expect(
        screen.getByRole('heading', { name: 'Not enough cards to match' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Terms' })).not.toBeInTheDocument();
    });
  });

  it('shows every term and definition, shuffled into two lists', () => {
    renderMatch();

    expect(tiles('Terms').map(tileText).sort()).toEqual(['France', 'Germany', 'Italy']);
    expect(tiles('Definitions').map(tileText).sort()).toEqual(['Berlin', 'Paris', 'Rome']);
    expect(screen.getByText('Matched 0 of 3')).toBeInTheDocument();
    expect(screen.getByText(/^Mistakes:/)).toHaveTextContent('Mistakes: 0');
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
  });

  it('uses at most six pairs per round', () => {
    renderMatch(
      Array.from({ length: 9 }, (_, i) => makeCard({ term: `T${i}`, definition: `D${i}` })),
    );

    expect(tiles('Terms')).toHaveLength(6);
    expect(tiles('Definitions')).toHaveLength(6);
    expect(screen.getByText('Matched 0 of 6')).toBeInTheDocument();
  });

  it('marks the selected tile', async () => {
    const user = userEvent.setup();
    renderMatch();

    await user.click(term('France'));
    expect(term('France')).toHaveAttribute('aria-pressed', 'true');
    expect(term('France')).toHaveTextContent('Selected');
    expect(statusText()).toBe('Selected term: France. Now choose its definition.');

    // Another term replaces the selection; the same tile again clears it.
    await user.click(term('Italy'));
    expect(term('France')).toHaveAttribute('aria-pressed', 'false');
    expect(term('Italy')).toHaveAttribute('aria-pressed', 'true');
    await user.click(term('Italy'));
    expect(term('Italy')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/^Mistakes:/)).toHaveTextContent('Mistakes: 0');
  });

  it('locks in a correct pair', async () => {
    const user = userEvent.setup();
    renderMatch();

    await user.click(term('France'));
    await user.click(definition('Paris'));

    for (const button of [term('France'), definition('Paris')]) {
      expect(button).toHaveTextContent('Matched');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toHaveAttribute('aria-pressed');
    }
    expect(screen.getByText('Matched 1 of 3')).toBeInTheDocument();
    expect(statusText()).toBe('Match: France — Paris. 1 of 3 matched.');
    // Focus stays on the tile the user pressed.
    expect(definition('Paris')).toHaveFocus();

    // Matched tiles can't be picked again.
    await user.click(term('France'));
    expect(term('France')).not.toHaveTextContent('Selected');
  });

  it('marks a wrong pair until the next pick and counts a mistake', async () => {
    const user = userEvent.setup();
    renderMatch();
    const wrong = wrongDefinitionFor('Germany');

    await user.click(definition(wrong));
    await user.click(term('Germany'));

    expect(term('Germany')).toHaveTextContent('Not a match');
    expect(definition(wrong)).toHaveTextContent('Not a match');
    expect(screen.getByText(/^Mistakes:/)).toHaveTextContent('Mistakes: 1');
    expect(screen.getByText('Matched 0 of 3')).toBeInTheDocument();
    expect(statusText()).toBe(`Not a match: Germany and ${wrong}. Mistakes: 1.`);

    // Both tiles are still in play, and the marks clear on the next pick.
    await user.click(term('Germany'));
    expect(term('Germany')).toHaveTextContent('Selected');
    expect(definition(wrong)).not.toHaveTextContent('Not a match');
  });

  it('times the round from the first pick to the last match', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderMatch();

    // Reading the board doesn't count.
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');

    await user.click(term('France'));
    act(() => vi.advanceTimersByTime(65_000));
    expect(screen.getByRole('timer')).toHaveTextContent('1:05');
    expect(screen.getByRole('timer')).toHaveAccessibleName('Time 1 minute 5 seconds');

    await user.click(definition('Paris'));
    await user.click(term('Germany'));
    await user.click(definition('Berlin'));
    await user.click(term('Italy'));
    await user.click(definition('Rome'));

    expect(screen.getByRole('heading', { name: 'All matched!' })).toBeInTheDocument();
    expect(screen.getByText(/You matched 3 pairs in 1 minute 5 seconds/)).toBeInTheDocument();

    // The final time no longer moves.
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText(/You matched 3 pairs in 1 minute 5 seconds/)).toBeInTheDocument();
  });

  it('shows a completion screen and can play again', async () => {
    const user = userEvent.setup();
    renderMatch();

    await user.click(term('France'));
    await user.click(definition(wrongDefinitionFor('France')));
    for (const [t, d] of definitionOf) {
      await user.click(term(t));
      await user.click(definition(d));
    }

    expect(screen.getByRole('heading', { name: 'All matched!' })).toHaveFocus();
    expect(screen.getByText(/with 1 mistake \(75% accuracy\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New round' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Play again' }));
    expect(screen.getByText('Matched 0 of 3')).toBeInTheDocument();
    expect(screen.getByText(/^Mistakes:/)).toHaveTextContent('Mistakes: 0');
    expect(screen.getByRole('heading', { name: 'Terms' })).toHaveFocus();
  });

  it('starts a new round mid-game', async () => {
    const user = userEvent.setup();
    renderMatch();

    await user.click(term('France'));
    await user.click(definition('Paris'));
    await user.click(screen.getByRole('button', { name: 'New round' }));

    expect(screen.getByText('Matched 0 of 3')).toBeInTheDocument();
    expect(term('France')).not.toHaveTextContent('Matched');
  });

  it('can be played with the keyboard alone', async () => {
    const user = userEvent.setup();
    renderMatch();

    for (const [t, d] of definitionOf) {
      term(t).focus();
      await user.keyboard('{Enter}');
      definition(d).focus();
      await user.keyboard(' ');
    }

    expect(screen.getByRole('heading', { name: 'All matched!' })).toHaveFocus();
  });

  it('keeps HTML-like text as plain text', () => {
    renderMatch([
      makeCard({ term: '<img src=x onerror=alert(1)>', definition: '<b>x</b>' }),
      makeCard({ term: 'Plain', definition: 'Text' }),
    ]);

    expect(tiles('Terms').map(tileText)).toContain('<img src=x onerror=alert(1)>');
    expect(tiles('Definitions').map(tileText)).toContain('<b>x</b>');
    expect(document.querySelector('main img, main b')).toBeNull();
  });
});
