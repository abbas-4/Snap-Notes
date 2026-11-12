import { readCloudConfig } from '../../cloud/config';
import type { CloudServices } from '../../cloud/supabaseServices';

/** What the app knows about its backend at start-up. */
export interface CloudSetup {
  /** null: no backend configured, so the app is local-only. A promise while the client loads. */
  services: CloudServices | Promise<CloudServices> | null;
  /** Why configured settings could not be used, for the account page to explain. */
  error: string | null;
}

export const NO_CLOUD: CloudSetup = { services: null, error: null };

let cached: CloudSetup | null = null;

/**
 * The backend this build was configured with (see `.env.example`). The client
 * library is downloaded only when settings are present, so the local-only
 * build stays exactly as small as before.
 */
export function cloudFromEnvironment(storage: Storage | null): CloudSetup {
  if (cached) return cached;
  const appUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const result = readCloudConfig(import.meta.env, appUrl);
  if (!result.ok) {
    cached = { services: null, error: result.reason === 'missing' ? null : result.message };
    if (result.reason !== 'missing')
      console.error(`Snap Notes accounts are off: ${result.message}`);
    return cached;
  }
  cached = {
    services: import('../../cloud/supabaseServices').then(({ createSupabaseServices }) =>
      createSupabaseServices(result.config, { storage }),
    ),
    error: null,
  };
  return cached;
}
