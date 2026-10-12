import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `.env.example` is where an operator looks first, and the configuration reference is where
 * every variable is explained. Variables kept appearing in the second without the first — a
 * dozen, at the last count — so this holds the two together: a variable the reference
 * documents is in the example file, commented out with its default, or named below with the
 * reason it is not.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Documented, and deliberately absent from .env.example. */
const NOT_IN_ENV_EXAMPLE: Record<string, string> = {
  // Nothing: every documented variable is listed. Add one here only with a reason, e.g.
  // SOME_VAR: 'set by the Compose file, never by an operator',
};

/** The variables the reference documents: every code span in the first cell of a table row. */
function documentedVariables(): string[] {
  const reference = fs.readFileSync(path.join(root, 'docs/en/admin/configuration.md'), 'utf8');
  const names = new Set<string>();
  for (const line of reference.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const firstCell = line.slice(1).split('|')[0];
    for (const match of firstCell.matchAll(/`([A-Z][A-Z0-9_]*)`/g)) names.add(match[1]);
  }
  return [...names].sort();
}

/** The variables .env.example names, set or commented out. */
function exampleVariables(): Set<string> {
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const names = new Set<string>();
  for (const line of example.split('\n')) {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

describe('.env.example', () => {
  it('names every variable the configuration reference documents', () => {
    const documented = documentedVariables();
    // Guards the guard: a parser that recognises nothing would pass the rule below vacuously.
    expect(documented.length).toBeGreaterThan(50);

    const example = exampleVariables();
    const missing = documented.filter(
      (name) => !example.has(name) && !(name in NOT_IN_ENV_EXAMPLE),
    );
    expect(
      missing,
      `documented in docs/en/admin/configuration.md but not in .env.example: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('keeps the allowlist to variables that are actually documented', () => {
    const documented = new Set(documentedVariables());
    const stale = Object.keys(NOT_IN_ENV_EXAMPLE).filter((name) => !documented.has(name));
    expect(stale, `allowlisted but no longer documented: ${stale.join(', ')}`).toEqual([]);
  });
});
