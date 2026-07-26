import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { incidentErrorHandler, buildServerApiTrigger } from './express';
import { configureIncidents } from '../incident';
import { IncidentStore } from '../store';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-tap-'));
  configureIncidents({ rootDir: root, logger: { error: () => {} } });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const appThatThrows = () => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = { id: 42 };
    next();
  });
  app.post('/api/boom', () => {
    throw new TypeError('Cannot read properties of undefined (reading \'selector\')');
  });
  app.use(incidentErrorHandler({ error: () => {} }));
  return app;
};

describe('incidentErrorHandler', () => {
  it('records an incident and still answers the request', async () => {
    const response = await request(appThatThrows()).post('/api/boom').send({ url: 'https://x.test' });

    // Asserted here, before anything waits on the recording below, because this is what
    // proves the handler answers without waiting on disk I/O — the whole point of the
    // fire-and-forget `void recordIncident(...)` in the tap.
    expect(response.status).toBe(500);

    // The tap records asynchronously on purpose, so the test polls for the artifact to
    // land instead of assuming it already exists the instant the HTTP response completes.
    await vi.waitFor(async () => {
      const index = await new IncidentStore(root).readIndex();
      expect(index).toHaveLength(1);
      expect(index[0].kind).toBe('server-api');
    }, { timeout: 2000 });
  });

  it('captures the request as the trigger', async () => {
    await request(appThatThrows()).post('/api/boom?debug=1').send({ url: 'https://x.test' });

    // Same reason as above: the recording is async, so poll for it rather than assume it
    // has landed by the time the HTTP response has been received.
    const store = new IncidentStore(root);
    await vi.waitFor(async () => {
      const [entry] = await store.readIndex();
      const incident = await store.read(entry.id);

      expect(incident!.trigger).toMatchObject({
        method: 'POST',
        path: '/api/boom',
        query: { debug: '1' },
        body: { url: 'https://x.test' },
        userId: 42,
      });
    }, { timeout: 2000 });
  });

  it('still responds when recording the incident fails', async () => {
    configureIncidents({ rootDir: path.join(root, 'nope\0bad') });

    const response = await request(appThatThrows()).post('/api/boom').send({});

    expect(response.status).toBe(500);
  });
});

describe('buildServerApiTrigger', () => {
  it('keeps only allowlisted headers', () => {
    const req = {
      method: 'GET',
      path: '/api/x',
      query: {},
      body: undefined,
      headers: { 'content-type': 'application/json', cookie: 'session=abc', 'x-correlation-id': 'c-1' },
    } as unknown as Request;

    const trigger = buildServerApiTrigger(req);

    expect(trigger.headers).toEqual({ 'content-type': 'application/json', 'x-correlation-id': 'c-1' });
  });
});
