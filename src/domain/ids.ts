/**
 * IDs are restricted to URL- and HTML-safe characters. The legacy app placed IDs
 * directly into markup and onclick handlers, so anything outside this set is
 * treated as invalid and replaced during migration.
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type IdFactory = () => string;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export const createId: IdFactory = () => crypto.randomUUID();
