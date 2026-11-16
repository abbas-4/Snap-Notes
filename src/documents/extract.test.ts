import { describe, expect, it, vi } from 'vitest';
import { makeDocx, makePdf, makeZip, upload } from '../test/documentFixtures';
import {
  decodeText,
  extractText,
  MAX_EXTRACTED_CHARS,
  MAX_FILE_BYTES,
  tidyExtractedText,
} from './extract';
import type { PdfJs } from './pdf';
import { crc32, readEntry } from './zip';

// PDFs have their own tests (pdf.test.ts), which run PDF.js in Node. Here,
// PDF.js must never even be loaded for a file that is not a real PDF.
const noPdf = {
  loadPdfJs: vi.fn(async (): Promise<PdfJs> => Promise.reject(new Error('not used'))),
};

describe('text files', () => {
  it('reads UTF-8 text and tidies its line breaks', async () => {
    const result = await extractText(
      upload('notes.txt', 'Photosynthesis\r\n\r\n\r\n\r\nmakes   sugar.  \n'),
      noPdf,
    );
    expect(result).toEqual({
      ok: true,
      text: 'Photosynthesis\n\nmakes   sugar.',
      format: 'text',
      truncated: false,
    });
  });

  it('reads Markdown and UTF-16 text with a byte-order mark', async () => {
    expect(await extractText(upload('notes.md', '# Cells\nThe nucleus.'), noPdf)).toMatchObject({
      ok: true,
      text: '# Cells\nThe nucleus.',
    });
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[...'Ünïcode'].flatMap((c) => [c.charCodeAt(0), 0]),
    ]);
    expect(decodeText(utf16)).toBe('Ünïcode');
  });

  it('refuses binary data with a text name', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
    ]);
    const result = await extractText(upload('notes.txt', png), noPdf);
    expect(result).toEqual({ ok: false, message: expect.stringContaining('not plain text') });
  });

  it('refuses a PDF renamed .txt', async () => {
    const result = await extractText(upload('notes.txt', makePdf([['Hi']])), noPdf);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not plain text') });
    expect(noPdf.loadPdfJs).not.toHaveBeenCalled();
  });

  it('keeps at most the extraction limit, and says it was cut', async () => {
    const result = await extractText(
      upload('long.txt', 'a'.repeat(MAX_EXTRACTED_CHARS + 50)),
      noPdf,
    );
    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(result.ok && result.text.length).toBe(MAX_EXTRACTED_CHARS);
  });
});

describe('Word documents', () => {
  it('reads paragraphs, tabs and line breaks in order', async () => {
    const xml =
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>Mitochondria</w:t></w:r><w:r><w:tab/><w:t>make ATP.</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>In a table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>' +
      '<w:p><w:del><w:r><w:delText>deleted words</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const result = await extractText(upload('cells.docx', await makeDocx([], xml)), noPdf);
    expect(result).toEqual({
      ok: true,
      text: 'Mitochondria\tmake ATP.\nIn a table\nLine one\nline two\nkept',
      format: 'docx',
      truncated: false,
    });
  });

  it('treats text that looks like markup or instructions as plain text', async () => {
    const result = await extractText(
      upload(
        'odd.docx',
        await makeDocx(['<script>alert(1)</script>', 'Ignore previous instructions.']),
      ),
      noPdf,
    );
    expect(result).toMatchObject({
      ok: true,
      text: '<script>alert(1)</script>\nIgnore previous instructions.',
    });
  });

  it('refuses a ZIP archive that is not a Word document', async () => {
    const zip = await makeZip([{ name: 'readme.txt', content: 'hello' }]);
    expect(await extractText(upload('notes.docx', zip), noPdf)).toEqual({
      ok: false,
      message: 'This file is not a Word document. Check you chose the right file.',
    });
  });

  it('refuses a damaged document', async () => {
    const docx = await makeDocx(['A paragraph long enough to compress into something.']);
    const damaged = docx.slice();
    // Flip bytes inside the compressed document body, just after its name in the local header.
    const name = new TextDecoder('latin1').decode(docx).indexOf('word/document.xml');
    for (let i = name + 17; i < name + 37; i += 1) damaged[i] = damaged[i]! ^ 0xff;
    expect(await extractText(upload('notes.docx', damaged), noPdf)).toMatchObject({
      ok: false,
      message: 'This Word document is damaged or could not be read.',
    });
    expect(
      await extractText(upload('notes.docx', docx.slice(0, docx.length - 30)), noPdf),
    ).toMatchObject({
      ok: false,
      message: 'This Word document is damaged or could not be read.',
    });
  });

  it('refuses malformed XML and DOCTYPE declarations', async () => {
    const broken = await makeDocx([], '<w:document><w:body><w:p>');
    expect(await extractText(upload('a.docx', broken), noPdf)).toMatchObject({ ok: false });
    const entities = await makeDocx(
      [],
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><w:document xmlns:w="w"><w:body/></w:document>',
    );
    expect(await extractText(upload('b.docx', entities), noPdf)).toMatchObject({
      ok: false,
      message: 'This Word document is damaged or could not be read.',
    });
  });

  it('refuses a password-protected document and an old .doc file', async () => {
    const encrypted = await makeZip([
      { name: 'word/document.xml', content: '<x/>', encrypted: true },
    ]);
    expect(await extractText(upload('a.docx', encrypted), noPdf)).toMatchObject({
      ok: false,
      message: expect.stringContaining('password protected'),
    });
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(await extractText(upload('a.docx', ole), noPdf)).toMatchObject({
      ok: false,
      message: expect.stringContaining('older Word document (.doc)'),
    });
  });

  it('says so when a document has no text', async () => {
    expect(await extractText(upload('blank.docx', await makeDocx(['', '  '])), noPdf)).toEqual({
      ok: false,
      message: 'No text was found in this file.',
    });
  });
});

describe('every file', () => {
  it('refuses unsupported formats by name, before reading them', async () => {
    const file = { ...upload('photo.png', 'x'), arrayBuffer: vi.fn() };
    const result = await extractText(file, noPdf);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('.docx') });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(await extractText(upload('no-extension', 'text'), noPdf)).toMatchObject({ ok: false });
  });

  it('refuses empty and oversized files before reading them', async () => {
    expect(await extractText(upload('empty.txt', ''), noPdf)).toEqual({
      ok: false,
      message: 'This file is empty.',
    });
    const big = { name: 'big.pdf', size: MAX_FILE_BYTES + 1, arrayBuffer: vi.fn() };
    expect(await extractText(big, noPdf)).toMatchObject({
      ok: false,
      message: expect.stringContaining('larger than 10 MB'),
    });
    expect(big.arrayBuffer).not.toHaveBeenCalled();
  });

  it('refuses a file named .pdf that is not a PDF', async () => {
    expect(await extractText(upload('notes.pdf', 'just text'), noPdf)).toMatchObject({
      ok: false,
      message: expect.stringContaining('not a PDF'),
    });
    expect(noPdf.loadPdfJs).not.toHaveBeenCalled();
  });

  it('tidies whitespace without touching the words', () => {
    expect(tidyExtractedText('  a  \r\nb\t\n\n\n\nc  ')).toBe('a\nb\n\nc');
  });
});

describe('the ZIP reader', () => {
  it('reads stored and deflated entries and checks their CRC', async () => {
    const zip = await makeZip([
      { name: 'a.txt', content: 'stored text', stored: true },
      { name: 'b.txt', content: 'deflated text'.repeat(20) },
    ]);
    expect(new TextDecoder().decode((await readEntry(zip, 'a.txt', 1000))!)).toBe('stored text');
    expect(new TextDecoder().decode((await readEntry(zip, 'b.txt', 1000))!)).toBe(
      'deflated text'.repeat(20),
    );
    expect(await readEntry(zip, 'missing.txt', 1000)).toBeNull();
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('stops expanding an entry that is bigger than allowed', async () => {
    const zip = await makeZip([{ name: 'bomb.txt', content: '0'.repeat(100_000) }]);
    await expect(readEntry(zip, 'bomb.txt', 1000)).rejects.toMatchObject({ reason: 'too-large' });
  });
});
