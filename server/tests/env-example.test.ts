import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every environment variable the server reads must be named in `.env.example` (set or as a
 * commented-out default), or an operator never learns it exists (audit QA-11). The variables
 * below are read but deliberately not documented there.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const NOT_DOCUMENTED = new Set([
  // Set by the operating system or the shell, not configuration.
  'PATH',
  'TMPDIR',
  'DISPLAY',
  'SystemRoot',
  'npm_package_version',
  // Test-only switches.
  'TEST_ALLOWED',
  'MAILPIT_TEST_URL',
  'MAILPIT_TEST_SMTP_PORT',
  // Added by open pull requests that document them in `.env.example` themselves; listed so this
  // test does not fail on whichever of the two merges second.
  'SESSION_IDLE_TIMEOUT_MINUTES',
  'SCRYPT_LOG_N',
  'WFM_VISUAL_THRESHOLD',
  'GEMINI_TIMEOUT_MS',
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '__repro__', 'tests'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('.env.example', () => {
  it('names every environment variable the server code reads', () => {
    const documented = new Set(
      [
        ...fs
          .readFileSync(path.join(root, '.env.example'), 'utf8')
          .matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm),
      ].map((m) => m[1]),
    );
    const missing = new Set<string>();
    for (const dir of ['server', 'shared']) {
      for (const file of sourceFiles(path.join(root, dir))) {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/process\.env\.([A-Za-z][A-Za-z0-9_]*)/g)) {
          if (!documented.has(m[1]) && !NOT_DOCUMENTED.has(m[1])) missing.add(m[1]);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
