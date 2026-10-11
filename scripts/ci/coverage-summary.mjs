// Appends one suite's coverage totals to the GitHub job summary.
// Usage: node scripts/ci/coverage-summary.mjs <Suite name> <path to coverage-summary.json>
import fs from 'node:fs';

const [name, file] = process.argv.slice(2);
const target = process.env.GITHUB_STEP_SUMMARY;

if (!name || !file) {
  console.error('usage: coverage-summary.mjs <suite> <coverage-summary.json>');
  process.exit(2);
}
// The suite failed before writing a report: nothing to summarise, and the failing step already says why.
if (!fs.existsSync(file)) process.exit(0);

const total = JSON.parse(fs.readFileSync(file, 'utf8')).total;
const cells = ['lines', 'statements', 'functions', 'branches'].map((key) => `${total[key].pct}%`);
const table = [
  `### ${name} coverage`,
  '',
  '| Lines | Statements | Functions | Branches |',
  '|---|---|---|---|',
  `| ${cells.join(' | ')} |`,
  '',
].join('\n');

if (target) fs.appendFileSync(target, table);
else console.log(table);
