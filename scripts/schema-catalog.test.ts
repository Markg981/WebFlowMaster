import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * docs/{en,it}/internals/schema-catalog.md is generated from shared/schema.ts and states how many
 * tables and columns there are. Nothing regenerated it, so it said 70 tables while the schema had 72
 * and the marketing README repeated the stale number. This fails as soon as the two drift.
 */
describe('schema catalog', () => {
  it('matches shared/schema.ts', () => {
    const root = path.resolve(__dirname, '..');
    expect(() =>
      execFileSync(process.execPath, ['scripts/generate-schema-catalog.mjs', '--check'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  }, 60_000);
});
