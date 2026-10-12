/**
 * The import rules of .dependency-cruiser.mjs, with a baseline that only shrinks.
 *
 * `depcruise --ignore-known` fails on a new violation but stays green when a known one is fixed
 * and left in .dependency-cruiser-known-violations.json, and that entry would then excuse the
 * same import if it came back. So this also fails when the baseline lists more than the code
 * still does: fix an import, then `npm run deps:baseline` and commit the shorter file.
 *
 *   node scripts/deps-check.mjs   check (npm run deps:check, CI)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const knownFile = path.join(root, '.dependency-cruiser-known-violations.json');
const bin = path.join(root, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');

const run = (outputType) =>
  spawnSync(
    process.execPath,
    [
      bin,
      'server',
      'shared',
      '--config',
      '.dependency-cruiser.mjs',
      '--ignore-known',
      '.dependency-cruiser-known-violations.json',
      '--output-type',
      outputType,
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );

const json = run('json');
if (json.error || !json.stdout) {
  console.error(json.error ?? json.stderr);
  process.exit(2);
}
const { summary } = JSON.parse(json.stdout);
const known = JSON.parse(fs.readFileSync(knownFile, 'utf8')).length;
const fresh = summary.violations.filter((v) => v.rule.severity === 'error').length;

if (fresh > 0) {
  // The text reporter says which import broke which rule, with the rule's comment.
  process.stdout.write(run('err-long').stdout);
  console.error(
    `\n${fresh} new import(s) break the rules above. Domains and ranks: scripts/server-domains.mjs.`,
  );
  process.exit(1);
}
if (summary.ignore < known) {
  console.error(
    `${known - summary.ignore} known violation(s) are fixed but still listed in ` +
      '.dependency-cruiser-known-violations.json. Run `npm run deps:baseline` and commit it.',
  );
  process.exit(1);
}
console.log(
  `deps: ${summary.totalCruised} modules, no new violations (${summary.ignore} known, see ` +
    '.dependency-cruiser-known-violations.json).',
);
