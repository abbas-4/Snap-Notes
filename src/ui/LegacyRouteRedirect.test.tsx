import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeCard, renderApp, storageWithCards } from '../test/renderApp';

describe('LegacyRouteRedirect', () => {
  it('lands the original #home URL on the home page', () => {
    renderApp({ route: '/home' });

    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();
  });

  it('opens the edit form, pre-filled, for the original #add:<id> URL', () => {
    const card = makeCard({ id: 'k3x9z', term: 'Mitochondria', definition: 'Powerhouse' });
    renderApp({ storage: storageWithCards([card]), route: '/add:k3x9z' });

    expect(screen.getByRole('heading', { level: 1, name: 'Edit card' })).toBeInTheDocument();
    expect(screen.getByLabelText('Term')).toHaveValue('Mitochondria');
    expect(screen.getByLabelText('Definition')).toHaveValue('Powerhouse');
  });

  it("shows the edit page's own not-found message for an unknown card id", () => {
    renderApp({ storage: storageWithCards([makeCard()]), route: '/add:no-such-card' });

    expect(screen.getByRole('heading', { level: 1, name: 'Card not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to cards' })).toBeInTheDocument();
  });

  it('lands the original #study:<id> URL on Study', () => {
    const cards = [makeCard(), makeCard()];
    renderApp({ storage: storageWithCards(cards), route: `/study:${cards[1]!.id}` });

    expect(screen.getByRole('heading', { level: 1, name: 'Study' })).toBeInTheDocument();
  });

  it('still shows the not-found page for addresses the original app never had', () => {
    renderApp({ route: '/no-such-page' });

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeInTheDocument();
  });
});
