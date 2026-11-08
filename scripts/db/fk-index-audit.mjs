#!/usr/bin/env node
// Usage: node scripts/db/fk-index-audit.mjs [--json]
// Lists foreign-key columns without a leading index, from migrations/*.sql only (static, heuristic).
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMigrations, findUnindexed } from './fk-index-audit-core.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const files = readdirSync(dir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
const parsed = parseMigrations(files);
const missing = findUnindexed(parsed);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(missing, null, 2));
} else {
  console.log(`${missing.length} of ${parsed.fks.length} foreign keys without a leading index`);
  for (const fk of missing)
    console.log(
      `${fk.table}\t(${fk.cols.join(', ')})\t-> ${fk.refTable}\ton delete ${fk.onDelete}\t${fk.file}`,
    );
}
