import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';

/** Where multer stores uploaded workbooks; the guard opens nothing outside it. */
export const XLSX_UPLOAD_DIR = path.resolve('uploads');

/** An .xlsx is a zip: the 10 MB upload cap is on the compressed bytes, not on what ExcelJS inflates. */
export const XLSX_LIMITS = {
  maxEntries: 2000,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  maxEntryUncompressedBytes: 50 * 1024 * 1024,
  maxCompressionRatio: 100,
};

export class XlsxLimitError extends Error {}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const INVALID = 'The file is not a valid .xlsx archive.';

const TOO_MUCH = 'The workbook expands to too much data.';

/** Inflates one entry into a counter (nothing is kept) and aborts as soon as a limit is crossed. */
async function measureEntry(
  fh: fs.FileHandle,
  start: number,
  compressed: number,
  method: number,
  totalLeft: number,
): Promise<number> {
  const cap = Math.min(XLSX_LIMITS.maxEntryUncompressedBytes, totalLeft);
  if (method === 0) {
    if (compressed > cap) throw new XlsxLimitError(TOO_MUCH);
    return compressed;
  }
  if (method !== 8) throw new Error(INVALID);
  const inflate = zlib.createInflateRaw();
  let out = 0;
  let failure: unknown;
  inflate.on('data', (chunk: Buffer) => {
    out += chunk.length;
    if (out > cap && !failure) {
      failure = new XlsxLimitError(TOO_MUCH);
      inflate.destroy();
    }
  });
  const done = new Promise<void>((resolve) => {
    inflate.on('end', resolve);
    inflate.on('close', resolve);
    inflate.on('error', (e) => {
      failure ??= e;
      resolve();
    });
  });
  const chunk = Buffer.alloc(64 * 1024);
  for (let read = 0; read < compressed && !failure;) {
    const n = Math.min(chunk.length, compressed - read);
    const { bytesRead } = await fh.read(chunk, 0, n, start + read);
    if (bytesRead === 0) break;
    read += bytesRead;
    if (!inflate.write(Buffer.from(chunk.subarray(0, bytesRead)))) {
      await Promise.race([new Promise((r) => inflate.once('drain', r)), done]);
    }
  }
  if (!failure) inflate.end();
  await done;
  if (failure instanceof XlsxLimitError) throw failure;
  if (failure) throw new Error(INVALID);
  return out;
}

/**
 * Reads the zip central directory, rejects archives whose declared sizes would exhaust memory when
 * ExcelJS loads them, then inflates every entry into a counter (not trusting the declared sizes) and
 * rejects any whose real size differs from the declaration or crosses the limits. Throws XlsxLimitError.
 */
export async function assertXlsxWithinLimits(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(XLSX_UPLOAD_DIR + path.sep)) throw new Error(INVALID);
  const fh = await fs.open(resolved, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error(INVALID);
    const entries = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
      throw new XlsxLimitError('Zip64 workbooks are not supported.');
    if (entries > XLSX_LIMITS.maxEntries)
      throw new XlsxLimitError(`The workbook has too many parts (${entries}).`);
    if (cdOffset + cdSize > size) throw new Error(INVALID);

    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    let pos = 0;
    let total = 0;
    const parts: { offset: number; compressed: number; declared: number; method: number }[] = [];
    for (let n = 0; n < entries; n++) {
      if (pos + 46 > cdSize || cd.readUInt32LE(pos) !== CDH_SIG) throw new Error(INVALID);
      const compressed = cd.readUInt32LE(pos + 20);
      const uncompressed = cd.readUInt32LE(pos + 24);
      if (compressed === 0xffffffff || uncompressed === 0xffffffff)
        throw new XlsxLimitError('Zip64 workbooks are not supported.');
      if (uncompressed > XLSX_LIMITS.maxEntryUncompressedBytes)
        throw new XlsxLimitError('A part of the workbook expands to too much data.');
      if (
        uncompressed > 1024 * 1024 &&
        uncompressed / Math.max(compressed, 1) > XLSX_LIMITS.maxCompressionRatio
      )
        throw new XlsxLimitError('The workbook compression ratio is not plausible.');
      total += uncompressed;
      if (total > XLSX_LIMITS.maxTotalUncompressedBytes)
        throw new XlsxLimitError('The workbook expands to too much data.');
      parts.push({
        offset: cd.readUInt32LE(pos + 42),
        compressed,
        declared: uncompressed,
        method: cd.readUInt16LE(pos + 10),
      });
      pos += 46 + cd.readUInt16LE(pos + 28) + cd.readUInt16LE(pos + 30) + cd.readUInt16LE(pos + 32);
    }
    // The declared sizes are attacker-controlled: measure what the entries really inflate to.
    let measured = 0;
    for (const part of parts) {
      const lh = Buffer.alloc(30);
      await fh.read(lh, 0, 30, part.offset);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(INVALID);
      const start = part.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      if (start + part.compressed > size) throw new Error(INVALID);
      const left = XLSX_LIMITS.maxTotalUncompressedBytes - measured;
      const real = await measureEntry(fh, start, part.compressed, part.method, left);
      if (real !== part.declared)
        throw new XlsxLimitError('The workbook sizes do not match its contents.');
      measured += real;
    }
  } finally {
    await fh.close();
  }
}
