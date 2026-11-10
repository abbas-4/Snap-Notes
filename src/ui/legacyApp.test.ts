import { describe, expect, it } from 'vitest';
import { legacyAppUrl } from './legacyApp';

describe('legacyAppUrl', () => {
  it('keeps the site base path, so the link works on GitHub Pages', () => {
    expect(legacyAppUrl('/Snap-Notes/')).toBe('/Snap-Notes/legacy/index.html');
    expect(legacyAppUrl('/')).toBe('/legacy/index.html');
  });
});
