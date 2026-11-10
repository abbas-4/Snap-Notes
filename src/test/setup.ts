import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import { createdStorages } from './memoryStorage';

afterEach(() => {
  cleanup();

  // Whatever any test did, the original app's key must never be written,
  // removed, or cleared. This holds for every storage any test created.
  // The key is spelled out, so the guard holds even if the constant is changed.
  for (const storage of createdStorages) {
    expect(
      storage.writes.filter((w) => w.key === 'abbas_flashcards_v1' || w.method === 'clear'),
    ).toEqual([]);
  }
  createdStorages.length = 0;
});
