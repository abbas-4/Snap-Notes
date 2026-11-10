import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from '../storage/localStore';
import { loadMigrationRecord, MIGRATION_RECORD_KEY } from '../storage/migrationRecord';
import { MemoryStorage } from '../test/memoryStorage';
import { makeAppData, makeCard, renderApp } from '../test/renderApp';
import { downloadTextFile } from './download';
import { LEGACY_APP_URL } from './legacyApp';

vi.mock('./download', () => ({ downloadTextFile: vi.fn() }));

const legacyCards = [
  { id: 'a1', term: 'Mitochondria', definition: 'Powerhouse of the cell', created: 1711300000000 },
  {
    id: 'b2',
    term: 'Ribosome',
    definition: 'Makes proteins',
    created: 1711300100000,
    updated: 1711300200000,
  },
];
const LEGACY_RAW = JSON.stringify(legacyCards);

const WELCOME = 'Welcome to the new Snap Notes';

function welcomeNotice() {
  return screen.getByRole('status', { name: WELCOME });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MigrationNotice', () => {
  it("moves the original app's cards over on the first visit and says so", async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });

    renderApp({ storage });

    expect(screen.getByText('Mitochondria')).toBeInTheDocument();
    expect(screen.getByText('Ribosome')).toBeInTheDocument();
    const notice = welcomeNotice();
    expect(notice).toHaveTextContent(
      'Your 2 cards were moved over from the previous version of Snap Notes.',
    );
    expect(notice).toHaveTextContent('Nothing was removed');
    expect(within(notice).queryByRole('link', { name: 'Open the original app' })).toBeNull();

    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(LEGACY_RAW);
    expect(
      JSON.parse(storage.getItem(STORAGE_KEY)!).cards.map((c: { term: string }) => c.term),
    ).toEqual(['Mitochondria', 'Ribosome']);
    expect(storage.writes).toEqual([
      { method: 'setItem', key: STORAGE_KEY },
      { method: 'setItem', key: MIGRATION_RECORD_KEY },
    ]);

    await user.click(within(notice).getByRole('button', { name: 'Download a backup' }));
    expect(downloadTextFile).toHaveBeenCalledWith(
      expect.stringMatching(/^snap-notes-\d{4}-\d{2}-\d{2}\.json$/),
      expect.stringContaining('"format": "snap-notes"'),
    );
  });

  it('keeps the notice across reloads until it is dismissed, then stays dismissed', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
    renderApp({ storage }).unmount();

    // A reload: the v2 data exists now, and the record still says what happened.
    const second = renderApp({ storage });
    expect(welcomeNotice()).toBeInTheDocument();

    await user.click(within(welcomeNotice()).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status', { name: WELCOME })).not.toBeInTheDocument();
    expect(loadMigrationRecord(storage)?.dismissed).toBe(true);

    second.unmount();
    renderApp({ storage });
    expect(screen.queryByRole('status', { name: WELCOME })).not.toBeInTheDocument();
    expect(screen.getByText('Mitochondria')).toBeInTheDocument();
  });

  it("survives StrictMode's double render without migrating twice", () => {
    const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });

    render(
      <StrictMode>
        <MemoryRouter>
          <App storage={storage} />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(welcomeNotice()).toBeInTheDocument();
    expect(screen.getByText('Mitochondria')).toBeInTheDocument();
    expect(storage.writes).toEqual([
      { method: 'setItem', key: STORAGE_KEY },
      { method: 'setItem', key: MIGRATION_RECORD_KEY },
    ]);
  });

  it('explains a partial migration and offers the original data', async () => {
    const user = userEvent.setup();
    const raw = JSON.stringify([
      legacyCards[0],
      'not a card',
      { id: 'c3', term: { nested: true }, definition: 'Kept definition', created: 1 },
    ]);
    const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: raw });

    renderApp({ storage });

    const notice = screen.getByRole('alert', { name: 'Some entries could not be moved over' });
    expect(notice).toHaveTextContent('Moved over 2 of 3 saved entries');
    expect(notice).toHaveTextContent('Your original data has not been changed');
    expect(
      within(notice).getByText('Entry 2 was not a card, so it was left out.'),
    ).toBeInTheDocument();
    expect(
      within(notice).getByText('Entry 3: its term could not be read and was left empty.'),
    ).toBeInTheDocument();
    expect(within(notice).getByRole('link', { name: 'Open the original app' })).toHaveAttribute(
      'href',
      LEGACY_APP_URL,
    );

    await user.click(within(notice).getByRole('button', { name: 'Download the original data' }));
    expect(downloadTextFile).toHaveBeenCalledWith('snap-notes-original-data.json', raw);

    // The cards that could be read are in place.
    expect(screen.getByText('Mitochondria')).toBeInTheDocument();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).cards).toHaveLength(2);
  });

  it('hides harmless tidying behind a details toggle', () => {
    const raw = JSON.stringify([
      { id: 'a1', term: 'No date', definition: 'D' },
      { id: 'a1', term: 'Same id', definition: 'D', created: 1 },
    ]);
    renderApp({ storage: new MemoryStorage({ [LEGACY_STORAGE_KEY]: raw }) });

    const notice = welcomeNotice();
    expect(notice).toHaveTextContent('Your 2 cards were moved over');
    const details = within(notice).getByText('Details of small changes').closest('details');
    expect(details).not.toBeNull();
    expect(
      within(details!).getByText('Entry 1 had no usable creation date, so one was filled in.'),
    ).toBeInTheDocument();
    expect(within(details!).getByText('Entry 2 was given a new internal ID.')).toBeInTheDocument();
  });

  it('warns when the migrated cards could not be saved, and keeps them on screen', () => {
    const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
    storage.failWrites = new DOMException('Full', 'QuotaExceededError');

    renderApp({ storage });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'could not be saved in the new format because browser storage is full',
    );
    expect(screen.getByText('Mitochondria')).toBeInTheDocument();
    // The report is still shown, from memory, although nothing could be stored.
    expect(welcomeNotice()).toHaveTextContent('Your 2 cards were moved over');
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(storage.getItem(MIGRATION_RECORD_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(LEGACY_RAW);
  });

  it('saves the migrated cards with the first change that succeeds, then stops warning', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
    storage.failWrites = new DOMException('Full', 'QuotaExceededError');
    renderApp({ storage, route: '/add' });
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved in the new format');

    // Space is freed, and the user adds a card.
    storage.failWrites = null;
    await user.type(screen.getByLabelText('Term'), 'Golgi');
    await user.type(screen.getByLabelText('Definition'), 'Packages proteins');
    await user.click(screen.getByRole('button', { name: 'Add card' }));

    expect(
      JSON.parse(storage.getItem(STORAGE_KEY)!).cards.map((c: { term: string }) => c.term),
    ).toEqual(['Mitochondria', 'Ribosome', 'Golgi']);
    expect(loadMigrationRecord(storage)).toMatchObject({ cardsMigrated: 2, dismissed: false });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(welcomeNotice()).toBeInTheDocument();
  });

  it('says so when the browser refused the save for a reason other than space', () => {
    const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
    storage.dropWrites = true;

    renderApp({ storage });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'could not be saved in the new format because the browser refused to save',
    );
  });

  it('still reports left-out entries when the record of the migration cannot be written', () => {
    const storage = new MemoryStorage({
      [LEGACY_STORAGE_KEY]: JSON.stringify([legacyCards[0], 5, { id: 'z' }]),
    });
    storage.failWritesFor = (key) =>
      key === MIGRATION_RECORD_KEY ? new DOMException('Full', 'QuotaExceededError') : null;

    renderApp({ storage });

    const notice = screen.getByRole('alert', { name: 'Some entries could not be moved over' });
    expect(notice).toHaveTextContent('Moved over 1 of 3 saved entries');
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).cards).toHaveLength(1);
  });

  it('does not claim entries were left out when only some text was lost', () => {
    const raw = JSON.stringify([{ id: 'a', term: 'Cell', definition: { x: 1 }, created: 1 }]);
    renderApp({ storage: new MemoryStorage({ [LEGACY_STORAGE_KEY]: raw }) });

    const notice = screen.getByRole('alert', { name: 'Some text could not be moved over' });
    expect(notice).toHaveTextContent('Your card was moved over');
    expect(
      within(notice).getByText('Entry 1: its definition could not be read and was left empty.'),
    ).toBeInTheDocument();
  });

  it('says how many changes are not listed when there are too many to keep', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`,
      term: `T${i}`,
      definition: 'D',
    }));
    renderApp({ storage: new MemoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(many) }) });

    const notice = welcomeNotice();
    expect(notice).toHaveTextContent('Your 60 cards were moved over');
    expect(notice).toHaveTextContent('10 more changes are not listed here.');
  });

  it('does not overwrite cards another tab saved while this tab held unsaved ones', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: LEGACY_RAW });
    storage.failWrites = new DOMException('Full', 'QuotaExceededError');
    renderApp({ storage, route: '/add' });
    storage.failWrites = null;

    // Another tab migrates and saves in the meantime.
    const other = JSON.stringify(makeAppData([makeCard({ term: 'From the other tab' })]));
    storage.setItem(STORAGE_KEY, other);

    await user.type(screen.getByLabelText('Term'), 'Golgi');
    await user.type(screen.getByLabelText('Definition'), 'Packages proteins');
    await user.click(screen.getByRole('button', { name: 'Add card' }));

    expect(screen.getByText(/saved from another tab or window/)).toBeInTheDocument();
    expect(storage.getItem(STORAGE_KEY)).toBe(other);
  });
});
