import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without type declarations
import { SCREENSHOTS } from './docs-screenshots.mjs';

/**
 * The guides show screenshots from docs/public/screenshots, made by scripts/docs-screenshots.mjs.
 * VitePress does not fail on a missing image, so a renamed or forgotten one would ship as a broken
 * picture; a file no page shows would only weigh on the repository.
 */
const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'docs/public/screenshots');

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : markdownFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

const referenced = new Set(
  ['en', 'it', 'fr', 'de'].flatMap((lang) =>
    markdownFiles(path.join(root, 'docs', lang)).flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/\/screenshots\/([\w-]+)\.webp/g)].map(
        (match) => match[1],
      ),
    ),
  ),
);

describe('guide screenshots', () => {
  it('exist for every image a page shows', () => {
    const missing = [...referenced].filter(
      (name) => !fs.existsSync(path.join(folder, `${name}.webp`)),
    );
    expect(missing).toEqual([]);
  });

  it('are all shown, and all made by the script', () => {
    const files = fs
      .readdirSync(folder)
      .filter((name) => name.endsWith('.webp'))
      .map((name) => name.replace(/\.webp$/, ''))
      .sort();
    expect(files).toEqual([...referenced].sort());
    expect(Object.keys(SCREENSHOTS).sort()).toEqual(files);
  });
});
