import { describe, expect, it } from 'vitest';
import legacyApp from '../../legacy/index.html?raw';
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from './localStore';
import { MIGRATION_RECORD_KEY } from './migrationRecord';

// Every other test uses the constants, so a changed constant would pass them
// all while cutting real users off from their cards. These pin the literals.
describe('storage keys', () => {
  it('are exactly the keys users already have data under', () => {
    expect(LEGACY_STORAGE_KEY).toBe('abbas_flashcards_v1');
    expect(STORAGE_KEY).toBe('snapnotes.data.v2');
    expect(MIGRATION_RECORD_KEY).toBe('snapnotes.migration.v1');
  });

  it('match the key the original app reads and writes', () => {
    expect(legacyApp).toContain("'abbas_flashcards_v1'");
  });
});
