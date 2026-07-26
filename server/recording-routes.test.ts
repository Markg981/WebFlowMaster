import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { db } from './db';
import { users } from '../shared/schema';
import type { RecordedAction } from '../shared/recording';

/**
 * Exercises the real route handlers registered by `registerRoutes`, with only the browser
 * layer stubbed. The bug these tests exist for was a *contract* bug — the poll endpoint
 * answered with `actions` while the client read `sequence` — so the assertions are about
 * the wire shape, not about the service internals.
 */

const startRecordingSession = vi.fn();
const stopRecordingSession = vi.fn();
const getRecordedActions = vi.fn();

vi.mock('./playwright-service', () => ({
  playwrightService: {
    startRecordingSession: (...args: unknown[]) => startRecordingSession(...args),
    stopRecordingSession: (...args: unknown[]) => stopRecordingSession(...args),
    getRecordedActions: (...args: unknown[]) => getRecordedActions(...args),
    loadWebsite: vi.fn(),
    detectElements: vi.fn(),
    executeAdhocSequence: vi.fn(),
    executeTest: vi.fn(),
  },
  PlaywrightService: class {},
}));

let app: Application;
const mockUser = { id: 1, username: 'recorder_user' };

const sampleSequence: RecordedAction[] = [
  { type: 'navigate', url: 'https://app.test', timestamp: 1, meta: 'session-started' },
  { type: 'click', selector: '#login', timestamp: 2, url: 'https://app.test' },
  { type: 'input', selector: '#password', value: '', masked: true, timestamp: 3 },
  { type: 'assertTextContains', selector: 'h1', value: 'Welcome', timestamp: 4 },
];

beforeAll(async () => {
  const tempApp = express();
  tempApp.use(express.json());
  tempApp.use((req: Request, res: Response, next: NextFunction) => {
    req.user = mockUser as any;
    req.isAuthenticated = () => true;
    next();
  });
  const { registerRoutes } = await import('./routes');
  await registerRoutes(tempApp);
  app = tempApp;
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(users);
  await db.insert(users).values({ id: mockUser.id, username: mockUser.username, password: 'hashed' });
});

describe('POST /api/start-recording', () => {
  it('returns the session id from the service', async () => {
    startRecordingSession.mockResolvedValue({ success: true, sessionId: 'sess-1' });

    const res = await request(app)
      .post('/api/start-recording')
      .send({ url: 'https://app.test' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, sessionId: 'sess-1' });
    expect(startRecordingSession).toHaveBeenCalledWith('https://app.test', mockUser.id);
  });

  it('rejects a non-URL', async () => {
    const res = await request(app).post('/api/start-recording').send({ url: 'not-a-url' });

    expect(res.status).toBe(400);
    expect(startRecordingSession).not.toHaveBeenCalled();
  });

  it('surfaces a service failure as a 500', async () => {
    startRecordingSession.mockResolvedValue({ success: false, error: 'browser launch failed' });

    const res = await request(app)
      .post('/api/start-recording')
      .send({ url: 'https://app.test' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('browser launch failed');
  });
});

describe('GET /api/get-recorded-actions', () => {
  it('returns the buffer under `sequence` — the same field the other endpoints use', async () => {
    getRecordedActions.mockResolvedValue({ success: true, sequence: sampleSequence });

    const res = await request(app).get('/api/get-recorded-actions?sessionId=sess-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sequence).toHaveLength(sampleSequence.length);
    expect(res.body.sequence[1]).toMatchObject({ type: 'click', selector: '#login' });
    // The old field name must not come back: the client only reads `sequence`.
    expect(res.body.actions).toBeUndefined();
  });

  it('never echoes a secret field value', async () => {
    getRecordedActions.mockResolvedValue({ success: true, sequence: sampleSequence });

    const res = await request(app).get('/api/get-recorded-actions?sessionId=sess-1');

    const passwordStep = res.body.sequence.find((a: RecordedAction) => a.selector === '#password');
    expect(passwordStep.masked).toBe(true);
    expect(passwordStep.value).toBe('');
  });

  it('reports sessionEnded so the client can stop polling a dead session', async () => {
    getRecordedActions.mockResolvedValue({
      success: true,
      sequence: sampleSequence,
      sessionEnded: true,
      error: 'The recording browser window was closed.',
    });

    const res = await request(app).get('/api/get-recorded-actions?sessionId=sess-1');

    expect(res.status).toBe(200);
    expect(res.body.sessionEnded).toBe(true);
    expect(res.body.sequence).toHaveLength(sampleSequence.length);
  });

  it('reports sessionEnded on an unknown session id', async () => {
    getRecordedActions.mockResolvedValue({
      success: false,
      sessionEnded: true,
      error: 'Recording session not found or already stopped.',
    });

    const res = await request(app).get('/api/get-recorded-actions?sessionId=ghost');

    expect(res.status).toBe(404);
    expect(res.body.sessionEnded).toBe(true);
    expect(res.body.sequence).toEqual([]);
  });

  it('requires a session id', async () => {
    const res = await request(app).get('/api/get-recorded-actions');

    expect(res.status).toBe(400);
    expect(getRecordedActions).not.toHaveBeenCalled();
  });
});

describe('POST /api/stop-recording', () => {
  it('returns the final sequence', async () => {
    stopRecordingSession.mockResolvedValue({ success: true, sequence: sampleSequence });

    const res = await request(app).post('/api/stop-recording').send({ sessionId: 'sess-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sequence).toHaveLength(sampleSequence.length);
    expect(stopRecordingSession).toHaveBeenCalledWith('sess-1', mockUser.id);
  });

  it('404s on an unknown session', async () => {
    stopRecordingSession.mockResolvedValue({
      success: false,
      error: 'Recording session not found or already stopped.',
    });

    const res = await request(app).post('/api/stop-recording').send({ sessionId: 'ghost' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
