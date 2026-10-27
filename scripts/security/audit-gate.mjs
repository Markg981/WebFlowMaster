// Dependency audit gate (audit A-02). Fails on high or critical production findings that are not
// listed, unexpired, in the machine-readable table of docs/SECURITY-AUDIT.md:
//   | GHSA-xxxx-xxxx-xxxx | package | 2026-12-31 | reachability |
// Usage: node scripts/security/audit-gate.mjs [--client]   (reads `npm audit --omit=dev --json`)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GHSA = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;

export function parseExceptions(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 3 || !GHSA.test(cells[0])) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[2]))
      throw new Error(`Invalid expiry for ${cells[0]}: ${cells[2]}`);
    rows.push({ id: cells[0].toUpperCase(), pkg: cells[1], expires: cells[2] });
  }
  return rows;
}

export function findingsOf(auditJson) {
  const found = new Map();
  for (const [name, v] of Object.entries(auditJson.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via !== 'object') continue;
      if (via.severity !== 'high' && via.severity !== 'critical') continue;
      const id = String(via.url ?? '')
        .split('/')
        .pop()
        .toUpperCase();
      found.set(id || `${name}:${via.title}`, {
        id,
        pkg: via.name ?? name,
        severity: via.severity,
      });
    }
  }
  return [...found.values()];
}

export function evaluate(findings, exceptions, today = new Date().toISOString().slice(0, 10)) {
  const errors = [];
  for (const f of findings) {
    const ex = exceptions.find((e) => e.id === f.id);
    if (!ex) errors.push(`${f.severity} ${f.pkg} ${f.id}: not listed in docs/SECURITY-AUDIT.md`);
    else if (ex.expires < today)
      errors.push(`${f.severity} ${f.pkg} ${f.id}: exception expired ${ex.expires}`);
  }
  return errors;
}

function run() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const args = ['audit', '--omit=dev', '--json'];
  if (process.argv.includes('--client')) args.push('--workspace', 'client');
  let out;
  try {
    out = execFileSync('npm', args, {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64e6,
    });
  } catch (e) {
    out = e.stdout; // npm audit exits 1 when it finds something
    if (!out) throw e;
  }
  const doc = readFileSync(new URL('../../docs/SECURITY-AUDIT.md', import.meta.url), 'utf8');
  const errors = evaluate(findingsOf(JSON.parse(out)), parseExceptions(doc));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('audit gate: no unlisted or expired high/critical production findings');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
