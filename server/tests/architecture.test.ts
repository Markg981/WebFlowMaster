import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORG_SCOPED_TABLES } from '@shared/schema';

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
    // Any import form, not just a braced one: a namespace import (`import * as dbmod from
    // '../db'`) and a dynamic `import('../db')` both reach privilegedDb, and an earlier
    // version of this rule matched only `import { ... } from '...db'` — verified by adding a
    // namespace import to a route file and watching the rule still pass.
    const reachesDbModule = /(?:from|import)\s*\(?\s*['"][^'"]*\/db['"]/;

    const offenders = routeFiles()
      .filter(({ source }) => reachesDbModule.test(source))
      .map(({ name }) => name);

    expect(offenders, `these route modules bypass RLS: ${offenders.join(', ')}`).toEqual([]);
  });

  /**
   * server/routes.ts is the legacy file of inline handlers, and it is deliberately outside
   * routeFiles() above: it still reaches privilegedDb on purpose for user_settings and
   * system_settings, neither of which is org-scoped and neither of which app_user is even
   * granted access to any more (migration 0006).
   *
   * That exemption must not become a hiding place. Every cross-tenant leak the final review
   * found lived in this file — five of them, all reading or deleting another tenant's rows
   * through an unscoped privilegedDb query, in the one file the rule above cannot see. So
   * rather than exempt the file wholesale, forbid the thing that actually went wrong: an
   * org-scoped table reached through the privileged handle.
   *
   * The check is textual and therefore approximate — it looks for a table's schema
   * identifier appearing in the same statement as `privilegedDb`. It will not catch a query
   * assembled across several statements, and it can be fooled. It is a tripwire for the
   * obvious mistake, which is the mistake that was actually made five times.
   */
  /**
   * The files that legitimately hold the privileged handle, each with a budget of how many
   * privileged statements may name an org-scoped table, and why.
   *
   * A budget rather than a ban because two of these genuinely need one: a queue worker and a
   * WebSocket message have no Express request, so `tenancyMiddleware` never ran and there is
   * no ambient organization to inherit. Something has to answer "which organization is this
   * for?" before the tenant context can be established, and that something cannot itself be
   * inside the context.
   *
   * A budget rather than nothing because "this file is allowed to bypass RLS" is how five
   * cross-tenant leaks lived in server/routes.ts unnoticed. Adding a privileged query here
   * now fails this test until someone raises the number deliberately and writes down why.
   */
  const PRIVILEGED_BOOTSTRAP_BUDGET: Record<string, { max: number; why: string }> = {
    'routes.ts': {
      max: 0,
      why: 'Every handler here is inside a request, so it always has an ambient organization.',
    },
    'websocket.ts': {
      max: 2,
      why:
        'emitExecutionLog resolves the parent execution\'s organization and then writes the log ' +
        'row. It is called from the runner, not from a socket message, so there is no ambient ' +
        'tenant to inherit. Subscription authorisation, which IS reachable from the wire, goes ' +
        'through runWithTenant + withTenantTransaction instead.',
    },
    'test-execution-service.ts': {
      max: 3,
      why:
        'Two tenant-context boundaries: runTestPlan reads the plan to learn its organization ' +
        'and stamps the execution row from it, and processTestPlanJob reads that execution row ' +
        'to establish the context the rest of the job runs in. Everything after either boundary ' +
        'is under withTenantTransaction.',
    },
  };

  // snake_case table name -> the camelCase identifier shared/schema.ts exports for it.
  const identifierFor = (table: string) =>
    table.replace(/_([a-z])/g, (_full, c: string) => c.toUpperCase());

  /** Counts statements that name both the privileged handle and an org-scoped table. */
  function privilegedOrgScopedStatements(source: string): string[] {
    // Comments first: these files explain at length why particular queries moved OFF
    // privilegedDb, and that prose names both the handle and the tables. Matching it would
    // report the explanation as the offence.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const found: string[] = [];

    // Statements, not lines: a drizzle query is routinely chained across many lines.
    for (const statement of code.split(';')) {
      if (!/\bprivilegedDb\b/.test(statement)) continue;
      if (/^\s*import\b/.test(statement)) continue;

      for (const table of ORG_SCOPED_TABLES) {
        const identifier = identifierFor(table);
        // Word-boundary match on the schema identifier as it is used in a query: `.from(x)`,
        // `.insert(x)`, `.update(x)`, `.delete(x)`, or a column reference `x.someColumn`.
        // Table objects are sometimes imported under an alias (testPlanExecutionsTable), so
        // match the identifier as a prefix of a longer one too.
        if (new RegExp(`\\b${identifier}(Table)?\\b`).test(statement)) {
          found.push(identifier);
          break;
        }
      }
    }

    return found;
  }

  it.each(Object.entries(PRIVILEGED_BOOTSTRAP_BUDGET))(
    'server/%s stays within its privileged-bootstrap budget',
    (file, { max, why }) => {
      const source = fs.readFileSync(path.join(serverDir, file), 'utf8');
      const found = privilegedOrgScopedStatements(source);

      expect(
        found.length,
        `server/${file} has ${found.length} privileged statements naming an org-scoped table ` +
          `(${found.join(', ')}), budget is ${max}. ${why} If a new one is genuinely a tenant-context ` +
          'boundary, raise the budget here and say why; otherwise move it under withTenantTransaction.',
      ).toBeLessThanOrEqual(max);
    },
  );

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
