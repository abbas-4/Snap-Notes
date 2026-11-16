import { readEntry } from './zip';

/**
 * Text from a Word document (.docx): the paragraphs of its main body, in
 * order, read from `word/document.xml`. Headers, footers, comments and images
 * are left out. The XML is parsed as data by the browser's `DOMParser`; nothing
 * in the file is run, fetched or rendered.
 */

export class DocxError extends Error {
  readonly reason: 'not-docx' | 'corrupt';

  constructor(reason: DocxError['reason'], message: string) {
    super(message);
    this.name = 'DocxError';
    this.reason = reason;
  }
}

/** The body of a long book is a few MB of XML; this leaves room without risking memory. */
const MAX_XML_BYTES = 40 * 1024 * 1024;

/** Collects text paragraph by paragraph, with tabs and line breaks where Word has them. */
function collectText(node: Element, paragraphs: string[], current: string[]): void {
  for (const child of Array.from(node.children)) {
    switch (child.localName) {
      case 'p': {
        const parts: string[] = [];
        collectText(child, paragraphs, parts);
        paragraphs.push(parts.join(''));
        break;
      }
      case 't':
        current.push(child.textContent ?? '');
        break;
      case 'tab':
        current.push('\t');
        break;
      case 'br':
      case 'cr':
        current.push('\n');
        break;
      // Deleted text in tracked changes, and the text of fields' instructions, are not content.
      case 'delText':
      case 'instrText':
        break;
      default:
        collectText(child, paragraphs, current);
    }
  }
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const xmlBytes = await readEntry(bytes, 'word/document.xml', MAX_XML_BYTES);
  if (xmlBytes === null) {
    throw new DocxError('not-docx', 'This file is not a Word document.');
  }
  const xml = new TextDecoder().decode(xmlBytes);
  // Word never writes a DOCTYPE; one here could only be an attempt at entity expansion.
  if (/<!DOCTYPE/i.test(xml)) throw new DocxError('corrupt', 'The document is damaged.');

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new DocxError('corrupt', 'The document is damaged.');
  }
  const body = Array.from(doc.documentElement.children).find((el) => el.localName === 'body');
  if (!body) throw new DocxError('corrupt', 'The document is damaged.');

  const paragraphs: string[] = [];
  collectText(body, paragraphs, []);
  return paragraphs.join('\n');
}
