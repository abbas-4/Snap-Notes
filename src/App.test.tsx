import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the rebuild notice with a link to the live app', () => {
    render(
      <MemoryRouter initialEntries={['/list']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Snap Notes');
    expect(screen.getByRole('link', { name: /abbas-4\.github\.io\/Snap-Notes/ })).toHaveAttribute(
      'href',
      'https://abbas-4.github.io/Snap-Notes/',
    );
  });

  it('does not touch localStorage while the rebuild is in progress', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
