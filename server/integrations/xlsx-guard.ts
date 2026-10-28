import fs from 'fs/promises';
import path from 'path';

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

/**
 * Reads only the zip central directory (never inflates anything) and rejects archives whose declared
 * sizes would exhaust memory when ExcelJS loads them. Throws XlsxLimitError.
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
      pos += 46 + cd.readUInt16LE(pos + 28) + cd.readUInt16LE(pos + 30) + cd.readUInt16LE(pos + 32);
    }
  } finally {
    await fh.close();
  }
}
