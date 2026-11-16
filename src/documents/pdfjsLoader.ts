import type { PdfJs } from './pdf';

/**
 * Loads PDF.js on first use, with its worker served from this site, so the
 * library is downloaded only by someone who opens a PDF and parsing happens
 * off the main thread.
 */
export async function loadPdfJs(): Promise<PdfJs> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs as unknown as PdfJs;
}
