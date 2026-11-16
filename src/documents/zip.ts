/**
 * Just enough of the ZIP format to read one file out of a Word document
 * (a .docx file is a ZIP archive). Decompression uses the browser's own
 * `DecompressionStream`, so no library is needed.
 *
 * Archives are untrusted: every size is checked against the buffer before it
 * is used, the decompressed size is capped while it is produced (a small file
 * cannot expand into gigabytes), and the result is checked against the CRC-32
 * the archive records, so a damaged archive is reported rather than misread.
 */

export class ZipError extends Error {
  readonly reason: 'corrupt' | 'encrypted' | 'unsupported' | 'too-large';

  constructor(reason: ZipError['reason'], message: string) {
    super(message);
    this.name = 'ZipError';
    this.reason = reason;
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

interface Entry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function corrupt(): ZipError {
  return new ZipError('corrupt', 'The archive is damaged.');
}

/** The archive's table of contents, read from the end of the file. */
export function listEntries(bytes: Uint8Array): Entry[] {
  const data = view(bytes);
  // The end record is at least 22 bytes and may be followed by a comment of up to 64 KiB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (data.getUint32(i, true) === EOCD_SIGNATURE) {
      end = i;
      break;
    }
  }
  if (end === -1) throw corrupt();

  const count = data.getUint16(end + 10, true);
  const directorySize = data.getUint32(end + 12, true);
  const directoryOffset = data.getUint32(end + 16, true);
  if (directoryOffset === 0xffffffff || count === 0xffff) {
    throw new ZipError('unsupported', 'Very large (ZIP64) archives are not supported.');
  }
  if (directoryOffset + directorySize > end) throw corrupt();

  const decoder = new TextDecoder();
  const entries: Entry[] = [];
  let at = directoryOffset;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > end || data.getUint32(at, true) !== CENTRAL_SIGNATURE) throw corrupt();
    const nameLength = data.getUint16(at + 28, true);
    const extraLength = data.getUint16(at + 30, true);
    const commentLength = data.getUint16(at + 32, true);
    if (at + 46 + nameLength > end) throw corrupt();
    entries.push({
      flags: data.getUint16(at + 8, true),
      method: data.getUint16(at + 10, true),
      crc: data.getUint32(at + 16, true),
      compressedSize: data.getUint32(at + 20, true),
      size: data.getUint32(at + 24, true),
      localOffset: data.getUint32(at + 42, true),
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflate(compressed: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      // A copy: the stream needs a buffer of its own.
      controller.enqueue(compressed.slice());
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ZipError('too-large', 'The document expands to more than can be read.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ZipError) throw error;
    throw corrupt();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * The contents of the file called `name`, or null when the archive has no such
 * file. Throws a `ZipError` for a damaged, encrypted or oversized entry.
 */
export async function readEntry(
  bytes: Uint8Array,
  name: string,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const entry = listEntries(bytes).find((e) => e.name === name);
  if (!entry) return null;
  if (entry.flags & 0x1) throw new ZipError('encrypted', 'The document is password protected.');
  if (entry.size > maxBytes) {
    throw new ZipError('too-large', 'The document expands to more than can be read.');
  }

  const data = view(bytes);
  const at = entry.localOffset;
  if (at + 30 > bytes.length || data.getUint32(at, true) !== LOCAL_SIGNATURE) throw corrupt();
  const start = at + 30 + data.getUint16(at + 26, true) + data.getUint16(at + 28, true);
  if (start + entry.compressedSize > bytes.length) throw corrupt();
  const compressed = bytes.subarray(start, start + entry.compressedSize);

  let content: Uint8Array;
  if (entry.method === 0) content = compressed;
  else if (entry.method === 8) content = await inflate(compressed, maxBytes);
  else throw new ZipError('unsupported', 'The document uses an unsupported compression method.');

  if (content.length !== entry.size || crc32(content) !== entry.crc) throw corrupt();
  return content;
}
