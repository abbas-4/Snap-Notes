import { describe, expect, it } from 'vitest';
import { hasBothSides, textKey } from './cardText';

describe('textKey', () => {
  it('ignores case and differences in spacing', () => {
    expect(textKey('  Paris ')).toBe(textKey('paris'));
    expect(textKey('New\n  York')).toBe(textKey('new york'));
    expect(textKey('Paris')).not.toBe(textKey('Pariss'));
  });
});

describe('hasBothSides', () => {
  it('requires visible text on both sides', () => {
    expect(hasBothSides({ term: 'Term', definition: 'Definition' })).toBe(true);
    expect(hasBothSides({ term: ' ', definition: 'Definition' })).toBe(false);
    expect(hasBothSides({ term: 'Term', definition: '\n\t' })).toBe(false);
  });
});
