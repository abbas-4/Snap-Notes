// @vitest-environment node
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import legacyHtml from '../../legacy/index.html?raw';

/**
 * The original app (legacy/index.html) is still published next to this one, on
 * the same origin, so script running in it could read this app's storage,
 * including a signed-in session. Its cards can come from an import file, which
 * may have been written by anyone. These tests load it with hostile cards and
 * check that every view shows them as text and runs nothing.
 */

const hostile = [
  {
    id: `a');window.pwned='id-in-onclick';('`,
    term: '<img id="injected-term" src="x" onerror="window.pwned=\'term\'">',
    definition: '</textarea><img id="injected-definition" src="x">',
    created: 1,
  },
  {
    id: '<img id="injected-id" src="x">',
    term: 'Second" onmouseover="window.pwned=\'attribute\'',
    definition: '<b id="injected-bold">bold</b>',
    created: 2,
  },
];

type LegacyWindow = Window &
  typeof globalThis & {
    pwned?: string;
    renderAdd(id: string): void;
    renderList(): void;
    renderLearn(): void;
    checkLearn(): void;
    deleteCardConfirm(id: string): void;
    editCard(id: string): void;
  };

let open: LegacyWindow | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

function load(): LegacyWindow {
  const dom = new JSDOM(legacyHtml, {
    url: 'https://example.test/Snap-Notes/legacy/index.html',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.localStorage.setItem('abbas_flashcards_v1', JSON.stringify(hostile));
      window.confirm = () => false;
      window.alert = () => {};
    },
  });
  open = dom.window as LegacyWindow;
  return open;
}

function injected(window: LegacyWindow): Element[] {
  return Array.from(
    window.document.querySelectorAll(
      '#injected-term, #injected-definition, #injected-id, #injected-bold, img, [onmouseover]',
    ),
  );
}

describe('the original app with hostile cards', () => {
  it('shows IDs, terms and definitions as text on the home and list views', () => {
    const window = load();
    expect(injected(window)).toEqual([]);
    expect(window.document.body.textContent).toContain('<img id="injected-id" src="x">');

    window.renderList();
    expect(injected(window)).toEqual([]);
    expect(window.document.body.textContent).toContain('<b id="injected-bold">bold</b>');
  });

  it('passes each ID to the buttons exactly, without running any of it', () => {
    const window = load();
    window.renderList();
    const deleted: string[] = [];
    const edited: string[] = [];
    window.deleteCardConfirm = (id) => deleted.push(id);
    window.editCard = (id) => edited.push(id);
    for (const button of Array.from(window.document.querySelectorAll('button'))) {
      if (/^(Edit|Delete)$/.test(button.textContent ?? '')) button.click();
    }
    expect(window.pwned).toBeUndefined();
    expect(deleted.sort()).toEqual(hostile.map((c) => c.id).sort());
    expect(edited.sort()).toEqual(hostile.map((c) => c.id).sort());
  });

  it('keeps the edit form intact and fills it with the exact text', () => {
    const window = load();
    for (const card of hostile) {
      window.renderAdd(card.id);
      expect(injected(window)).toEqual([]);
      const term = window.document.getElementById('term') as HTMLInputElement;
      const definition = window.document.getElementById('definition') as HTMLTextAreaElement;
      expect(term.value).toBe(card.term);
      expect(definition.value).toBe(card.definition);
    }
    expect(window.pwned).toBeUndefined();
  });

  it('shows the correct answer as text after a wrong answer in Learn', () => {
    const window = load();
    for (let i = 0; i < 4; i += 1) {
      window.renderLearn();
      (window.document.getElementById('learn-input') as HTMLInputElement).value = 'wrong';
      window.checkLearn();
      expect(injected(window)).toEqual([]);
    }
    expect(window.document.body.textContent).toContain('Wrong — ');
  });
});
