import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

// worker.ts runs on import and needs Redis; the bootstrap order is pinned on its source.
describe('worker bootstrap', () => {
  const worker = read('./worker.ts');
  it('validates the startup configuration before the database checks', () => {
    const config = worker.indexOf("assertStartupConfig(process.env, 'worker');");
    expect(config).toBeGreaterThan(-1);
    expect(config).toBeLessThan(worker.indexOf('await assertTenancyPreconditions();'));
    expect(worker).toContain('await assertSchemaMigrated();');
  });
  it('runs the abandoned-run recovery sweep and stops it on shutdown', () => {
    expect(worker).toContain('startRunRecovery()');
    expect(worker).toContain('stopRunRecovery();');
  });
  it('keeps the recovery sweep under the advisory lock', () => {
    expect(read('./execution/run-recovery.ts')).toContain('ADVISORY_KEYS.runRecovery');
  });
});

describe('apply-migrations', () => {
  const script = read('../scripts/apply-migrations.ts');
  it('does not report a closeDb failure as an unreachable database', () => {
    const reach = script.indexOf('Could not reach the database');
    const close = script.indexOf('closing the database failed');
    const closeCall = script.indexOf('closeDb()');
    expect(reach).toBeGreaterThan(-1);
    expect(closeCall).toBeGreaterThan(reach);
    expect(close).toBeGreaterThan(closeCall);
  });
});
