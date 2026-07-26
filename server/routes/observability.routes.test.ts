import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { configureIncidents } from '../observability/incident';
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
let app: express.Application;
let authenticated = true;

beforeEach(async () => {
  logged.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-ingest-'));
  configureIncidents({ rootDir: root, logger: { error: () => {} } });

  app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = authenticated ? { id: 7 } : undefined;
    req.isAuthenticated = (() => authenticated) as never;
    next();
  });
  const { default: router } = await import('./observability.routes');
  app.use(router);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
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
