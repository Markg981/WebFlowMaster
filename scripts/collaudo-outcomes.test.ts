// @ts-expect-error plain .mjs module without type declarations
import { catalogHash, loadCases } from './collaudo-hash.mjs';
// @ts-expect-error plain .mjs module without type declarations
import { validateOutcomes } from './collaudo-outcomes.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function fixture(second = 'x') {
  const dir = mkdtempSync(join(tmpdir(), 'collaudo-'));
  mkdirSync(join(dir, 'AAA'));
  writeFileSync(join(dir, 'catalogo.json'), '{"version":1}');
  writeFileSync(join(dir, 'AAA', 'AAA-01.json'), '{"id":"AAA-01","priority":"P1"}');
  writeFileSync(join(dir, 'AAA', 'AAA-02.json'), `{"id":"AAA-02","priority":"P3","n":"${second}"}`);
  return dir;
}

describe('collaudo catalogue hash', () => {
  it('is deterministic and changes with content', () => {
    expect(catalogHash(fixture())).toBe(catalogHash(fixture()));
    expect(catalogHash(fixture())).not.toBe(catalogHash(fixture('y')));
    expect(catalogHash()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('collaudo outcomes validator', () => {
  const dir = fixture();
  const cases = loadCases(dir);
  const hash = catalogHash(dir);
  const base = { release: 'r', date: 'd', tester: 't' };
  const run = (results: unknown[], h = hash) =>
    validateOutcomes({ ...base, catalogHash: h, results }, cases, hash);

  it('accepts a complete file where P1/P2 passed', () => {
    const r = run([
      { id: 'AAA-01', outcome: 'passed' },
      { id: 'AAA-02', outcome: 'skipped' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.accepted).toBe(true);
  });
  it('rejects unknown ids, missing ids and hash mismatch', () => {
    expect(run([{ id: 'ZZZ-01', outcome: 'passed' }]).errors.join()).toMatch(/sconosciuto/);
    expect(run([{ id: 'AAA-01', outcome: 'passed' }]).errors.join()).toMatch(/mancanti/);
    expect(run([], 'bad').errors.join()).toMatch(/catalogHash/);
  });
  it('is valid but not accepted when a P1 case failed', () => {
    const r = run([
      { id: 'AAA-01', outcome: 'failed' },
      { id: 'AAA-02', outcome: 'passed' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.accepted).toBe(false);
  });
});
