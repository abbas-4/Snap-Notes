// @vitest-environment node
// PDF.js runs here in Node (its "legacy" build, with its worker in the same
// thread), reading real PDF files built by documentFixtures.ts.
import * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { makePdf, upload } from '../test/documentFixtures';
import { extractText } from './extract';
import { extractPdfText, MAX_PDF_PAGES, type PdfJs } from './pdf';

const pdfjs = pdfjsLegacy as unknown as PdfJs;
const options = { loadPdfJs: async () => pdfjs };

describe('PDF text extraction', () => {
  it('reads the text of every page, in order', async () => {
    const pdf = makePdf([
      ['Photosynthesis turns light into chemical energy.', 'It happens in chloroplasts.'],
      ['Respiration releases that energy (as ATP).'],
    ]);
    const result = await extractText(upload('biology.pdf', pdf), options);
    expect(result).toMatchObject({ ok: true, format: 'pdf', truncated: false });
    const text = result.ok ? result.text : '';
    expect(text).toContain('Photosynthesis turns light into chemical energy.');
    expect(text).toContain('It happens in chloroplasts.');
    expect(text).toContain('Respiration releases that energy (as ATP).');
    expect(text.indexOf('Photosynthesis')).toBeLessThan(text.indexOf('Respiration'));
  });

  it('stops reading once there is more text than can be used', async () => {
    const pdf = makePdf([['A first page with some words on it.'], ['A second page.']]);
    const result = await extractPdfText(pdf, pdfjs, 10);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('A first page');
    expect(result.text).not.toContain('second');
  });

  it('says so when a PDF has no text, as with scanned pages', async () => {
    const result = await extractText(upload('scan.pdf', makePdf([[]])), options);
    expect(result).toEqual({ ok: false, message: expect.stringContaining('scanned pages') });
  });

  it('refuses a damaged PDF', async () => {
    const damaged = new TextEncoder().encode('%PDF-1.4\nthis is not really a PDF at all');
    const result = await extractText(upload('broken.pdf', damaged), options);
    expect(result).toEqual({ ok: false, message: 'This PDF is damaged or could not be read.' });
  });

  it('refuses a PDF with too many pages', async () => {
    const pdf = makePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, () => ['x']));
    const result = await extractText(upload('huge.pdf', pdf), options);
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining(`${MAX_PDF_PAGES} pages`),
    });
  });
});
