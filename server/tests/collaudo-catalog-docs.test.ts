import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The pages that quote the size of the collaudo catalog quote collaudo/casi.json.
 *
 * Every PR that added a case left "579 casi" behind in three places, and two PRs merged on the
 * same day each raised the protocol to the same version. A number that is checked here cannot
 * drift again: change the catalog, and this names the line to update.
 */
const repoRoot = path.resolve(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const catalog = JSON.parse(read('collaudo/casi.json')) as { version: number; areas: unknown[]; cases: { id: string }[] };

describe('the collaudo catalog as the docs describe it', () => {
  it('has unique case ids', () => {
    const ids = catalog.cases.map((c) => c.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  const actual = { version: catalog.version, cases: catalog.cases.length, areas: catalog.areas.length };
  type Field = keyof typeof actual;

  it.each<[string, RegExp, Field[]]>([
    ['collaudo/README.md', /protocollo \*\*(\d+)\*\*, \*\*(\d+) casi\*\* in \*\*(\d+) aree\*\*/, ['version', 'cases', 'areas']],
    ['collaudo/README.md', /contiene (\d+) casi, (\d+) aree, protocollo versione (\d+)/, ['cases', 'areas', 'version']],
    ['docs/en/internals/product-audit.md', /protocol (\d+), (\d+) cases/, ['version', 'cases']],
    ['docs/it/internals/product-audit.md', /protocollo (\d+), (\d+) casi/, ['version', 'cases']],
    ['collaudo/casi.json', /Protocollo (\d+): (\d+) casi in (\d+) aree/, ['version', 'cases', 'areas']],
  ])('%s quotes the current catalog (%s)', (file, pattern, fields) => {
    const match = read(file).match(pattern);
    expect(match, `${file} no longer contains ${pattern}`).not.toBeNull();
    expect(match!.slice(1).map(Number)).toEqual(fields.map((field) => actual[field]));
  });
});
