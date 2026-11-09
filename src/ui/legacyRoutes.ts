/**
 * The original app (legacy/index.html) addressed its views with bare hash
 * fragments: `#home`, `#add:<id>` to edit a card, `#study:<id>` to study from
 * a card. HashRouter turns those into the pathnames `/home`, `/add:<id>` and
 * `/study:<id>`, which no route matches. People have them bookmarked, so the
 * catch-all route sends them where they meant to go instead of a dead end.
 */

const HOME = /^\/home\/?$/;
const EDIT_CARD = /^\/add:(.+)$/;
const STUDY_FROM_CARD = /^\/study:(.+)$/;

/** Where a legacy pathname should land, or null when it is not a legacy URL. */
export function legacyRedirectTarget(pathname: string): string | null {
  if (HOME.test(pathname)) return '/';

  // Legacy ids are short [a-z0-9] strings, so they drop straight into the path.
  // An unknown id is the edit page's problem: it shows its own not-found message.
  const cardId = EDIT_CARD.exec(pathname)?.[1];
  if (cardId) return `/edit/${cardId}`;

  // The rebuilt Study mode has no "start at this card" option, so the id is dropped.
  if (STUDY_FROM_CARD.test(pathname)) return '/study';

  return null;
}
