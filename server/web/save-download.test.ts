import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import fs from 'fs-extra';
import { saveDownload } from './step-executor';

/** A download whose copy fails with `code` for the first `failures` attempts (a file locked by an antivirus). */
function lockedDownload(failures: number, code = 'EBUSY') {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async saveAs(file: string) {
      calls++;
      if (calls <= failures)
        throw Object.assign(new Error(`${code}: resource busy or locked, copyfile`), { code });
      await fs.writeFile(file, 'copied');
    },
    async createReadStream() {
      return Readable.from(['streamed']);
    },
  };
}

describe('saveDownload', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-save-download-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('retries the copy while the file is locked (EBUSY)', async () => {
    const download = lockedDownload(2);
    const file = path.join(dir, 'a.xlsx');
    await saveDownload(download, file, [1, 1, 1]);
    expect(download.calls).toBe(3);
    expect(await fs.readFile(file, 'utf8')).toBe('copied');
  });

  it('streams the content when the copy stays locked', async () => {
    const download = lockedDownload(99, 'EPERM');
    const file = path.join(dir, 'b.xlsx');
    await saveDownload(download, file, [1, 1]);
    expect(download.calls).toBe(3);
    expect(await fs.readFile(file, 'utf8')).toBe('streamed');
  });

  it('does not retry an error that is not a lock', async () => {
    const download = lockedDownload(1, 'ENOSPC');
    await expect(saveDownload(download, path.join(dir, 'c.xlsx'), [1, 1])).rejects.toThrow(
      /ENOSPC/,
    );
    expect(download.calls).toBe(1);
  });
});
