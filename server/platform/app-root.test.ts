import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_ROOT, findAppRoot } from './app-root';

describe('the app root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-app-root-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('is the repository when running from source', () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    expect(APP_ROOT).toBe(repo);
  });

  it('is the nearest folder with a package.json, at any depth (dist/ once bundled)', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    const dist = path.join(tmp, 'dist');
    const deep = path.join(tmp, 'server', 'platform', 'observability');
    fs.mkdirSync(dist, { recursive: true });
    fs.mkdirSync(deep, { recursive: true });
    expect(findAppRoot(dist)).toBe(tmp);
    expect(findAppRoot(deep)).toBe(tmp);
  });
});
