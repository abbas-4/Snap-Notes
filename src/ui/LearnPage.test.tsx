import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCard, renderApp, storageWithCards } from '../test/renderApp';

const cards = [
  makeCard({ term: 'Mitochondria', definition: 'Powerhouse of the cell' }),
  makeCard({ term: 'Ribosome', definition: 'Builds proteins' }),
  makeCard({ term: 'Nucleus', definition: 'Holds the DNA' }),
];
const definitions = new Map(cards.map((card) => [card.term, card.definition]));

function renderLearn(learnCards = cards) {
  return renderApp({ storage: storageWithCards(learnCards), route: '/learn' });
}

function term() {
  return document.getElementById('learn-term')?.textContent ?? null;
}

function definitionRegion() {
  return document.getElementById('learn-definition');
}

function button(name: string | RegExp) {
  return screen.getByRole('button', { name });
}

function progressText() {
  return screen.getByText(/^Mastered \d+ of \d+$/).textContent;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LearnPage', () => {
  it('explains what to do when there are no cards', () => {
    renderApp({ route: '/learn' });

    expect(screen.getByRole('heading', { name: 'No cards to learn' })).toBeInTheDocument();
    expect(screen.getByText(/You have no cards yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a card' })).toBeInTheDocument();
  });

  it('explains when every card is missing a side', () => {
    renderLearn([makeCard({ term: '', definition: 'Orphan' })]);

    expect(screen.getByRole('heading', { name: 'No cards to learn' })).toBeInTheDocument();
    expect(screen.getByText(/1 card is missing a term or definition/)).toBeInTheDocument();
  });

  it('shows the term first and reveals the definition on request', async () => {
    const user = userEvent.setup();
    renderLearn();

    expect(definitions.has(term()!)).toBe(true);
    expect(progressText()).toBe('Mastered 0 of 3');
    expect(screen.getByText('3 to go')).toBeInTheDocument();
    expect(definitionRegion()).toBeNull();
    expect(screen.queryByRole('button', { name: 'I know it' })).not.toBeInTheDocument();

    await user.click(button('Show definition'));

    expect(definitionRegion()).toHaveTextContent(definitions.get(term()!)!);
    expect(definitionRegion()).toHaveFocus();
    expect(button('Still learning')).toBeInTheDocument();
    expect(button('I know it')).toBeInTheDocument();
  });

  it('masters a known card and moves on to the next one', async () => {
    const user = userEvent.setup();
    renderLearn();
    const first = term();

    await user.click(button('Show definition'));
    await user.click(button('I know it'));

    expect(term()).not.toBe(first);
    expect(progressText()).toBe('Mastered 1 of 3');
    expect(screen.getByText('2 to go')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Marked as known. 1 of 3 mastered.');
    expect(screen.getByRole('heading', { level: 2, name: term()! })).toHaveFocus();
  });

  it('brings a card the user is still learning back for review', async () => {
    const user = userEvent.setup();
    renderLearn();
    const missed = term()!;

    await user.click(button('Show definition'));
    await user.click(button('Still learning'));
    expect(screen.getByRole('status')).toHaveTextContent('Marked as still learning');
    expect(progressText()).toBe('Mastered 0 of 3');
    expect(screen.getByText('3 to go')).toBeInTheDocument();

    // With three cards, the missed card comes back after the other two.
    for (let i = 0; i < 2; i++) {
      expect(term()).not.toBe(missed);
      await user.click(button('Show definition'));
      await user.click(button('I know it'));
    }
    expect(term()).toBe(missed);
    expect(screen.getByText('Review · missed 1 time')).toBeInTheDocument();
  });

  it('finishes with a summary and can review the missed cards', async () => {
    const user = userEvent.setup();
    renderLearn();
    const missed = term()!;

    await user.click(button('Show definition'));
    await user.click(button('Still learning'));
    while (screen.queryByRole('button', { name: 'Show definition' })) {
      await user.click(button('Show definition'));
      await user.click(button('I know it'));
    }

    const heading = screen.getByRole('heading', { name: 'All cards mastered' });
    expect(heading).toHaveFocus();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByText(/2 known on the first try, 1 needed review/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cards that needed review' })).toBeInTheDocument();
    expect(screen.getByText('Missed 1 time')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument();

    await user.click(button('Review 1 card again'));
    expect(term()).toBe(missed);
    expect(progressText()).toBe('Mastered 0 of 1');
  });

  it('can start over with every card', async () => {
    const user = userEvent.setup();
    renderLearn();

    for (let i = 0; i < 3; i++) {
      await user.click(button('Show definition'));
      await user.click(button('I know it'));
    }
    expect(screen.queryByRole('button', { name: /again$/ })).not.toBeInTheDocument();

    await user.click(button('Start over'));
    expect(progressText()).toBe('Mastered 0 of 3');
    expect(screen.getByRole('heading', { level: 2, name: term()! })).toHaveFocus();
  });

  it('can end the session early', async () => {
    const user = userEvent.setup();
    renderLearn();

    await user.click(button('Show definition'));
    await user.click(button('I know it'));
    await user.click(button('End session'));

    expect(screen.getByRole('heading', { name: 'Session ended' })).toHaveFocus();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText(/2 not mastered yet/)).toBeInTheDocument();
    expect(button('Review 2 cards again')).toBeInTheDocument();
  });

  it('supports the keyboard: Space reveals, 1 and 2 grade', async () => {
    const user = userEvent.setup();
    renderLearn();
    const first = term()!;

    // Grading before the definition shows does nothing.
    await user.keyboard('2');
    expect(progressText()).toBe('Mastered 0 of 3');

    await user.keyboard(' ');
    expect(definitionRegion()).toBeInTheDocument();
    await user.keyboard('1');
    expect(screen.getByRole('status')).toHaveTextContent('Marked as still learning');
    expect(term()).not.toBe(first);

    await user.keyboard(' ');
    await user.keyboard('2');
    expect(progressText()).toBe('Mastered 1 of 3');
  });

  it('grades only once when a key is held down or pressed twice quickly', async () => {
    const user = userEvent.setup();
    renderLearn();

    await user.keyboard(' ');
    await user.keyboard('{2>3}');
    expect(progressText()).toBe('Mastered 1 of 3');
    expect(definitionRegion()).toBeNull();
  });

  it('lets Space press a focused button without also revealing the card', async () => {
    const user = userEvent.setup();
    renderLearn();

    button('End session').focus();
    await user.keyboard(' ');

    expect(screen.getByRole('heading', { name: 'Session ended' })).toBeInTheDocument();
  });

  it('skips cards missing a side', () => {
    renderLearn([...cards, makeCard({ term: 'Blank', definition: '  ' })]);

    expect(progressText()).toBe('Mastered 0 of 3');
  });

  it('keeps HTML-like text as plain text', async () => {
    const user = userEvent.setup();
    renderLearn([makeCard({ term: '<img src=x onerror=alert(1)>', definition: '<b>x</b>' })]);

    expect(term()).toBe('<img src=x onerror=alert(1)>');
    await user.click(button('Show definition'));
    expect(definitionRegion()).toHaveTextContent('<b>x</b>');
    expect(document.querySelector('main img, main b')).toBeNull();
  });

  it('exits to the home page and stops listening for keys', async () => {
    const user = userEvent.setup();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    renderLearn();

    await user.click(screen.getByRole('link', { name: 'Exit learn' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();

    const keydownHandlers = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === 'keydown').map(([, handler]) => handler);
    expect(keydownHandlers(add).length).toBeGreaterThan(0);
    expect(new Set(keydownHandlers(remove))).toEqual(new Set(keydownHandlers(add)));
  });
});
