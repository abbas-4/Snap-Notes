import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from '../storage/localStore';
import { MemoryStorage } from '../test/memoryStorage';
import { makeAppData, makeCard, renderApp } from '../test/renderApp';
import { downloadTextFile } from './download';
import { LEGACY_APP_URL } from './legacyApp';

vi.mock('./download', () => ({ downloadTextFile: vi.fn() }));

const BAD = '{not json';
const HEADING = 'Your cards from the previous version could not be read';

function renderRecovery(raw = BAD) {
  const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: raw });
  renderApp({ storage });
  return storage;
}

function heading() {
  return screen.getByRole('heading', { level: 1, name: HEADING });
}

function backupFile(text: string) {
  return new File([text], 'flashcards.json', { type: 'application/json' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LegacyRecoveryScreen', () => {
  it('refuses to start over unreadable original data, and writes nothing', () => {
    const storage = renderRecovery();

    expect(heading()).toBeInTheDocument();
    expect(
      screen.getByText(/Details: The data saved by the original app is not valid JSON\./),
    ).toBeInTheDocument();
    // The app itself is not running: no navigation, no home page.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(storage.writes).toEqual([]);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(BAD);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('says when the data was readable but held no cards', () => {
    renderRecovery(JSON.stringify([{ id: 'x' }, 7]));

    expect(heading()).toBeInTheDocument();
    expect(
      screen.getByText(/Details: None of the 2 saved entries could be read as a card\./),
    ).toBeInTheDocument();
  });

  it('offers the original data as a download, as plain text when it is not JSON', async () => {
    const user = userEvent.setup();
    renderRecovery();

    await user.click(screen.getByRole('button', { name: 'Download the original data' }));

    expect(downloadTextFile).toHaveBeenCalledWith(
      'snap-notes-original-data.txt',
      BAD,
      'text/plain',
    );
    expect(screen.getByRole('link', { name: 'Open the original app' })).toHaveAttribute(
      'href',
      LEGACY_APP_URL,
    );
  });

  it('downloads readable data as JSON', async () => {
    const user = userEvent.setup();
    const raw = '{"cards":[]}';
    renderRecovery(raw);

    await user.click(screen.getByRole('button', { name: 'Download the original data' }));

    expect(downloadTextFile).toHaveBeenCalledWith(
      'snap-notes-original-data.json',
      raw,
      'application/json',
    );
  });

  it('restores from a backup file and then runs normally', async () => {
    const user = userEvent.setup();
    const storage = renderRecovery();
    const backup = JSON.stringify([
      { id: 'r1', term: 'Restored', definition: 'From the file', created: 1 },
    ]);

    await user.upload(screen.getByLabelText('Backup file'), backupFile(backup));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your flashcards' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Restored')).toBeInTheDocument();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).cards).toMatchObject([
      { id: 'r1', term: 'Restored', definition: 'From the file' },
    ]);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(BAD);
    expect(storage.writes).toEqual([{ method: 'setItem', key: STORAGE_KEY }]);
  });

  it('rejects a bad backup file and keeps asking', async () => {
    const user = userEvent.setup();
    const storage = renderRecovery();

    await user.upload(screen.getByLabelText('Backup file'), backupFile('nope'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The backup could not be restored: The file is not valid JSON.',
    );
    expect(heading()).toBeInTheDocument();
    expect(storage.writes).toEqual([]);
  });

  it('starts with an empty collection only after confirmation', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const storage = renderRecovery();

    await user.click(screen.getByRole('button', { name: 'Start with an empty collection' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(heading()).toBeInTheDocument();
    expect(storage.writes).toEqual([]);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Start with an empty collection' }));

    expect(screen.getByRole('heading', { name: 'No cards yet' })).toBeInTheDocument();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).cards).toEqual([]);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(BAD);
  });

  it('reports when even an empty collection cannot be saved', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const storage = renderRecovery();
    storage.failWrites = new DOMException('Full', 'QuotaExceededError');

    await user.click(screen.getByRole('button', { name: 'Start with an empty collection' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'An empty collection could not be saved: Browser storage is full.',
    );
    expect(heading()).toBeInTheDocument();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('never replaces cards another tab saved while this screen was open', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const storage = renderRecovery();
    const other = JSON.stringify(makeAppData([makeCard({ term: 'From the other tab' })]));
    storage.setItem(STORAGE_KEY, other);

    await user.click(screen.getByRole('button', { name: 'Start with an empty collection' }));

    // The other tab's cards are loaded as they are; nothing is written over them.
    expect(screen.getByText('From the other tab')).toBeInTheDocument();
    expect(storage.getItem(STORAGE_KEY)).toBe(other);
  });
});
