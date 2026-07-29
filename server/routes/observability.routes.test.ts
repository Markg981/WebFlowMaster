import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
// configureIncidents is imported dynamically inside beforeEach, not here — see the comment
// there. IncidentStore is safe to import statically: it holds no module-level state, taking
// its root directory as a constructor argument.
import { IncidentStore } from '../observability/store';

const logged: { level: string; message: string; meta: Record<string, unknown> }[] = [];

vi.mock('../logger', () => {
  const record = (level: string) => (message: string, meta: Record<string, unknown> = {}) =>
    logged.push({ level, message, meta });
  return {
    default: Promise.resolve({
      error: record('error'), warn: record('warn'), info: record('info'),
      http: record('http'), debug: record('debug'), verbose: record('verbose'),
      log: (level: string, message: string, meta: Record<string, unknown> = {}) =>
        logged.push({ level, message, meta }),
    }),
    updateLogLevel: vi.fn(),
  };
});

let root: string;
// generateRepro writes under repoRoot, not rootDir. Without its own temp directory
// these tests would scatter .repro.ts files across the real working tree.
let reproRoot: string;
let app: express.Application;
let authenticated = true;

beforeEach(async () => {
  logged.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-ingest-'));
  reproRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-reporoot-'));

  app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = authenticated ? { id: 7 } : undefined;
    req.isAuthenticated = (() => authenticated) as never;
    next();
  });

  const { default: router } = await import('./observability.routes');
  // Configure the SAME incident module the router just bound to, not the statically
  // imported one. The production-auth test below calls vi.resetModules(), so after it runs
  // this dynamic import yields a fresh module graph; a statically imported
  // configureIncidents would point at the stale instance and the route would write
  // incidents into the real .observability/ instead of this test's temp directory.
  const { configureIncidents } = await import('../observability/incident');
  configureIncidents({ rootDir: root, repoRoot: reproRoot, logger: { error: () => {} } });

  app.use(router);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(reproRoot, { recursive: true, force: true });
  authenticated = true;
});

describe('POST /api/client-logs', () => {
  it('re-emits each entry through the server logger', async () => {
    const response = await request(app).post('/api/client-logs').send({
      sessionId: 's-1',
      entries: [
        { level: 'info', message: 'navigation', clientTs: '2026-07-26T10:00:00.000Z', correlationId: 'c-1', meta: { to: '/dashboard' } },
        { level: 'error', message: 'mutation failed', clientTs: '2026-07-26T10:00:01.000Z', correlationId: 'c-1' },
      ],
    });

    expect(response.status).toBe(202);
    expect(logged.filter((l) => l.message.startsWith('[client]'))).toHaveLength(2);
    expect(logged[0].meta).toMatchObject({ sessionId: 's-1', correlationId: 'c-1', source: 'client' });
  });

  it('reports dropped entries so loss is visible', async () => {
    await request(app).post('/api/client-logs').send({
      sessionId: 's-1',
      dropped: 12,
      entries: [{ level: 'warn', message: 'x', clientTs: '2026-07-26T10:00:00.000Z' }],
    });

    expect(logged.some((l) => l.message.includes('dropped 12'))).toBe(true);
  });

  it('rejects a malformed batch', async () => {
    const response = await request(app).post('/api/client-logs').send({ sessionId: 's-1', entries: [] });
    expect(response.status).toBe(400);
  });

  it('rejects an oversized batch', async () => {
    const entries = Array.from({ length: 101 }, () => ({
      level: 'info' as const, message: 'x', clientTs: '2026-07-26T10:00:00.000Z',
    }));
    const response = await request(app).post('/api/client-logs').send({ sessionId: 's-1', entries });
    expect(response.status).toBe(400);
  });

  it('accepts anonymous requests outside production so the login page is not blind', async () => {
    authenticated = false;
    const response = await request(app).post('/api/client-logs').send({
      sessionId: 's-1',
      entries: [{ level: 'error', message: 'login blew up', clientTs: '2026-07-26T10:00:00.000Z' }],
    });

    expect(response.status).toBe(202);
  });
});

describe('production auth enforcement', () => {
  // isProduction in observability.routes.ts is a module-level constant read once at import
  // time, so exercising it for real (rather than trusting the `authenticated` flag alone,
  // which the existing "outside production" test already covers) requires setting
  // NODE_ENV *before* the module is evaluated and forcing that evaluation with
  // vi.resetModules() + a fresh dynamic import. Without this, the production branch is
  // never actually reached by any test — someone could invert or delete the check in
  // allowAnonymousOutsideProduction and every existing test would still pass.
  it('rejects unauthenticated requests and accepts authenticated ones', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetModules();

    try {
      const { default: prodRouter } = await import('./observability.routes');
      const prodApp = express();
      prodApp.use(express.json());
      prodApp.use((req: Request, _res: Response, next: NextFunction) => {
        (req as Request & { user?: unknown }).user = authenticated ? { id: 7 } : undefined;
        req.isAuthenticated = (() => authenticated) as never;
        next();
      });
      prodApp.use(prodRouter);

      authenticated = false;
      const unauthResponse = await request(prodApp).post('/api/client-logs').send({
        sessionId: 's-1',
        entries: [{ level: 'info', message: 'x', clientTs: '2026-07-26T10:00:00.000Z' }],
      });
      expect(unauthResponse.status).toBe(401);

      authenticated = true;
      const authResponse = await request(prodApp).post('/api/client-logs').send({
        sessionId: 's-1',
        entries: [{ level: 'info', message: 'x', clientTs: '2026-07-26T10:00:00.000Z' }],
      });
      expect(authResponse.status).toBe(202);
    } finally {
      // Restore the env and drop the production-evaluated module from the cache so later
      // tests' beforeEach import re-evaluates isProduction against the real test env.
      process.env.NODE_ENV = originalNodeEnv;
      vi.resetModules();
    }
  });
});

describe('POST /api/incidents', () => {
  it('records a client-runtime incident carrying the component stack', async () => {
    const response = await request(app).post('/api/incidents').send({
      sessionId: 's-1',
      correlationId: 'c-9',
      route: '/dashboard/create-test',
      name: 'TypeError',
      message: 'Cannot read properties of undefined (reading \'map\')',
      stack: 'TypeError: Cannot read properties of undefined\n    at Toaster (/src/components/ui/toaster.tsx:16:15)',
      componentStack: '\n    at Toaster\n    at App',
      breadcrumbs: [{ type: 'click', target: '#execute' }],
    });

    expect(response.status).toBe(202);
    expect(response.body.incidentId).toMatch(/^inc_/);

    const store = new IncidentStore(root);
    const incident = await store.read(response.body.incidentId);
    expect(incident!.kind).toBe('client-runtime');
    expect(incident!.trigger).toMatchObject({ route: '/dashboard/create-test' });
    expect(incident!.breadcrumbs).toEqual([{ type: 'click', target: '#execute' }]);
  });

  it('rejects a malformed report', async () => {
    const response = await request(app).post('/api/incidents').send({ sessionId: 's-1' });
    expect(response.status).toBe(400);
  });
});
