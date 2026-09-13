import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORG_SCOPED_TABLES } from '@shared/schema';
import { CLIENT_BUILD_DIRNAME } from '../static';

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

  /**
   * The requireRole rule above governs only server/routes/*.routes.ts, and only mutating
   * routes. server/routes.ts was outside it entirely, which left sixteen live handlers with no
   * role check at all — a viewer could delete API-test history, drive a browser, or proxy an
   * arbitrary outbound request.
   *
   * Every route in this file is checked, reads included. A read is not automatically harmless:
   * GET /api/selectable-tests enumerates an organization's tests, and the audit trail is
   * owner-only precisely because reading who-did-what is a privilege. Deciding a role for a new
   * handler is a two-second judgement; forgetting to decide one is how this happened.
   */
  it('every route in server/routes.ts declares a required role', () => {
    const source = fs.readFileSync(path.join(serverDir, 'routes.ts'), 'utf8');
    const lines = source.split('\n');
    const offenders: string[] = [];

    lines.forEach((line, index) => {
      const match = /app\.(get|post|put|patch|delete)\("(\/api\/[^"]*)"/.exec(line);
      if (!match) return;
      // The handler chain can wrap onto following lines; look at a small window.
      const window = lines.slice(index, index + 4).join(' ');
      if (!window.includes('requireRole')) {
        offenders.push(`${match[1].toUpperCase()} ${match[2]} (line ${index + 1})`);
      }
    });

    expect(offenders, `routes with no requireRole: ${offenders.join(', ')}`).toEqual([]);
  });

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

// ─── Deployment and asset invariants ────────────────────────────────────────────
//
// Two defects the audit found were not logic errors but broken references that nothing
// checked: docker-compose built a service from a Dockerfile that did not exist, and the
// login page pulled a decorative texture from a public CDN. Both are the kind of thing a
// reader's eye slides over and a test catches for free.

const repoRoot = path.resolve(serverDir, '..');

describe('docker-compose references files that exist', () => {
  it('every service that builds names a Dockerfile present in the repository', () => {
    const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');

    // Deliberately a text scan rather than a YAML parse: the point is to notice a
    // dangling filename, and adding a YAML dependency to assert one would be a poor trade.
    const named = [...compose.matchAll(/dockerfile:\s*(\S+)/g)].map((m) => m[1]);
    // A `build:` stanza with a context and no `dockerfile:` key means ./Dockerfile.
    const buildBlocks = compose.match(/build:/g)?.length ?? 0;
    const implicit = buildBlocks > named.length ? ['Dockerfile'] : [];

    const missing = [...named, ...implicit].filter(
      (f) => !fs.existsSync(path.join(repoRoot, f)),
    );

    expect(missing).toEqual([]);
  });
});

describe('the client does not depend on third-party asset hosts', () => {
  it('loads no image, font or stylesheet from an external origin', () => {
    const clientSrc = path.join(repoRoot, 'client', 'src');

    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
      });

    // An asset behind a corporate proxy or an air-gapped network is a 404, and a decorative
    // one fails silently — which is how a texture from grainy-gradients.vercel.app sat on
    // the login page of an enterprise tool. Anything the page needs is served by the app.
    const offenders: string[] = [];
    for (const file of walk(clientSrc)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/url\(\s*['"]?(https?:\/\/[^'")\s]+)/g)) {
        offenders.push(`${path.relative(repoRoot, file)}: ${match[1]}`);
      }
      for (const match of source.matchAll(/<(?:img|link)[^>]+(?:src|href)=["'](https?:\/\/[^"']+)/g)) {
        offenders.push(`${path.relative(repoRoot, file)}: ${match[1]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ─── The production entry point ─────────────────────────────────────────────
//
// Both of these were found by running the built image for the first time. Neither is
// reachable from the dev server, the test suite or a type check, which is why the container
// crashed on its first start with an error about a missing package.

describe('the production bundle only needs production dependencies', () => {
  it('server/index.ts does not statically import the vite module', () => {
    const source = fs.readFileSync(path.join(serverDir, 'index.ts'), 'utf8');

    // `import … from "./vite"` is evaluated when dist/index.js loads, whatever branch later
    // decides to call setupVite. server/vite.ts imports vite itself, and vite is a dev
    // dependency that `npm prune --omit=dev` removes — so the built image died with
    // "Cannot find package 'vite'" before reaching a single line of its own code.
    const staticViteImport = /^\s*import\s[^;]*from\s+["']\.\/vite["']/m;
    expect(staticViteImport.test(source)).toBe(false);

    // It must still be reachable in development, just not at load time.
    expect(/import\(["']\.\/vite["']\)/.test(source)).toBe(true);
  });
});

describe('the server serves the client from where the client is built', () => {
  it('the static path and the client build output are the same directory', () => {
    const viteConfig = fs.readFileSync(path.join(repoRoot, 'client', 'vite.config.ts'), 'utf8');
    const staticModule = fs.readFileSync(path.join(serverDir, 'static.ts'), 'utf8');

    // These two are set in different files, by different people, at different times. When
    // they drifted the symptom was a container that started and then answered every page
    // request with "Could not find the build directory" — with the build sitting happily in
    // another folder. Naming the same constant in both is what keeps them together.
    const outDir = viteConfig.match(/outDir:\s*[^'"]*['"]([^'"]+)['"]/)?.[1];
    expect(outDir).toBeTruthy();
    expect(outDir).toContain('dist/public');
    expect(staticModule).toContain(CLIENT_BUILD_DIRNAME);
  });
});

describe('the browser image matches the browser library', () => {
  it('every Playwright base image is tagged with the version the lockfile resolves', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
    const resolved = lock.packages?.['node_modules/playwright']?.version;
    expect(resolved).toBeTruthy();

    const dockerfiles = fs
      .readdirSync(repoRoot)
      .filter((f) => f === 'Dockerfile' || f.startsWith('Dockerfile.'));
    expect(dockerfiles.length).toBeGreaterThan(0);

    // The image ships browsers built for one version of the library, and Playwright refuses
    // to launch a mismatched pair — with a message telling you to update the image, which
    // nobody sees until a container tries to run a test. `playwright` is declared with a
    // caret, so the resolved version moves on its own while the tag does not: a routine
    // dependency bump silently breaks every browser-driven run in production and nothing
    // here notices. This is that notice.
    for (const file of dockerfiles) {
      const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      const tag = source.match(/FROM\s+mcr\.microsoft\.com\/playwright:v([\d.]+)/)?.[1];
      if (!tag) continue; // a Dockerfile not based on the Playwright image has nothing to match
      expect({ file, tag }).toEqual({ file, tag: resolved });
    }
  });
});


describe('the lockfile can be installed somewhere other than the machine that wrote it', () => {
  it('defines every dependency it names, for every platform', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
    const packages: Record<string, any> = lock.packages;

    // How `require` finds a package: walk up the node_modules folders from the dependent.
    const resolveFrom = (dependent: string, name: string): string | null => {
      let base = dependent;
      for (;;) {
        const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
        if (candidate in packages) return candidate;
        if (!base) return null;
        const nested = base.lastIndexOf('/node_modules/');
        if (nested >= 0) base = base.slice(0, nested);
        else if (base.startsWith('node_modules/')) base = '';
        else return null;
      }
    };

    // `npm ci` refuses, with EUSAGE, to install a lockfile that names a dependency it does
    // not define — and it counts dependencies this machine will never install: the binaries
    // for other platforms, and the peers of those binaries. That is the whole point of
    // recording them. The lockfile is written on a developer's Windows machine and installed
    // in a Linux image, so the entries that decide whether production builds at all are
    // exactly the ones no local install ever needs, and no local command ever exercises.
    //
    // Both halves have already broken this build. `lightningcss` was missing its ten
    // platform binaries, and `@napi-rs/wasm-runtime` was missing the three `@emnapi`
    // packages it declares as ordinary peers — each stopped `docker compose build` at
    // `npm ci` with a list of names and no explanation of where they had gone.
    //
    // Where they had gone: npm on Windows drops them. Regenerating the lockfile here does
    // not repair it and makes it worse — it also discards the ~200 esbuild and rollup
    // binaries for other platforms, moving the same failure onto every machine that is not
    // this one. The repair is to regenerate inside the Linux image, which records the whole
    // matrix, and then commit that file:
    //
    //   docker run --rm -v "$PWD:/src:ro" -v "$PWD/out:/out" \
    //     mcr.microsoft.com/playwright:v<version> sh -c \
    //     'mkdir -p /app/client && cp /src/package.json /src/package-lock.json /app/ \
    //      && cp /src/client/package.json /app/client/ && cd /app \
    //      && npm install --package-lock-only && cp package-lock.json /out/'
    const missing: string[] = [];
    for (const [dependent, meta] of Object.entries(packages)) {
      const required = {
        ...(meta.optionalDependencies ?? {}),
        // Optional peers are genuinely optional; the rest npm insists on.
        ...Object.fromEntries(
          Object.entries(meta.peerDependencies ?? {}).filter(
            ([name]) => !meta.peerDependenciesMeta?.[name]?.optional,
          ),
        ),
      };
      for (const [name, range] of Object.entries(required)) {
        if (!resolveFrom(dependent, name)) {
          missing.push(`${dependent || '(root)'} needs ${name}@${range}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe('the suite that needs a browser can get one', () => {
  it('CI installs the browsers before running the tests that launch them', () => {
    const workflowDir = path.join(repoRoot, '.github', 'workflows');
    const workflows = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    expect(workflows.length).toBeGreaterThan(0);

    // `npm ci` does not bring the browsers down — the `playwright` package carries no
    // install script in this lockfile — so a job that runs the suite without an explicit
    // install fails every browser-driven test with "Executable doesn't exist at
    // ~/.cache/ms-playwright/…". That is what this workflow did from the day it was written:
    // for months the only such file was recorder-script.test.ts, whose six tests reported as
    // skipped and were easy to read past. Once element detection, the step executor, saved
    // login states and frames each grew a real-browser suite it became 28 failures at once.
    //
    // This is about the suites that prove the product's whole purpose. Left unrun they are
    // worse than absent, because the workflow is green beside them.
    const offenders: string[] = [];
    for (const file of workflows) {
      const source = fs.readFileSync(path.join(workflowDir, file), 'utf8');
      // Anywhere in the command, not anchored to the start of it: the step is wrapped in
      // `xvfb-run -a` so the one headed suite has a display. An anchored match would have
      // stopped recognising the step the moment that wrapper was added, and this whole
      // check would have gone quietly vacuous — which is the failure it exists to prevent.
      const runsTheSuite = /run:.*\bnpm test\b/.test(source);
      if (!runsTheSuite) continue;

      const installsBrowsers = /playwright install/.test(source);
      if (!installsBrowsers) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
