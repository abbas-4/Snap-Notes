/**
 * Text from a PDF, read in the browser with PDF.js (Mozilla's PDF reader).
 * Only text the PDF contains as text can be read: a scanned page is a picture
 * and yields nothing (there is no text recognition).
 *
 * PDF.js is large, so it is loaded only when a PDF is chosen
 * (`pdfjsLoader.ts`), and it is passed in here so tests can use its Node build.
 * Scripting in the PDF is never run: JavaScript evaluation is switched off.
 */

/** The parts of the PDF.js API used here. */
export interface PdfJs {
  getDocument(params: {
    data: Uint8Array;
    isEvalSupported: boolean;
    enableXfa: boolean;
    disableFontFace: boolean;
    useSystemFonts: boolean;
    stopAtErrors: boolean;
    verbosity: number;
  }): { promise: Promise<PdfDocument>; destroy(): Promise<void> };
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: ReadonlyArray<{ str?: string; hasEOL?: boolean }> }>;
    cleanup(): void;
  }>;
}

export class PdfError extends Error {
  readonly reason: 'encrypted' | 'corrupt' | 'too-many-pages' | 'too-slow';

  constructor(reason: PdfError['reason'], message: string) {
    super(message);
    this.name = 'PdfError';
    this.reason = reason;
  }
}

export const MAX_PDF_PAGES = 300;

/**
 * A crafted PDF can make PDF.js work for a very long time; reading stops after
 * this long, so the page never waits on one forever.
 */
export const PDF_TIME_LIMIT_MS = 60_000;

export function isPdf(bytes: Uint8Array): boolean {
  // `%PDF-`, which the format allows a little way into the file.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export interface PdfText {
  text: string;
  /** Reading stopped once there was more than `maxChars` of text. */
  truncated: boolean;
}

export async function extractPdfText(
  bytes: Uint8Array,
  pdfjs: PdfJs,
  maxChars: number,
  timeLimitMs: number = PDF_TIME_LIMIT_MS,
): Promise<PdfText> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PdfError('too-slow', 'The PDF took too long to read.')),
      timeLimitMs,
    );
  });
  try {
    return await Promise.race([readPdf(bytes, pdfjs, maxChars, deadline), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function readPdf(
  bytes: Uint8Array,
  pdfjs: PdfJs,
  maxChars: number,
  deadline: Promise<never>,
): Promise<PdfText> {
  // Keeps an unhandled rejection from being reported when reading wins the race.
  deadline.catch(() => {});
  // PDF.js takes ownership of the buffer it is given, so it gets a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    // Errors only: reading text needs no font files, so PDF.js's warnings about them are noise.
    verbosity: 0,
  });
  let doc: PdfDocument;
  try {
    doc = await Promise.race([task.promise, deadline]);
  } catch (error) {
    await task.destroy().catch(() => {});
    if (error instanceof PdfError) throw error;
    const name = (error as { name?: unknown } | null)?.name;
    if (name === 'PasswordException') {
      throw new PdfError('encrypted', 'The PDF is password protected.');
    }
    throw new PdfError('corrupt', 'The PDF is damaged or not a PDF.');
  }

  try {
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new PdfError('too-many-pages', `The PDF has more than ${MAX_PDF_PAGES} pages.`);
    }
    const pages: string[] = [];
    let length = 0;
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await Promise.race([doc.getPage(n), deadline]);
      const content = await Promise.race([page.getTextContent(), deadline]);
      page.cleanup();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      pages.push(text.trim());
      length += text.length;
      if (length > maxChars) return { text: pages.join('\n\n'), truncated: true };
    }
    return { text: pages.join('\n\n'), truncated: false };
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError('corrupt', 'The PDF is damaged.');
  } finally {
    await task.destroy().catch(() => {});
  }
}
