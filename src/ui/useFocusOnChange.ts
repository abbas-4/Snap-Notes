import { useEffect, useRef } from 'react';

/**
 * Calls `focus` whenever `key` changes, so focus follows the screen when the
 * content under it is replaced (a new card, feedback, results). Skipped on the
 * first render so arriving on a page does not steal focus.
 */
export function useFocusOnChange(key: string, focus: () => void): void {
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    focus();
  }, [key, focus]);
}
