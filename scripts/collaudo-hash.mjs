// Deterministic SHA-256 of the collaudo catalogue (collaudo/casi: catalogo.json + every case file).
// Usage: node scripts/collaudo-hash.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultCatalogDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'collaudo',
  'casi',
);

function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.name.endsWith('.json')) out.push(rel);
  }
  return out;
}

/** Hash over sorted relative paths and LF-normalised contents, so it is stable across OS and checkouts. */
export function catalogHash(dir = defaultCatalogDir) {
  const hash = createHash('sha256');
  for (const rel of listFiles(dir).sort()) {
    const text = readFileSync(join(dir, rel), 'utf8').replace(/\r\n/g, '\n');
    hash.update(`${rel}\n${text.length}\n${text}\n`);
  }
  return hash.digest('hex');
}

/** Cases of the catalogue: [{ id, priority }]. */
export function loadCases(dir = defaultCatalogDir) {
  return listFiles(dir)
    .filter((rel) => rel.includes('/'))
    .sort()
    .map((rel) => {
      const item = JSON.parse(readFileSync(join(dir, rel), 'utf8'));
      return { id: item.id, priority: item.priority };
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(catalogHash());
}
