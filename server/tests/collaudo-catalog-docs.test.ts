import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from '../../collaudo/app/catalog.mjs';

/**
 * The collaudo catalog is collaudo/casi, one file per case, and its size is never written by hand.
 *
 * casi.json was one array and every page quoted "N casi": every PR that added a case edited the
 * same lines, so each merge left the other open PRs in conflict and the counts out of date.
 */
const repoRoot = path.resolve(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const pages = [
  'collaudo/README.md',
  'docs/en/internals/product-audit.md',
  'docs/it/internals/product-audit.md',
  'docs/en/admin/test-lab.md',
  'docs/it/admin/test-lab.md',
];

describe('the collaudo catalog', () => {
  it('has unique case ids and fills its counts in the preparation text', async () => {
    const catalog = await loadCatalog();
    const ids = catalog.cases.map((c: { id: string }) => c.id);
    expect(ids.filter((id: string, i: number) => ids.indexOf(id) !== i)).toEqual([]);
    const html = catalog.presentation.preparationHtml;
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain(
      `Protocollo ${catalog.version}: ${catalog.cases.length} casi in ${catalog.areas.length} aree`,
    );
  });

  it.each(pages)('%s quotes no case count and no casi.json', (file) => {
    const text = read(file);
    expect(text).not.toMatch(/casi\.json/);
    expect(text).not.toMatch(
      /\d+ casi\*{0,2},? (?:in \*{0,2})?\d+ aree|protocol(?:lo)? \d+, \d+ cas/i,
    );
  });
});
