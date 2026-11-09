import { describe, expect, it } from 'vitest';
import { legacyRedirectTarget } from './legacyRoutes';

describe('legacyRedirectTarget', () => {
  it('sends #home to the index route, with or without a trailing slash', () => {
    expect(legacyRedirectTarget('/home')).toBe('/');
    expect(legacyRedirectTarget('/home/')).toBe('/');
  });

  it('opens the edit form for #add:<id>, keeping the id as it is', () => {
    expect(legacyRedirectTarget('/add:k3x9z')).toBe('/edit/k3x9z');
    expect(legacyRedirectTarget('/add:1')).toBe('/edit/1');
  });

  it('sends #study:<id> to Study, dropping the starting card', () => {
    expect(legacyRedirectTarget('/study:k3x9z')).toBe('/study');
  });

  it('leaves addresses the original app never had to the not-found page', () => {
    expect(legacyRedirectTarget('/no-such-page')).toBeNull();
    expect(legacyRedirectTarget('/homepage')).toBeNull();
    expect(legacyRedirectTarget('/home/extra')).toBeNull();
    expect(legacyRedirectTarget('/')).toBeNull();
  });

  it('treats #add: and #study: with no id as not found', () => {
    expect(legacyRedirectTarget('/add:')).toBeNull();
    expect(legacyRedirectTarget('/study:')).toBeNull();
  });
});
