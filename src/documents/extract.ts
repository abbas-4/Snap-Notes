import { DocxError, extractDocxText } from './docx';
import { extractPdfText, isPdf, PdfError, type PdfJs } from './pdf';
import { isZip, ZipError } from './zip';

/**
 * Turns an uploaded file into study material, entirely in the browser: the
 * file is never uploaded anywhere. Supported: plain text (.txt, .md), PDF and
 * Word (.docx).
 *
 * A file is accepted only when its name and its contents agree: the first
 * bytes decide what it really is, and a name that claims something else is
 * refused. Nothing in a file is ever run; it is only read as data.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** More than any one generation can use, so the user can still choose which part to send. */
export const MAX_EXTRACTED_CHARS = 200_000;

export const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx'] as const;
/** For the file picker's `accept` attribute. */
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_EXTENSIONS,
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');

export type DocumentFormat = 'text' | 'pdf' | 'docx';

export const FORMAT_LABELS: Record<DocumentFormat, string> = {
  text: 'text file',
  pdf: 'PDF',
  docx: 'Word document',
};

export type ExtractResult =
  | { ok: true; text: string; format: DocumentFormat; truncated: boolean }
  | { ok: false; message: string };

export interface UploadedFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ExtractOptions {
  /** Loads PDF.js; only called for PDFs. */
  loadPdfJs: () => Promise<PdfJs>;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function expectedFormat(extension: string): DocumentFormat | null {
  switch (extension) {
    case '.txt':
    case '.md':
      return 'text';
    case '.pdf':
      return 'pdf';
    case '.docx':
      return 'docx';
    default:
      return null;
  }
}

/** The old binary Word and Office format (.doc), recognisable by its first bytes. */
function isOleCompound(bytes: Uint8Array): boolean {
  return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => bytes[i] === b);
}

/**
 * Reads bytes as text: UTF-8 (the usual case) or UTF-16 with a byte-order mark.
 * Returns null for anything that is not text, such as an image renamed .txt.
 */
export function decodeText(bytes: Uint8Array): string | null {
  let text: string;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
    } else {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  } catch {
    return null;
  }
  // Text has almost no control characters other than tabs and line breaks; binary data has many.
  let control = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0) return null;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12) control += 1;
  }
  return control > Math.max(4, text.length / 100) ? null : text;
}

/** Tidies extracted text: one kind of line break, no trailing spaces, at most one blank line. */
export function tidyExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detect(bytes: Uint8Array): DocumentFormat | 'zip' | 'doc' | 'unknown' {
  if (isPdf(bytes)) return 'pdf';
  if (isZip(bytes)) return 'zip';
  if (isOleCompound(bytes)) return 'doc';
  return 'unknown';
}

const UNSUPPORTED =
  'Snap Notes can read text files (.txt, .md), PDFs and Word documents (.docx). Copy the text from other files and paste it instead.';

export async function extractText(
  file: UploadedFile,
  options: ExtractOptions,
): Promise<ExtractResult> {
  const expected = expectedFormat(extensionOf(file.name));
  if (expected === null) return { ok: false, message: UNSUPPORTED };
  if (file.size === 0) return { ok: false, message: 'This file is empty.' };
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `This file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Choose a smaller file, or paste the part you need.`,
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, message: 'This file could not be read. Try choosing it again.' };
  }

  const detected = detect(bytes);
  const mismatch = (what: string): ExtractResult => ({
    ok: false,
    message: `This file is named like a ${FORMAT_LABELS[expected]}, but it is ${what}. Check you chose the right file.`,
  });

  let raw: string;
  let truncated = false;
  try {
    if (expected === 'text') {
      if (detected !== 'unknown') return mismatch('not plain text');
      const decoded = decodeText(bytes);
      if (decoded === null) return mismatch('not plain text');
      raw = decoded;
    } else if (expected === 'pdf') {
      if (detected !== 'pdf') return mismatch('not a PDF');
      const pdf = await extractPdfText(bytes, await options.loadPdfJs(), MAX_EXTRACTED_CHARS);
      raw = pdf.text;
      truncated = pdf.truncated;
    } else {
      if (detected === 'doc') {
        return {
          ok: false,
          message:
            'This is an older Word document (.doc), which Snap Notes cannot read. Save it as .docx or PDF in Word, then try again.',
        };
      }
      if (detected !== 'zip') return mismatch('not a Word document');
      raw = await extractDocxText(bytes);
    }
  } catch (error) {
    return { ok: false, message: describeFailure(error, expected) };
  }

  let text = tidyExtractedText(raw);
  if (text === '') {
    return {
      ok: false,
      message:
        expected === 'pdf'
          ? 'No text was found in this PDF. It may be scanned pages, which are pictures of text; Snap Notes cannot read those. Copy the text in from elsewhere instead.'
          : 'No text was found in this file.',
    };
  }
  if (text.length > MAX_EXTRACTED_CHARS) {
    text = text.slice(0, MAX_EXTRACTED_CHARS);
    truncated = true;
  }
  return { ok: true, text, format: expected, truncated };
}

function describeFailure(error: unknown, format: DocumentFormat): string {
  const label = FORMAT_LABELS[format];
  if (error instanceof PdfError) {
    if (error.reason === 'encrypted') {
      return 'This PDF is password protected. Remove the password, or copy the text in instead.';
    }
    if (error.reason === 'too-many-pages')
      return `${error.message} Split it, or paste the part you need.`;
    return 'This PDF is damaged or could not be read.';
  }
  if (error instanceof ZipError) {
    if (error.reason === 'encrypted') {
      return 'This document is password protected. Remove the password, or copy the text in instead.';
    }
    if (error.reason === 'too-large') return 'This document is too large to read.';
    return `This ${label} is damaged or could not be read.`;
  }
  if (error instanceof DocxError && error.reason === 'not-docx') {
    return 'This file is not a Word document. Check you chose the right file.';
  }
  return `This ${label} is damaged or could not be read.`;
}
