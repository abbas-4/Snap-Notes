import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCard, renderApp, storageWithCards } from '../test/renderApp';

const cards = [
  makeCard({ term: 'Mitochondria', definition: 'Powerhouse of the cell' }),
  makeCard({ term: 'Ribosome', definition: 'Builds proteins' }),
  makeCard({ term: 'Nucleus', definition: 'Holds the DNA' }),
];

function renderStudy(studyCards = cards) {
  return renderApp({ storage: storageWithCards(studyCards), route: '/study' });
}

function term() {
  return screen.getByRole('heading', { level: 2 }).textContent;
}

function definitionRegion() {
  return document.getElementById('study-definition')!;
}

function button(name: string | RegExp) {
  return screen.getByRole('button', { name });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StudyPage', () => {
  it('explains what to do when there are no cards', () => {
    renderApp({ route: '/study' });

    expect(screen.getByRole('heading', { name: 'No cards to study' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a card' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('shows the term first and reveals the definition on request', async () => {
    const user = userEvent.setup();
    renderStudy();

    expect(term()).toBe('Mitochondria');
    expect(screen.getByText('Card 1 of 3')).toBeInTheDocument();
    expect(definitionRegion()).not.toBeVisible();
    expect(button('Show definition')).toHaveAttribute('aria-expanded', 'false');

    await user.click(button('Show definition'));
    expect(definitionRegion()).toBeVisible();
    expect(definitionRegion()).toHaveTextContent('Powerhouse of the cell');
    expect(button('Hide definition')).toHaveAttribute('aria-expanded', 'true');

    await user.click(button('Hide definition'));
    expect(definitionRegion()).not.toBeVisible();
  });

  it('moves between cards, hiding the definition on each new card', async () => {
    const user = userEvent.setup();
    renderStudy();

    await user.click(button('Show definition'));
    await user.click(button('Next'));
    expect(term()).toBe('Ribosome');
    expect(screen.getByText('Card 2 of 3')).toBeInTheDocument();
    expect(definitionRegion()).not.toBeVisible();

    await user.click(button('Previous'));
    expect(term()).toBe('Mitochondria');
    expect(screen.getByText('Card 1 of 3')).toBeInTheDocument();
  });

  it('stays within the first and last cards', async () => {
    const user = userEvent.setup();
    renderStudy();

    expect(button('Previous')).toHaveAttribute('aria-disabled', 'true');
    await user.click(button('Previous'));
    expect(term()).toBe('Mitochondria');

    await user.click(button('Next'));
    await user.click(button('Next'));
    expect(term()).toBe('Nucleus');
    expect(button('Next')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/That’s the last card/)).toBeInTheDocument();

    await user.click(button('Next'));
    await user.click(button('Next'));
    expect(term()).toBe('Nucleus');
    expect(screen.getByText('Card 3 of 3')).toBeInTheDocument();
    // Focus stays on the control the user pressed instead of falling to the page.
    expect(button('Next')).toHaveFocus();
  });

  it('starts over from the first card', async () => {
    const user = userEvent.setup();
    renderStudy();

    expect(button('Start over')).toHaveAttribute('aria-disabled', 'true');
    await user.click(button('Next'));
    await user.click(button('Next'));
    await user.click(button('Start over'));

    expect(term()).toBe('Mitochondria');
    expect(screen.getByText('Card 1 of 3')).toBeInTheDocument();
  });

  it('works with one card: nothing to move to or shuffle', async () => {
    const user = userEvent.setup();
    renderStudy([makeCard({ term: 'Alone', definition: 'Just me' })]);

    expect(screen.getByText('Card 1 of 1')).toBeInTheDocument();
    expect(button('Previous')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Next')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Shuffle')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText(/That’s the last card/)).not.toBeInTheDocument();

    await user.click(button('Next'));
    await user.click(button('Shuffle'));
    expect(term()).toBe('Alone');

    await user.click(button('Show definition'));
    expect(definitionRegion()).toHaveTextContent('Just me');
  });

  it('shuffles the order and can switch back to the original order', async () => {
    const user = userEvent.setup();
    // With random() always 0, shuffling [A, B, C] gives [B, C, A].
    vi.spyOn(Math, 'random').mockReturnValue(0);
    renderStudy();

    await user.click(button('Next'));
    await user.click(button('Shuffle'));
    expect(button('Shuffle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Card 1 of 3')).toBeInTheDocument();

    const seen = [term()];
    await user.click(button('Next'));
    seen.push(term());
    await user.click(button('Next'));
    seen.push(term());
    expect(seen).toEqual(['Ribosome', 'Nucleus', 'Mitochondria']);

    await user.click(button('Shuffle'));
    expect(button('Shuffle')).toHaveAttribute('aria-pressed', 'false');
    expect(term()).toBe('Mitochondria');
    expect(screen.getByText('Card 1 of 3')).toBeInTheDocument();
  });

  it('supports the keyboard: arrows move, Space flips', async () => {
    const user = userEvent.setup();
    renderStudy();

    await user.keyboard(' ');
    expect(definitionRegion()).toBeVisible();

    await user.keyboard('{ArrowRight}');
    expect(term()).toBe('Ribosome');
    expect(definitionRegion()).not.toBeVisible();

    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(term()).toBe('Nucleus');

    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(term()).toBe('Mitochondria');
  });

  it('lets Space press a focused button without also flipping the card', async () => {
    const user = userEvent.setup();
    renderStudy();

    button('Next').focus();
    await user.keyboard(' ');

    expect(term()).toBe('Ribosome');
    expect(definitionRegion()).not.toBeVisible();

    button('Show definition').focus();
    await user.keyboard(' ');
    expect(definitionRegion()).toBeVisible();
  });

  it('announces each card and revealed definition to screen readers', async () => {
    const user = userEvent.setup();
    renderStudy();
    const status = screen.getByRole('status');

    expect(status).toHaveTextContent('Card 1 of 3. Mitochondria');
    await user.click(button('Show definition'));
    expect(status).toHaveTextContent('Definition: Powerhouse of the cell');
    await user.click(button('Next'));
    await user.click(button('Next'));
    expect(status).toHaveTextContent('Card 3 of 3, the last card. Nucleus');
  });

  it('shows placeholders for a card missing a side', async () => {
    const user = userEvent.setup();
    renderStudy([makeCard({ term: '', definition: 'Orphan definition' })]);

    expect(screen.getByText('(no term)')).toBeInTheDocument();
    await user.click(button('Show definition'));
    expect(definitionRegion()).toHaveTextContent('Orphan definition');
  });

  it('keeps HTML-like text as plain text', () => {
    renderStudy([makeCard({ term: '<img src=x onerror=alert(1)>', definition: '<b>x</b>' })]);

    expect(term()).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('main img')).toBeNull();
  });

  it('exits to the home page and stops listening for keys', async () => {
    const user = userEvent.setup();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    renderStudy();

    await user.click(screen.getByRole('link', { name: 'Exit study' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();

    const keydownHandlers = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === 'keydown').map(([, handler]) => handler);
    expect(keydownHandlers(add).length).toBeGreaterThan(0);
    expect(new Set(keydownHandlers(remove))).toEqual(new Set(keydownHandlers(add)));

    await user.keyboard('{ArrowRight} ');
    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();
  });
});
