import { afterEach, describe, expect, it } from 'vitest';
import { activatesFocusedControl, isShortcutBlocked } from './keyboard';

function keydown(target: Element, init: KeyboardEventInit): KeyboardEvent {
  let received: KeyboardEvent | null = null;
  target.addEventListener('keydown', (event) => (received = event as KeyboardEvent), {
    once: true,
  });
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  return received!;
}

function element(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isShortcutBlocked', () => {
  it('allows plain keys on ordinary content', () => {
    expect(isShortcutBlocked(keydown(document.body, { key: '1' }))).toBe(false);
    expect(isShortcutBlocked(keydown(element('<button>x</button>'), { key: '1' }))).toBe(false);
  });

  it('blocks keys typed into text fields', () => {
    expect(isShortcutBlocked(keydown(element('<input>'), { key: '1' }))).toBe(true);
    expect(isShortcutBlocked(keydown(element('<textarea></textarea>'), { key: ' ' }))).toBe(true);
    expect(isShortcutBlocked(keydown(element('<select></select>'), { key: 'ArrowRight' }))).toBe(
      true,
    );
    const editable = element('<div contenteditable="true"><span>x</span></div>');
    expect(isShortcutBlocked(keydown(editable.firstElementChild!, { key: '1' }))).toBe(true);
  });

  it('blocks browser and OS shortcuts', () => {
    expect(isShortcutBlocked(keydown(document.body, { key: '1', ctrlKey: true }))).toBe(true);
    expect(isShortcutBlocked(keydown(document.body, { key: '1', metaKey: true }))).toBe(true);
    expect(isShortcutBlocked(keydown(document.body, { key: 'ArrowLeft', altKey: true }))).toBe(
      true,
    );
  });
});

describe('activatesFocusedControl', () => {
  it('is true for Enter and Space on buttons and links', () => {
    expect(activatesFocusedControl(keydown(element('<button>x</button>'), { key: 'Enter' }))).toBe(
      true,
    );
    expect(activatesFocusedControl(keydown(element('<a href="#x">x</a>'), { key: ' ' }))).toBe(
      true,
    );
  });

  it('is false for other keys or other targets', () => {
    expect(activatesFocusedControl(keydown(element('<button>x</button>'), { key: '1' }))).toBe(
      false,
    );
    expect(activatesFocusedControl(keydown(document.body, { key: 'Enter' }))).toBe(false);
  });
});
