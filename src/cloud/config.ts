/**
 * Cloud settings, read from the build's environment.
 *
 * Accounts and sync are optional: a build without these variables is the
 * local-only app it was before, with no account screens and no network
 * requests. Only *public* values belong here: the project URL and its
 * publishable (anon) key, which are meant to be shipped to browsers and grant
 * nothing on their own. A secret or service-role key would bypass every
 * database rule, so one is refused outright rather than used.
 */

export interface CloudConfig {
  /** The Supabase project URL, such as `https://abcd.supabase.co`. */
  url: string;
  /** The project's publishable (anon) key. */
  publishableKey: string;
  /** Where links in account emails return to: this app's address. */
  appUrl: string;
}

export type CloudConfigResult =
  | { ok: true; config: CloudConfig }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'invalid' | 'secret-key'; message: string };

export interface CloudEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** The older name for the publishable key. */
  VITE_SUPABASE_ANON_KEY?: string;
  /** Optional: overrides the address account emails link back to. */
  VITE_APP_URL?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether a key would give the browser more than an ordinary signed-in user has. */
export function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob((parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))) as {
      role?: unknown;
    };
    return payload.role === 'service_role' || payload.role === 'supabase_admin';
  } catch {
    return false;
  }
}

export function readCloudConfig(env: CloudEnv, defaultAppUrl: string): CloudConfigResult {
  const rawUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (rawUrl === '' && key === '') return { ok: false, reason: 'missing' };
  if (rawUrl === '' || key === '') {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set.',
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid', message: 'VITE_SUPABASE_URL is not a valid URL.' };
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'VITE_SUPABASE_URL must use https (http is allowed only for localhost).',
    };
  }

  if (isSecretKey(key)) {
    return {
      ok: false,
      reason: 'secret-key',
      message:
        'The configured Supabase key is a secret key. Only the publishable (anon) key may be used in the browser.',
    };
  }

  const appUrl = (env.VITE_APP_URL?.trim() || defaultAppUrl).replace(/[?#].*$/, '');
  return {
    ok: true,
    config: { url: url.origin, publishableKey: key, appUrl },
  };
}
