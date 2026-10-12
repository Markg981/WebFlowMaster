import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_DOMAINS, NOT_IN_A_DOMAIN, domainOf } from '../../scripts/server-domains.mjs';

/**
 * scripts/server-domains.mjs is the table `npm run deps:check` builds its import rules from. A
 * module the table does not name is under no rule at all, so a new file would slip past the check
 * without anyone deciding where it belongs; and an entry for a file that was moved or deleted
 * would keep a rule alive for nothing.
 */
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function serverModules(dir = serverDir, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) serverModules(full, out);
    else if (entry.name.endsWith('.ts')) {
      const rel = path.relative(serverDir, full).replace(/\\/g, '/');
      if (!NOT_IN_A_DOMAIN.test(rel)) out.push(rel);
    }
  }
  return out;
}

describe('server domains', () => {
  it('puts every server module in a domain', () => {
    const missing = serverModules().filter((m) => domainOf(m) === null);
    expect(missing, `add these to a domain in scripts/server-domains.mjs`).toEqual([]);
  });

  it('names only modules and directories that exist', () => {
    const stale = SERVER_DOMAINS.flatMap((d) => d.modules).filter((m) =>
      m.endsWith('/*')
        ? !fs.existsSync(path.join(serverDir, m.slice(0, -2)))
        : !fs.existsSync(path.join(serverDir, `${m}.ts`)),
    );
    expect(stale).toEqual([]);
  });

  it('names each module once', () => {
    const all = SERVER_DOMAINS.flatMap((d) => d.modules);
    expect(all.filter((m, i) => all.indexOf(m) !== i)).toEqual([]);
  });

  it('gives each domain a distinct name and a rank', () => {
    const names = SERVER_DOMAINS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const d of SERVER_DOMAINS) expect(Number.isInteger(d.rank)).toBe(true);
  });

  it('lets an exact entry win over a directory', () => {
    expect(domainOf('middleware/tenancy.ts')).toBe('platform');
    expect(domainOf('middleware/csrf.ts')).toBe('http');
    expect(domainOf('observability/taps/express.ts')).toBe('http');
    expect(domainOf('observability/metrics.ts')).toBe('platform');
  });
});
