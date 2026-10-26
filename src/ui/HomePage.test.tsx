import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeExport } from '../storage/importExport';
import { makeAppData, makeCard, renderApp, storageWithCards, storedCards } from '../test/renderApp';
import { downloadTextFile } from './download';

vi.mock('./download', () => ({ downloadTextFile: vi.fn() }));

function importFile(text: string, name = 'cards.json'): File {
  return new File([text], name, { type: 'application/json' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HomePage', () => {
  it('shows guidance when there are no cards', () => {
    renderApp();

    expect(screen.getByRole('heading', { name: 'No cards yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your first card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import cards…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export cards' })).toBeDisabled();
  });

  it('shows the total and the most recently updated cards first', () => {
    const older = makeCard({ term: 'Older', updatedAt: 1_700_000_900_000 });
    const newest = makeCard({ term: 'Newest', updatedAt: 1_700_009_000_000 });
    const middle = makeCard({ term: 'Middle', updatedAt: 1_700_005_000_000 });
    renderApp({ storage: storageWithCards([older, newest, middle]) });

    expect(screen.getByText(/You have/)).toHaveTextContent('You have 3 cards saved.');

    const recent = within(
      screen.getByRole('heading', { name: 'Recently updated' }).closest('section')!,
    ).getAllByRole('listitem');
    expect(recent[0]).toHaveTextContent('Newest');
    expect(recent[1]).toHaveTextContent('Middle');
    expect(recent[2]).toHaveTextContent('Older');
  });

  it('exports the stored cards as a versioned file', async () => {
    const user = userEvent.setup();
    const card = makeCard({ term: 'Export me' });
    renderApp({ storage: storageWithCards([card]) });

    await user.click(screen.getByRole('button', { name: 'Export cards' }));

    expect(downloadTextFile).toHaveBeenCalledOnce();
    const [name, text] = vi.mocked(downloadTextFile).mock.calls[0]!;
    expect(name).toMatch(/^snap-notes-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(text) as { format: string; schemaVersion: number; cards: unknown[] };
    expect(file.format).toBe('snap-notes');
    expect(file.schemaVersion).toBe(2);
    expect(file.cards).toEqual([card]);
    expect(screen.getByRole('status')).toHaveTextContent('Exported 1 card.');
  });

  it('imports a valid export file and reports what was added', async () => {
    const user = userEvent.setup();
    const existing = makeCard({ term: 'Existing' });
    const incoming = makeCard({ term: 'Imported card' });
    const storage = storageWithCards([existing]);
    renderApp({ storage });

    const text = serializeExport(makeAppData([incoming]));
    await user.upload(screen.getByLabelText('Import file'), importFile(text));

    expect(await screen.findByRole('status')).toHaveTextContent('Imported 1 card.');
    expect(storedCards(storage).map((c) => c.term)).toEqual(['Existing', 'Imported card']);
  });

  it('does not duplicate cards when the same file is imported twice', async () => {
    const user = userEvent.setup();
    const incoming = makeCard({ term: 'Once only' });
    const storage = storageWithCards([]);
    renderApp({ storage });

    const text = serializeExport(makeAppData([incoming]));
    await user.upload(screen.getByLabelText('Import file'), importFile(text));
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 1 card.');

    await user.upload(screen.getByLabelText('Import file'), importFile(text));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'No new cards to import. Skipped 1 card you already have.',
    );
    expect(storedCards(storage)).toHaveLength(1);
  });

  it('imports a legacy v1 export', async () => {
    const user = userEvent.setup();
    const storage = storageWithCards([]);
    renderApp({ storage });

    const text = JSON.stringify([
      { id: 'legacy-1', term: 'Legacy term', definition: 'Legacy def' },
    ]);
    await user.upload(screen.getByLabelText('Import file'), importFile(text));

    expect(await screen.findByRole('status')).toHaveTextContent('Imported 1 card.');
    expect(storedCards(storage)[0]).toMatchObject({
      term: 'Legacy term',
      definition: 'Legacy def',
    });
  });

  it('rejects an invalid file and leaves stored cards unchanged', async () => {
    const user = userEvent.setup();
    const existing = makeCard({ term: 'Keep me' });
    const storage = storageWithCards([existing]);
    renderApp({ storage });
    const writesBefore = storage.writes.length;

    await user.upload(screen.getByLabelText('Import file'), importFile('{not json'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Import failed:');
    expect(alert).toHaveTextContent('Your cards were not changed.');
    expect(storage.writes).toHaveLength(writesBefore);
    expect(storedCards(storage)).toEqual([existing]);
  });
});
