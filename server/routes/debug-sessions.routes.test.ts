import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { DebugState } from '@shared/debug-session';
import { debugChannel } from '../debug-session';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

const tasks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../browser-tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../browser-tasks')>()),
  browserTasks: { run: vi.fn(), start: tasks.start },
}));

/**
 * Starting a debug session, reading it and sending it commands: a session is its owner's alone,
 * one at a time, and a command that does not fit the moment is refused before it reaches the
 * browser.
 */

let app: express.Express;
let currentUser: { id: number; username: string; organizationId: number; role: string };

const body = {
  name: 'Checkout',
  url: 'https://shop.test',
  elements: [],
  breakpoints: ['s2'],
  sequence: [{ id: 's1', action: { id: 'navigate', type: 'navigate', name: 'Open', icon: 'x', description: 'x' }, value: 'https://shop.test/cart' }],
};

beforeAll(async () => {
  const { default: routes } = await import('./debug-sessions.routes');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    next();
  });
  app.use(routes);
});

beforeEach(() => {
  tasks.start.mockReset();
  tasks.start.mockResolvedValue(undefined);
  currentUser = { id: 101, username: 'dev', organizationId: 7, role: 'editor' };
});

async function setState(id: string, patch: Partial<DebugState>) {
  const channel = await debugChannel();
  const state = (await channel.read(id))!;
  await channel.publish(id, { ...state, ...patch });
}

describe('debug sessions', () => {
  it('ends an initialized session when execution admission is refused', async () => {
    const { QuotaError } = await import('../tenant-quotas');
    tasks.start.mockRejectedValue(new QuotaError('execution_quota_exceeded', 'execution_minutes', 1, 1));
    const res = await request(app).post('/api/debug-sessions').send(body);
    expect(res.status).toBe(429);
    const channel = await debugChannel();
    expect(await channel.activeFor(currentUser.id)).toBeNull();
    const id = tasks.start.mock.calls[0][0].task.sessionId;
    expect(await channel.read(id)).toMatchObject({ status: 'finished', outcome: { success: false } });
  });
  it('start the run in the background with its breakpoints, and answer at once', async () => {
    const res = await request(app).post('/api/debug-sessions').send(body);

    expect(res.status).toBe(201);
    expect(res.body.state).toMatchObject({ status: 'starting', breakpoints: ['s2'] });
    expect(tasks.start).toHaveBeenCalledWith(expect.objectContaining({
      userId: 101,
      organizationId: 7,
      task: expect.objectContaining({ kind: 'debug-sequence', sessionId: res.body.id, breakpoints: ['s2'] }),
    }));
    // The organization is the session's, never the body's.
    expect(tasks.start.mock.calls[0][0].task.payload).not.toHaveProperty('organizationId');
  });

  it('stop the previous session of the same person', async () => {
    const first = await request(app).post('/api/debug-sessions').send(body);
    await request(app).post('/api/debug-sessions').send(body);

    const commands = await (await debugChannel()).drain(first.body.id);
    expect(commands).toContainEqual({ type: 'stop' });
  });

  it('accept only the commands that fit the moment', async () => {
    const { body: started } = await request(app).post('/api/debug-sessions').send(body);
    const command = (payload: unknown) => request(app).post(`/api/debug-sessions/${started.id}/commands`).send(payload);

    await setState(started.id, { status: 'running' });
    expect((await command({ type: 'continue' })).status).toBe(409);
    expect((await command({ type: 'pause' })).status).toBe(202);

    await setState(started.id, {
      status: 'paused',
      paused: { pc: 0, stepId: 's1', calledFrom: null, name: 'Buy', actionId: 'click', reason: 'failure', error: 'x', selector: '#a', value: null, canSkip: true, screenshot: null, url: null },
    });
    const refused = await command({ type: 'continue' });
    expect(refused.status).toBe(409);
    expect(refused.body.allowed).toEqual(['retry', 'skip', 'stop', 'breakpoints']);
    expect((await command({ type: 'retry', patch: { selector: '#b' } })).status).toBe(202);

    await setState(started.id, { status: 'finished', paused: null });
    expect((await command({ type: 'stop' })).body.error).toMatch(/ended/);
    expect((await command({ type: 'jump' })).status).toBe(400);

    const sent = await (await debugChannel()).drain(started.id);
    expect(sent).toEqual([{ type: 'pause' }, { type: 'retry', patch: { selector: '#b' } }]);
  });

  it("are nobody else's, in the same organization or another", async () => {
    const { body: started } = await request(app).post('/api/debug-sessions').send(body);

    currentUser = { id: 102, username: 'colleague', organizationId: 7, role: 'owner' };
    expect((await request(app).get(`/api/debug-sessions/${started.id}`)).status).toBe(404);
    expect((await request(app).post(`/api/debug-sessions/${started.id}/commands`).send({ type: 'stop' })).status).toBe(404);

    currentUser = { id: 101, username: 'dev', organizationId: 8, role: 'owner' };
    expect((await request(app).get(`/api/debug-sessions/${started.id}`)).status).toBe(404);

    currentUser = { id: 101, username: 'dev', organizationId: 7, role: 'editor' };
    expect((await request(app).get(`/api/debug-sessions/${started.id}`)).body.id).toBe(started.id);
  });

  it('are for editors', async () => {
    currentUser = { ...currentUser, role: 'viewer' };
    expect((await request(app).post('/api/debug-sessions').send(body)).status).toBe(403);
    expect(tasks.start).not.toHaveBeenCalled();
  });

  it('debug the dataset row asked for, and refuse one the dataset does not have', async () => {
    const dataset = [{ sku: 'A' }, { sku: 'B' }];
    const started = await request(app).post('/api/debug-sessions').send({ ...body, dataset, datasetRow: 1 });
    expect(started.status).toBe(201);
    expect(tasks.start.mock.calls[0][0].task).toMatchObject({ datasetRow: 1 });

    const refused = await request(app).post('/api/debug-sessions').send({ ...body, dataset, datasetRow: 2 });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/2 row/);
  });

  it('refuse a test with no steps', async () => {
    expect((await request(app).post('/api/debug-sessions').send({ ...body, sequence: [] })).status).toBe(400);
  });
});
