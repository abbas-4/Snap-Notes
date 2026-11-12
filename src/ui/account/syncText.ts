import type { Timestamp } from '../../domain/types';
import type { SyncStatus } from './cloud';

/** "just now", "5 minutes ago", "yesterday at 14:05", or a date. */
export function describeSyncTime(at: Timestamp | null, now: Timestamp): string {
  if (at === null) return 'Never';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return new Date(at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function changesLabel(count: number): string {
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

/** A short label for the header and the account page. */
export function syncStatusLabel(status: SyncStatus, pending: number): string {
  switch (status) {
    case 'synced':
      return 'Synced';
    case 'syncing':
      return 'Syncing…';
    case 'pending':
      return `${changesLabel(pending)} to sync`;
    case 'offline':
      return pending > 0 ? `Offline · ${changesLabel(pending)} waiting` : 'Offline';
    case 'error':
      return 'Sync problem';
    case 'needs-link':
      return 'Finish setting up sync';
    case 'linking':
      return 'Setting up sync…';
    case 'checking':
      return 'Checking…';
    case 'session-expired':
      return 'Signed out';
    case 'signed-out':
      return 'Not signed in';
    default:
      return '';
  }
}
