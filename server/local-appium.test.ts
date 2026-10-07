import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { browserGrids } from '@shared/schema';
import { endpointProblem, GRID_FIELDS, RUNS_BROWSERS } from '@shared/browser-grids';
import { isLocalAppPath, mobileTestSchema } from '@shared/mobile';
import { createTestOrganization, createTestUser } from './tests/factories';

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * A local Appium (shared/browser-grids.ts): a "grid" that is an Appium server next to a local
 * agent, reached through the agent's own HTTP (server/agents/agent-fetch.ts) — so the server
 * needs no way into that network. It runs mobile app tests and nothing else.
 *
 * The agent is stood in for: what is checked is that every request to Appium goes through the
 * pool's agent, with Appium's own capabilities, and is given back afterwards.
 */

const agentRequests: Array<{ target: { organizationId: number; pool: string }; url: string; init: RequestInit }> = [];
const agentsClosed: string[] = [];
let appiumAnswers: (url: string, init: RequestInit) => unknown = () => null;

vi.mock('./agents/agent-fetch', () => ({
  AgentHttp: class {
    readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
    constructor(readonly agent: { organizationId: number; pool: string }) {
      this.fetch = async (url, init) => {
        agentRequests.push({ target: agent, url, init });
        const value = appiumAnswers(url, init);
        return new Response(JSON.stringify(value instanceof Response ? null : { value }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    }
    async close() {
      agentsClosed.push(this.agent.pool);
    }
  },
}));

const { mobileSessionRequest, performMobileTest, appiumTransport } = await import('./mobile-runner');
const { gridConnection, checkRunOn, toGridConfig } = await import('./browser-grids');
const { runWithTenant } = await import('./middleware/tenancy');

type User = { id: number; username: string; organizationId: number; role: string };
let app: express.Express;
let organizationId: number;
let editor: User;
let currentUser: User;

beforeAll(async () => {
  organizationId = await createTestOrganization('Local Appium Org');
  editor = { id: await createTestUser(organizationId, 'appium-editor'), username: 'appium-editor', organizationId, role: 'editor' };
  const { default: gridRoutes } = await import('./routes/browser-grids.routes');
  const { default: mobileRoutes } = await import('./routes/mobile-tests.routes');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
  });
  app.use(gridRoutes, mobileRoutes);
});

beforeEach(() => {
  currentUser = editor;
  agentRequests.length = 0;
  agentsClosed.length = 0;
  appiumAnswers = () => null;
});

describe('what a local Appium is', () => {
  it('runs apps, not browsers, needs a pool and no key, and an http:// address', () => {
    expect(RUNS_BROWSERS.local_appium).toBe(false);
    expect(GRID_FIELDS.local_appium).toMatchObject({ agentPool: true, key: 'none', endpointRequired: false });
    expect(endpointProblem('local_appium', 'http://127.0.0.1:4723')).toBeNull();
    expect(endpointProblem('local_appium', 'ws://127.0.0.1:4723')).toMatch(/http:\/\//);
    expect(endpointProblem('playwright_server', 'http://x')).toMatch(/ws:\/\//);
  });

  it('takes an app by its path on the agent machine, as well as the clouds\' addresses', () => {
    expect(isLocalAppPath('/home/qa/shop.apk')).toBe(true);
    expect(isLocalAppPath('C:\\apps\\shop.apk')).toBe(true);
    expect(isLocalAppPath('~/builds/Shop.ipa')).toBe(true);
    expect(isLocalAppPath('shop.apk')).toBe(false);
    expect(isLocalAppPath('/etc/passwd')).toBe(false);
    const base = { name: 'T', platform: 'android', deviceName: 'emulator-5554', steps: [] };
    expect(mobileTestSchema.safeParse({ ...base, app: 'C:\\apps\\shop.apk' }).success).toBe(true);
    expect(mobileTestSchema.safeParse({ ...base, app: 'http://build-server/shop.apk' }).success).toBe(true);
    expect(mobileTestSchema.safeParse({ ...base, app: 'shop.apk' }).success).toBe(false);
  });

  it('asks Appium for the device with its own capabilities, at its address, with no credentials', () => {
    const grid = { id: 'g', name: 'Lab', provider: 'local_appium' as const, username: null, endpoint: null, key: null, agentPool: 'lab', organizationId: 1 };
    const session = mobileSessionRequest(grid, { platform: 'ios', app: '/Users/qa/Shop.app', deviceName: 'iPhone 15', osVersion: '17.2', name: 'T' }, 'B');
    expect(session.hubUrl).toBe('http://127.0.0.1:4723');
    expect(session.authorization).toBeUndefined();
    expect(session.capabilities).toEqual({
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': 'iPhone 15',
      'appium:platformVersion': '17.2',
      'appium:app': '/Users/qa/Shop.app',
      'appium:newCommandTimeout': 300,
    });
    expect(mobileSessionRequest({ ...grid, endpoint: 'http://10.0.0.5:4723/wd/hub' }, { platform: 'android', app: 'x.apk', deviceName: 'd', osVersion: null, name: 'T' }, 'B').hubUrl).toBe('http://10.0.0.5:4723/wd/hub');
    expect(() => gridConnection(grid, { label: 'chromium', engine: 'chromium', sessionName: 's', buildName: 'b' })).toThrow(/mobile app tests only/);
    expect(() => appiumTransport({ ...grid, agentPool: null })).toThrow(/names no pool of agents/);
  });
});

describe('a run on a local Appium', () => {
  it('goes through the pool\'s agent from session to close, and gives the agent back', async () => {
    appiumAnswers = (url, init) => {
      if (url.endsWith('/session') && init.method === 'POST') return { sessionId: 'local-1', capabilities: { platformName: 'Android', 'appium:deviceName': 'emulator-5554', 'appium:platformVersion': '14', accessKey: 'never-retain' } };
      if (url.endsWith('/element')) return { 'element-6066-11e4-a52e-4f735466cecf': 'e1' };
      if (url.endsWith('/displayed')) return true;
      if (url.endsWith('/screenshot')) return 'iVBORw0KGgo=';
      return null;
    };
    const grid = { id: 'g', name: 'Lab', provider: 'local_appium' as const, username: null, endpoint: 'http://127.0.0.1:4723', key: null, agentPool: 'lab', organizationId };
    const outcome = await performMobileTest(
      { platform: 'android', app: '/home/qa/shop.apk', deviceName: 'emulator-5554', osVersion: null, name: 'T', steps: [{ id: 's', action: 'tap', target: '~login' }] },
      grid,
      {},
      'B',
    );
    expect(outcome).toMatchObject({ status: 'passed', screenshot: 'iVBORw0KGgo=', sessionUrl: null });
    expect(outcome.matrixEvidence).toMatchObject({ route: 'appium', provider: 'local_appium', sessionId: 'local-1', verdict: 'matched',
      effective: { os: 'Android', device: 'emulator-5554', osVersion: '14' } });
    expect(JSON.stringify(outcome.matrixEvidence)).not.toContain('never-retain');
    expect(agentRequests.every((r) => r.target.pool === 'lab' && r.target.organizationId === organizationId)).toBe(true);
    expect(agentRequests.map((r) => `${r.init.method} ${r.url}`)).toEqual(
      expect.arrayContaining(['POST http://127.0.0.1:4723/session', 'POST http://127.0.0.1:4723/session/local-1/element', 'DELETE http://127.0.0.1:4723/session/local-1']),
    );
    // No dashboard to tell: no status script is sent.
    expect(agentRequests.some((r) => r.url.endsWith('/execute/sync'))).toBe(false);
    expect(agentsClosed).toEqual(['lab']);
  });
});

describe('the grids page', () => {
  const create = (body: Record<string, unknown>) => request(app).post('/api/browser-grids').send(body);

  it('saves a local Appium with its pool, drops a key, and checks it through an agent', async () => {
    expect((await create({ name: 'No pool', provider: 'local_appium' })).body.error).toBe('Name the pool of local agents that reach Appium.');
    expect((await create({ name: 'Bad address', provider: 'local_appium', agentPool: 'lab', endpoint: 'ws://127.0.0.1:4723' })).status).toBe(400);

    const created = await create({ name: `Lab ${uuidv4().slice(0, 6)}`, provider: 'local_appium', agentPool: 'lab', key: 'ignored', username: 'ignored' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ provider: 'local_appium', agentPool: 'lab', endpoint: null, username: null, hasKey: false });
    const [row] = await privilegedDb.select().from(browserGrids).where(eq(browserGrids.id, created.body.id));
    expect(row.encryptedKey).toBeNull();

    appiumAnswers = (url) => (url === 'http://127.0.0.1:4723/status' ? { ready: true, build: { version: '2.11.3' } } : null);
    const checked = await request(app).post(`/api/browser-grids/${created.body.id}/test`);
    expect(checked.body.ok).toBe(true);
    expect(checked.body.message).toMatch(/^Connected through pool "lab": Appium 2\.11\.3/);
    expect(agentsClosed).toEqual(['lab']);

    // Not a place for a plan's browsers, nor for an uploaded app.
    const runOn = await runWithTenant(organizationId, () => checkRunOn({ browserGridId: created.body.id }), { userId: editor.id, role: 'editor' });
    expect(runOn).toEqual({ ok: false, error: 'A Local Appium (agent) runs mobile app tests only, not a plan\'s browsers.' });
    const upload = await request(app).post(`/api/browser-grids/${created.body.id}/apps`).attach('file', Buffer.from('apk'), 'shop.apk');
    expect(upload.status).toBe(400);
    expect(upload.body.error).toMatch(/put the app on the agent's machine/);

    // A mobile test can name it, and its app can be a path there.
    const test = await request(app)
      .post('/api/mobile-tests')
      .send({ name: `On the lab ${uuidv4().slice(0, 6)}`, platform: 'android', app: '/home/qa/shop.apk', deviceName: 'emulator-5554', gridId: created.body.id, steps: [] });
    expect(test.status).toBe(201);
    expect(toGridConfig(row)).toMatchObject({ provider: 'local_appium', agentPool: 'lab', organizationId });
  });
});
