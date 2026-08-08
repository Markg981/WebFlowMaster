import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Governs every file directly under server/routes/ named *.routes.ts — the Express router
 * modules mounted by server/routes.ts's registerRoutes. It does not reach server/routes.ts
 * itself (the legacy inline app.get/post/put/delete handlers there are a separate, known
 * migration gap — see the Task 6 report) or any subdirectory added later for a different
 * purpose. Adding a new *.routes.ts file here means it is automatically covered by both
 * checks below; adding a new top-level directory of route-like files does not extend either
 * check to it, and whoever does that should decide deliberately whether it needs the same
 * two rules and wire up a matching test if so.
 */
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routesDir = path.join(serverDir, 'routes');

const routeFiles = () =>
  fs
    .readdirSync(routesDir)
    .filter((f) => f.endsWith('.routes.ts'))
    .map((f) => ({ name: f, source: fs.readFileSync(path.join(routesDir, f), 'utf8') }));

describe('route modules cannot query outside the tenant context', () => {
  /**
   * privilegedDb bypasses RLS. A route importing it — or the deprecated `db` alias — runs as
   * superuser and sees every organization's rows, which is exactly the failure this whole
   * feature exists to prevent. Verifying the shape of the code is the only check that holds
   * as new routes are added by people who have not read this design.
   *
   * No exclusions: every file in routeFiles() is checked, including ones with no tenant data
   * of their own (see the second test below for why that distinction matters there but not
   * here) — a route file has no legitimate reason to ever reach the superuser handle, so
   * there is nothing to carve out.
   */
  it('no route module imports the privileged database handle', () => {
    const offenders = routeFiles()
      .filter(({ source }) => /import\s*\{[^}]*\b(db|privilegedDb)\b[^}]*\}\s*from\s*['"][^'"]*db['"]/.test(source))
      .map(({ name }) => name);

    expect(offenders, `these route modules bypass RLS: ${offenders.join(', ')}`).toEqual([]);
  });

  /**
   * Scoped to route files that can reach the database at all, not to every mutating route in
   * server/routes/ indiscriminately. "Reaches the database" is checked as "imports a table or
   * schema type from @shared/schema", because in this codebase every query starts from a
   * table object defined there — a file with no such import has no query for a role check to
   * protect in the first place.
   *
   * This is what keeps server/routes/observability.routes.ts out of the rule without naming
   * it: it imports only Zod schemas from @shared/observability, never anything from
   * @shared/schema, so it never reaches an org-scoped table. Its two mutating endpoints
   * (POST /api/client-logs, POST /api/incidents) write crash/log data to disk, and are
   * deliberately reachable while unauthenticated outside production so a broken login page
   * can still report what happened — see allowAnonymousOutsideProduction in that file and
   * the "accepts anonymous requests outside production" case in
   * observability.routes.test.ts. Gating them with requireRole would 401 exactly the request
   * that test exists to let through. If observability.routes.ts (or any future route file)
   * ever starts importing @shared/schema, it falls under this rule automatically, like every
   * other file — the exemption is the absence of that import, not the filename.
   */
  it('every mutating route in a route file that reaches the database declares a required role', () => {
    const offenders: string[] = [];

    for (const { name, source } of routeFiles()) {
      const reachesDatabase = /from\s*['"]@shared\/schema['"]/.test(source);
      if (!reachesDatabase) continue;

      const lines = source.split('\n');
      lines.forEach((line, index) => {
        const isMutating = /router\.(post|put|patch|delete)\s*\(/.test(line);
        if (!isMutating) return;
        // The handler chain may wrap onto following lines; look at a small window.
        const window = lines.slice(index, index + 4).join(' ');
        if (!window.includes('requireRole')) {
          offenders.push(`${name}:${index + 1}`);
        }
      });
    }

    expect(offenders, `mutating routes with no requireRole: ${offenders.join(', ')}`).toEqual([]);
  });
});
