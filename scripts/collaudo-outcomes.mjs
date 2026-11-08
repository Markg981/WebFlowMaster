// Validates collaudo outcome files against the current catalogue.
// Usage: node scripts/collaudo-outcomes.mjs [file.json ...]   (default: every collaudo/esiti/*.json except TEMPLATE.json)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogHash, loadCases } from './collaudo-hash.mjs';

const OUTCOMES = ['passed', 'failed', 'blocked', 'skipped'];
const REQUIRED_PRIORITIES = ['P1', 'P2'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const esitiDir = join(root, 'collaudo', 'esiti');

/** Returns { errors, summary, accepted } for one parsed outcome file. */
export function validateOutcomes(data, cases = loadCases(), hash = catalogHash()) {
  const errors = [];
  const summary = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const key of ['release', 'catalogHash', 'date', 'tester'])
    if (typeof data?.[key] !== 'string' || !data[key]) errors.push(`campo mancante: ${key}`);
  if (!Array.isArray(data?.results)) {
    errors.push('results deve essere un array');
    return { errors, summary, accepted: false, notPassed: 0 };
  }
  if (data.catalogHash && data.catalogHash !== hash)
    errors.push(`catalogHash non corrisponde al catalogo attuale (${hash})`);
  const known = new Map(cases.map((c) => [c.id, c]));
  const seen = new Map();
  for (const r of data.results) {
    if (!known.has(r?.id)) errors.push(`ID sconosciuto: ${r?.id}`);
    else if (seen.has(r.id)) errors.push(`ID duplicato: ${r.id}`);
    if (!OUTCOMES.includes(r?.outcome)) errors.push(`esito non valido per ${r?.id}: ${r?.outcome}`);
    else summary[r.outcome]++;
    seen.set(r?.id, r?.outcome);
  }
  const missing = cases.filter((c) => !seen.has(c.id)).map((c) => c.id);
  if (missing.length)
    errors.push(
      `ID mancanti (${missing.length}): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}`,
    );
  const notPassed = cases.filter(
    (c) => REQUIRED_PRIORITIES.includes(c.priority) && seen.get(c.id) !== 'passed',
  );
  return {
    errors,
    summary,
    accepted: !errors.length && !notPassed.length,
    notPassed: notPassed.length,
  };
}

function main() {
  let files = process.argv.slice(2);
  if (!files.length)
    files = existsSync(esitiDir)
      ? readdirSync(esitiDir)
          .filter((f) => f.endsWith('.json') && f !== 'TEMPLATE.json')
          .sort()
          .map((f) => join(esitiDir, f))
      : [];
  if (!files.length) return console.log('Nessun file di esiti da validare.');
  const cases = loadCases();
  const hash = catalogHash();
  let failed = false;
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`${file}: JSON non valido (${e.message})`);
      failed = true;
      continue;
    }
    const { errors, summary, accepted, notPassed } = validateOutcomes(data, cases, hash);
    console.log(
      `${file}: passed ${summary.passed}, failed ${summary.failed}, blocked ${summary.blocked}, skipped ${summary.skipped}`,
    );
    if (errors.length) {
      failed = true;
      for (const e of errors) console.error(`  ERRORE ${e}`);
    } else
      console.log(
        accepted
          ? '  Criterio superato: tutti i casi P1/P2 passed.'
          : `  Criterio NON superato: ${notPassed} casi P1/P2 non passed (file valido).`,
      );
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
