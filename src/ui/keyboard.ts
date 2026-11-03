/**
 * Helpers for page-wide keyboard shortcuts. Shortcuts must never fire while
 * the user is typing, alongside browser or OS shortcuts, or on top of a key
 * that is already activating the focused control.
 */

const TEXT_ENTRY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const CONTROL = 'button, a[href], summary, [role="button"], [role="link"]';

/** True when a key press belongs to something other than the page's shortcuts. */
export function isShortcutBlocked(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  if (event.altKey || event.ctrlKey || event.metaKey) return true;
  const target = event.target;
  return target instanceof Element && target.closest(TEXT_ENTRY) !== null;
}

/** Enter and Space already click a focused button or link; handling them again would act twice. */
export function activatesFocusedControl(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' && event.key !== ' ') return false;
  const target = event.target;
  return target instanceof Element && target.closest(CONTROL) !== null;
}
