import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs` while `active`. Used to
 * redraw a running stopwatch; the elapsed time itself is worked out from
 * timestamps, so a late or skipped tick never makes it drift.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
