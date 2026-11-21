// The small part of jsdom's API the legacy-app security test uses (jsdom ships no types).
declare module 'jsdom' {
  export class JSDOM {
    constructor(
      html: string,
      options?: {
        url?: string;
        runScripts?: 'dangerously' | 'outside-only';
        beforeParse?: (window: Window & typeof globalThis) => void;
      },
    );
    readonly window: Window & typeof globalThis;
  }
}
