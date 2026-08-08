import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import request from 'supertest';
import { WebSocket } from 'ws';
import { inArray } from 'drizzle-orm';
import { privilegedDb } from './db';
import { organizations, testPlans, testPlanExecutions, executionLogs, users } from '@shared/schema';

vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * setupWebSockets creates a real BullMQ QueueEvents (and, transitively via ./queue, a real
 * BullMQ Queue) backed by Redis. No Redis runs in this test environment, so both are replaced
 * with inert stubs. None of the cases below depend on BullMQ lifecycle events firing — they
 * drive emitExecutionLog directly, the same entry point test-execution-service uses to push a
 * log line, which is what actually matters for the auth/authorization/scoping being tested.
 */
vi.mock('bullmq', () => {
  class FakeQueue {
    on() { return this; }
  }
  class FakeQueueEvents {
    on() { return this; }
  }
  class FakeJob {
    static fromId = vi.fn().mockResolvedValue(undefined);
  }
  return { Queue: FakeQueue, QueueEvents: FakeQueueEvents, Job: FakeJob };
});

import { setupAuth } from './auth';
import { setupWebSockets, type WsEmitter } from './websocket';

/**
 * Drives the real setupAuth + setupWebSockets wiring against a real http.Server and real `ws`
 * clients — the only honest way to prove an upgrade is actually rejected at the handshake
 * rather than accepted and policed later. Two registered users, each in their own
 * organization (registration mints one per user — see auth.test.ts), stand in for "org A" and
 * "org B"; a test_plan_executions row is seeded for each so subscribe-execution has something
 * real to authorize against.
 */

let app: Express;
let httpServer: http.Server;
let baseWsUrl: string;
let emitter: WsEmitter;
const openSockets: WebSocket[] = [];

let orgAId: number;
let orgBId: number;
let cookieA: string;
let cookieB: string;
const execAId = 'ws-auth-test-exec-a';
const execBId = 'ws-auth-test-exec-b';
const planAId = 'ws-auth-test-plan-a';
const planBId = 'ws-auth-test-plan-b';

function toCookieHeader(setCookie: string[] | undefined): string {
  if (!setCookie || setCookie.length === 0) {
    throw new Error('Expected a Set-Cookie header on the registration response');
  }
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

function connectWs(cookie?: string): WebSocket {
  const ws = new WebSocket(baseWsUrl, cookie ? { headers: { Cookie: cookie } } : undefined);
  openSockets.push(ws);
  return ws;
}

function waitForOpen(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for open')), timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`unexpected response: ${res.statusCode}`));
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a matching message')), timeoutMs);
    const handler = (raw: any) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  setupAuth(app);

  const regA = await request(app)
    .post('/api/register')
    .send({ username: 'ws-auth-org-a-user', password: 'password123' })
    .expect(201);
  orgAId = regA.body.organizationId;
  cookieA = toCookieHeader(regA.headers['set-cookie']);

  const regB = await request(app)
    .post('/api/register')
    .send({ username: 'ws-auth-org-b-user', password: 'password123' })
    .expect(201);
  orgBId = regB.body.organizationId;
  cookieB = toCookieHeader(regB.headers['set-cookie']);

  await privilegedDb.insert(testPlans).values([
    { id: planAId, name: 'WS auth plan A', userId: regA.body.id, organizationId: orgAId },
    { id: planBId, name: 'WS auth plan B', userId: regB.body.id, organizationId: orgBId },
  ]);
  await privilegedDb.insert(testPlanExecutions).values([
    { id: execAId, testPlanId: planAId, organizationId: orgAId },
    { id: execBId, testPlanId: planBId, organizationId: orgBId },
  ]);

  httpServer = http.createServer(app);
  emitter = await setupWebSockets(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = (httpServer.address() as AddressInfo).port;
  baseWsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  for (const ws of openSockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  }
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  await privilegedDb.delete(executionLogs).where(inArray(executionLogs.testPlanExecutionId, [execAId, execBId]));
  await privilegedDb.delete(testPlanExecutions).where(inArray(testPlanExecutions.id, [execAId, execBId]));
  await privilegedDb.delete(testPlans).where(inArray(testPlans.id, [planAId, planBId]));
  await privilegedDb.delete(users).where(inArray(users.organizationId, [orgAId, orgBId]));
  await privilegedDb.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
});

describe('WebSocket upgrade authentication', () => {
  it('rejects an unauthenticated upgrade before the handshake completes', async () => {
    const ws = connectWs(); // no session cookie
    let opened = false;
    ws.once('open', () => {
      opened = true;
    });

    await expect(waitForOpen(ws)).rejects.toThrow();
    expect(opened).toBe(false);
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it('accepts an authenticated upgrade', async () => {
    const ws = connectWs(cookieA);
    await expect(waitForOpen(ws)).resolves.toBeUndefined();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('subscribe-execution authorization', () => {
  it("refuses to subscribe an authenticated socket to another organization's execution", async () => {
    const ws = connectWs(cookieA);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ type: 'subscribe-execution', executionId: execBId }));
    const reply = await waitForMessage(ws, (m) => m.executionId === execBId);

    expect(reply.type).toBe('subscribe-error');
  });

  it('subscribes an authenticated socket to its own execution', async () => {
    const ws = connectWs(cookieA);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ type: 'subscribe-execution', executionId: execAId }));
    const reply = await waitForMessage(ws, (m) => m.executionId === execAId);

    expect(reply.type).toBe('subscribed');
  });
});

describe('execution log delivery', () => {
  it('delivers a log line to a socket subscribed to its own execution', async () => {
    const ws = connectWs(cookieA);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'subscribe-execution', executionId: execAId }));
    await waitForMessage(ws, (m) => m.type === 'subscribed' && m.executionId === execAId);

    const received = waitForMessage(ws, (m) => m.type === 'execution-log' && m.executionId === execAId);
    emitter.emitExecutionLog(execAId, {
      level: 'info',
      source: 'system',
      message: 'hello from organization A',
      timestamp: new Date().toISOString(),
    });

    const msg = await received;
    expect(msg.message).toBe('hello from organization A');
  });

  it("does not deliver organization A's log lines to organization B's socket", async () => {
    const wsB = connectWs(cookieB);
    await waitForOpen(wsB);
    wsB.send(JSON.stringify({ type: 'subscribe-execution', executionId: execBId }));
    await waitForMessage(wsB, (m) => m.type === 'subscribed' && m.executionId === execBId);

    let leaked: any = null;
    wsB.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.executionId === execAId) leaked = msg;
    });

    emitter.emitExecutionLog(execAId, {
      level: 'info',
      source: 'system',
      message: "organization A's secret log line",
      timestamp: new Date().toISOString(),
    });

    // Give a real (undesired) delivery a chance to arrive before asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(leaked).toBeNull();
  });
});
