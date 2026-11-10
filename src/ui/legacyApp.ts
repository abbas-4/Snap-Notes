/** The original app's address under the site's base path (Vite's `base`). */
export function legacyAppUrl(base: string): string {
  return `${base}legacy/index.html`;
}

/**
 * Where the original app is published, next to this one. Being on the same
 * origin, it shares this app's localStorage and so still shows the user's
 * original cards.
 */
export const LEGACY_APP_URL = legacyAppUrl(import.meta.env.BASE_URL);
