/**
 * Explicit `any` in production code, per area, against a budget that only goes down.
 *
 * `strict` is on, but `: any` and `as any` switch it off one value at a time. Turning
 * @typescript-eslint/no-explicit-any on would fail `npm run lint` (--max-warnings 0) on the
 * existing uses, so this counts them instead: the check fails when an area has more than its
 * budget, and also when it has fewer, so the budget follows every removal down. Tests are not
 * counted; a mock typed `any` is not a hole in the product's types.
 *
 *   node scripts/any-budget.mjs           check against scripts/any-budget.json
 *   node scripts/any-budget.mjs --update  write the current counts as the new budget
 *   node scripts/any-budget.mjs --top 20  also list the files with the most
 */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgetFile = path.join(root, 'scripts/any-budget.json');
export const AREAS = {
  server: 'server',
  client: 'client/src',
  shared: 'shared',
  scripts: 'scripts',
};
const TEST = /(\.test\.tsx?$|\/__tests__\/|^server\/tests\/|\/test-utils?\/)/;

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Occurrences of the `any` type in one file's source. */
export function countAny(fileName, text) {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  let count = 0;
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) count++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

export function measure() {
  const totals = {};
  const files = [];
  for (const [area, dir] of Object.entries(AREAS)) {
    totals[area] = 0;
    for (const file of sourceFiles(path.join(root, dir))) {
      const relative = path.relative(root, file).replaceAll('\\', '/');
      if (TEST.test(relative)) continue;
      const count = countAny(file, fs.readFileSync(file, 'utf8'));
      totals[area] += count;
      if (count) files.push({ file: relative, count });
    }
  }
  return { totals, files: files.sort((a, b) => b.count - a.count) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { totals, files } = measure();
  const topIndex = process.argv.indexOf('--top');
  if (topIndex > 0)
    for (const { file, count } of files.slice(0, Number(process.argv[topIndex + 1]) || 20))
      console.log(String(count).padStart(5), file);

  if (process.argv.includes('--update')) {
    fs.writeFileSync(budgetFile, JSON.stringify(totals, null, 2) + '\n');
    console.log('any budget updated:', totals);
    process.exit(0);
  }
  const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
  const over = [];
  const under = [];
  for (const area of Object.keys(AREAS)) {
    const now = totals[area];
    const allowed = budget[area] ?? 0;
    console.log(`${area.padEnd(8)} ${String(now).padStart(5)} / ${allowed}`);
    if (now > allowed) over.push(`${area}: ${now} explicit any, budget ${allowed}`);
    if (now < allowed) under.push(`${area}: ${now}, budget still ${allowed}`);
  }
  if (over.length) {
    console.error(
      `\nMore explicit \`any\` than the budget allows:\n  ${over.join('\n  ')}\n` +
        'Type the value instead: a zod schema from shared/ at a boundary (request body, job payload, ' +
        'WebSocket message), `unknown` and a check elsewhere.',
    );
    process.exit(1);
  }
  if (under.length) {
    console.error(
      `\nFewer explicit \`any\` than the budget: good. Lock it in with\n` +
        `  node scripts/any-budget.mjs --update\nand commit scripts/any-budget.json.\n  ${under.join('\n  ')}`,
    );
    process.exit(1);
  }
}
