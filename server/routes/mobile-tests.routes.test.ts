import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { auditLog, browserGrids, environments, mobileTestRuns, mobileTests, secrets } from '@shared/schema';
import { mobileStepProblem, parseMobileLocator } from '@shared/mobile';
import { encryptSecret } from '../crypto';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { mobileEndpoints, mobileSessionRequest } from '../mobile-runner';

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Mobile app tests through the API, against a stand-in Appium hub that behaves like a shop app
 * on a phone: a sign-in screen, and a welcome once signed in.
 */

type User = { id: number; username: string; organizationId: number; role: string };

let app: express.Express;
let organizationId: number;
let editor: User;
let viewer: User;
let otherOrg: User;
let currentUser: User;
let browserstack: string;
let lambdatest: string;
let playwrightServer: string;
let staging: number;

// ─── A phone with the shop app ─────────────────────────────────────────────────

interface Hub {
  requests: Array<{ method: string; path: string; body: any; auth?: string }>;
  signedIn: boolean;
  typed: Record<string, string>;
  refuseSession: string | null;
}
const hub: Hub = { requests: [], signedIn: false, typed: {}, refuseSession: null };

const ELEMENTS: Record<string, string> = {
  'accessibility id:email': 'e-email',
  'accessibility id:password': 'e-password',
  'accessibility id:login': 'e-login',
  "xpath://*[@text='Sign in']": 'e-title',
};

/** The screens as UiAutomator describes them, for the inspector. */
const SIGN_IN_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout bounds="[0,0][400,800]">
    <android.widget.TextView text="Sign in" resource-id="com.shop:id/title" bounds="[40,80][360,140]"/>
    <android.widget.EditText content-desc="email" text="" bounds="[40,300][360,360]"/>
    <android.widget.EditText content-desc="password" text="" bounds="[40,400][360,460]"/>
    <android.widget.Button content-desc="login" text="Sign in" bounds="[40,600][360,680]"/>
  </android.widget.FrameLayout>
</hierarchy>`;
const WELCOME_SOURCE = `<hierarchy><android.widget.FrameLayout bounds="[0,0][400,800]"><android.widget.TextView text="Welcome, Ann &amp; co" resource-id="com.shop:id/welcome" bounds="[40,80][360,140]"/></android.widget.FrameLayout></hierarchy>`;

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  const url = new URL(req.url!, 'http://x');
  const body = (req.headers['content-type'] ?? '').includes('json') && raw.length ? JSON.parse(raw.toString()) : null;
  hub.requests.push({ method: req.method!, path: url.pathname, body, auth: req.headers.authorization });
  const json = (status: number, value: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  const noElement = () => json(404, { value: { error: 'no such element', message: 'An element could not be located' } });

  // The grids' storage for apps.
  if (url.pathname === '/bs-api/app-automate/upload') return json(200, { app_url: 'bs://c700ce60cf13ae8ed97705a55b8e022f13c5827c' });
  if (url.pathname === '/lt-api/app/upload/realDevice') {
    return raw.includes(Buffer.from('name="appFile"')) ? json(200, { app_url: 'lt://APP10160271981701234567' }) : json(400, { message: 'appFile missing' });
  }
  if (url.pathname.startsWith('/bs-api/app-automate/sessions/')) return json(200, { automation_session: { public_url: 'https://app-automate.browserstack.com/s/abc' } });

  const path = url.pathname.replace(/^\/(bs|lt)-hub/, '');
  if (req.method === 'POST' && path === '/session') {
    if (hub.refuseSession) return json(500, { value: { error: 'session not created', message: hub.refuseSession } });
    hub.signedIn = false;
    hub.typed = {};
    return json(200, { value: { sessionId: 'sess-1', capabilities: { platformName: 'Android' } } });
  }
  const session = /^\/session\/sess-1(\/.*)?$/.exec(path);
  if (!session) return json(404, { value: { error: 'unknown command', message: path } });
  const rest = session[1] ?? '';
  if (req.method === 'DELETE') return json(200, { value: null });
  if (rest === '/element') {
    if (body.using === 'id' && body.value === 'com.shop:id/welcome') return hub.signedIn ? json(200, { value: { 'element-6066-11e4-a52e-4f735466cecf': 'e-welcome' } }) : noElement();
    const id = ELEMENTS[`${body.using}:${body.value}`];
    if (!id || hub.signedIn) return noElement();
    return json(200, { value: { 'element-6066-11e4-a52e-4f735466cecf': id } });
  }
  const element = /^\/element\/([\w-]+)\/(\w+)$/.exec(rest);
  if (element) {
    const [, id, command] = element;
    if (command === 'displayed') return json(200, { value: true });
    if (command === 'clear') return json(200, { value: null });
    if (command === 'value') {
      hub.typed[id] = body.text;
      return json(200, { value: null });
    }
    if (command === 'click') {
      if (id === 'e-login') hub.signedIn = hub.typed['e-email'] === 'ann@shop.test' && hub.typed['e-password'] === 'S3cret!';
      return json(200, { value: null });
    }
    if (command === 'text') return json(200, { value: id === 'e-welcome' ? 'Welcome, Ann' : 'Sign in' });
  }
  if (rest === '/window/rect') return json(200, { value: { x: 0, y: 0, width: 400, height: 800 } });
  if (rest === '/source') return json(200, { value: hub.signedIn ? WELCOME_SOURCE : SIGN_IN_SOURCE });
  if (rest === '/actions') {
    // A tap on a point (one move, down, up): on the sign-in button, it signs in as a click would.
    const steps: any[] = body?.actions?.[0]?.actions ?? [];
    const moves = steps.filter((a) => a.type === 'pointerMove');
    if (moves.length === 1 && steps.some((a) => a.type === 'pointerUp')) {
      const { x, y } = moves[0];
      if (x >= 40 && x < 360 && y >= 600 && y < 680) {
        hub.signedIn = hub.typed['e-email'] === 'ann@shop.test' && hub.typed['e-password'] === 'S3cret!';
      }
    }
    return json(200, { value: null });
  }
  if (rest === '/back' || rest === '/appium/device/hide_keyboard' || rest === '/execute/sync') return json(200, { value: null });
  if (rest === '/screenshot') return json(200, { value: 'iVBORw0KGgo=' });
  json(404, { value: { error: 'unknown command', message: rest } });
});
let base: string;

async function addGrid(provider: string, name: string) {
  const key = encryptSecret('grid-key-123');
  const id = uuidv4();
  await privilegedDb.insert(browserGrids).values({
    id, organizationId, name, provider, username: 'qa-user', endpoint: provider === 'playwright_server' ? 'ws://pw:3000' : null,
    encryptedKey: key.encryptedValue, keyIv: key.iv, keyAuthTag: key.authTag,
  });
  return id;
}

const SHOP = {
  name: 'Sign in to the shop',
  platform: 'android',
  app: 'bs://c700ce60cf13ae8ed97705a55b8e022f13c5827c',
  deviceName: 'Google Pixel 8',
  osVersion: '14.0',
  steps: [
    { id: 's1', action: 'assertText', target: 'text=Sign in', value: 'Sign' },
    { id: 's2', action: 'type', target: '~email', value: '{{user.email}}' },
    { id: 's3', action: 'type', target: '~password', value: '{{secret_password}}' },
    { id: 's4', action: 'hideKeyboard' },
    { id: 's5', action: 'tap', target: '~login' },
    { id: 's6', action: 'assertText', target: 'id=com.shop:id/welcome', value: 'Welcome' },
    { id: 's7', action: 'swipe', value: 'up' },
  ],
};

beforeAll(async () => {
  organizationId = await createTestOrganization('Mobile Org');
  editor = { id: await createTestUser(organizationId, 'mobile-editor'), username: 'mobile-editor', organizationId, role: 'editor' };
  viewer = { id: await createTestUser(organizationId, 'mobile-viewer'), username: 'mobile-viewer', organizationId, role: 'viewer' };
  const otherOrganizationId = await createTestOrganization('Other Mobile Org');
  otherOrg = { id: await createTestUser(otherOrganizationId, 'mobile-other'), username: 'mobile-other', organizationId: otherOrganizationId, role: 'owner' };

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(mobileEndpoints, { browserstackHub: `${base}/bs-hub`, browserstackApi: `${base}/bs-api`, lambdatestHub: `${base}/lt-hub`, lambdatestApi: `${base}/lt-api` });

  browserstack = await addGrid('browserstack', 'BrowserStack');
  lambdatest = await addGrid('lambdatest', 'LambdaTest');
  playwrightServer = await addGrid('playwright_server', 'Own server');
  [{ id: staging }] = await privilegedDb.insert(environments).values({ name: 'Staging', userId: editor.id, organizationId }).returning();
  for (const [keyName, value] of [['user.email', 'ann@shop.test'], ['secret_password', 'S3cret!']]) {
    const secret = encryptSecret(value);
    await privilegedDb.insert(secrets).values({ environmentId: staging, keyName, encryptedValue: secret.encryptedValue, iv: secret.iv, authTag: secret.authTag, userId: editor.id, organizationId });
  }

  const { default: routes, mobileRunner } = await import('./mobile-tests.routes');
  mobileRunner.deps = { elementTimeoutMs: 600 };
  const { inspectorDeps } = await import('../mobile-inspector');
  inspectorDeps.elementTimeoutMs = 600;
  const { runWithTenant } = await import('../middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
  });
  app.use(routes);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await privilegedDb.delete(mobileTestRuns).where(eq(mobileTestRuns.organizationId, organizationId));
  await privilegedDb.delete(mobileTests).where(eq(mobileTests.organizationId, organizationId));
  currentUser = editor;
  hub.requests = [];
  hub.refuseSession = null;
});

async function finished(runId: string) {
  for (let i = 0; i < 100; i++) {
    const res = await request(app).get(`/api/mobile-test-runs/${runId}`);
    if (['passed', 'failed', 'error'].includes(res.body.status)) return res.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The run did not finish.');
}

describe('locators and steps', () => {
  it('reads each way of naming an element, per platform', () => {
    expect(parseMobileLocator('~login', 'ios')).toEqual({ using: 'accessibility id', value: 'login' });
    expect(parseMobileLocator('id=com.shop:id/ok', 'android')).toEqual({ using: 'id', value: 'com.shop:id/ok' });
    expect(parseMobileLocator("text=Don't go", 'android')).toEqual({ using: 'xpath', value: `//*[@text="Don't go"]` });
    expect(parseMobileLocator('text=OK', 'ios')!.value).toBe("//*[@label='OK' or @name='OK' or @value='OK']");
    expect(parseMobileLocator('//android.widget.Button', 'android')!.using).toBe('xpath');
    expect(parseMobileLocator('android=new UiSelector().text("OK")', 'android')!.using).toBe('-android uiautomator');
    expect(parseMobileLocator('android=new UiSelector()', 'ios')).toBeNull();
    expect(parseMobileLocator('chain=**/XCUIElementTypeButton', 'ios')!.using).toBe('-ios class chain');
    expect(parseMobileLocator('#login', 'android')).toBeNull();
  });

  it('says what is wrong with a step', () => {
    expect(mobileStepProblem({ id: '1', action: 'tap' }, 'android')).toBe('tap needs an element.');
    expect(mobileStepProblem({ id: '1', action: 'tap', target: '.button' }, 'ios')).toMatch(/not a locator for iOS/);
    expect(mobileStepProblem({ id: '1', action: 'swipe', value: 'sideways' }, 'ios')).toMatch(/up, down, left or right/);
    expect(mobileStepProblem({ id: '1', action: 'wait', value: '90' }, 'ios')).toMatch(/up to 60/);
    expect(mobileStepProblem({ id: '1', action: 'type', target: '~q', value: '' }, 'ios')).toBeNull();
  });

  it('asks each grid for the device, the app and the automation', () => {
    const test = { platform: 'ios' as const, app: 'lt://APP1', deviceName: 'iPhone 15', osVersion: '17', name: 'T' };
    const lt = mobileSessionRequest({ id: 'g', name: 'LT', provider: 'lambdatest', username: 'u', endpoint: null, key: 'k' }, test, 'B');
    expect(lt.capabilities).toMatchObject({
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'lt:options': { deviceName: 'iPhone 15', platformVersion: '17', app: 'lt://APP1', isRealMobile: true, username: 'u', accessKey: 'k' },
    });
    expect(() => mobileSessionRequest({ id: 'g', name: 'Own', provider: 'playwright_server', username: null, endpoint: 'ws://x', key: null }, test, 'B')).toThrow(/runs browsers only/);
  });
});

describe('a mobile test', () => {
  it('is written, read, changed and deleted by editors, and read by viewers', async () => {
    const created = await request(app).post('/api/mobile-tests').send(SHOP);
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(created.body).toMatchObject({ platform: 'android', deviceName: 'Google Pixel 8' });

    expect((await request(app).post('/api/mobile-tests').send({ ...SHOP, name: 'SIGN IN TO THE SHOP' })).status).toBe(409);
    const badStep = await request(app).post('/api/mobile-tests').send({ ...SHOP, name: 'Bad', steps: [{ id: 'x', action: 'tap', target: '#login' }] });
    expect(badStep.status).toBe(400);
    expect(badStep.body.error).toMatch(/^Step 1: "#login" is not a locator for Android/);
    expect((await request(app).post('/api/mobile-tests').send({ ...SHOP, name: 'Bad app', app: 'shop.apk' })).body.error).toMatch(/bs:\/\/…, lt:\/\/…, an http\(s\):\/\/ address .* its path on the agent's machine/);

    expect((await request(app).put(`/api/mobile-tests/${id}`).send({ ...SHOP, deviceName: 'Samsung Galaxy S24' })).body.deviceName).toBe('Samsung Galaxy S24');

    currentUser = viewer;
    expect((await request(app).get(`/api/mobile-tests/${id}`)).body.name).toBe('Sign in to the shop');
    expect((await request(app).delete(`/api/mobile-tests/${id}`)).status).toBe(403);
    currentUser = otherOrg;
    expect((await request(app).get(`/api/mobile-tests/${id}`)).status).toBe(404);
    expect((await request(app).get('/api/mobile-tests')).body).toEqual([]);
    currentUser = editor;
    expect((await request(app).delete(`/api/mobile-tests/${id}`)).status).toBe(204);
    const audit = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['mobile_test.created', 'mobile_test.updated', 'mobile_test.deleted']));
  });

  it('names the grid it runs on in a plan: one of the organization that runs apps', async () => {
    const created = await request(app).post('/api/mobile-tests').send({ ...SHOP, gridId: browserstack });
    expect(created.status).toBe(201);
    expect(created.body.gridId).toBe(browserstack);
    const id = created.body.id;

    expect((await request(app).put(`/api/mobile-tests/${id}`).send({ ...SHOP, gridId: lambdatest })).body.gridId).toBe(lambdatest);
    const playwright = await request(app).put(`/api/mobile-tests/${id}`).send({ ...SHOP, gridId: playwrightServer });
    expect(playwright.status).toBe(400);
    expect(playwright.body.error).toMatch(/runs browsers only/);

    const foreign = uuidv4();
    await privilegedDb.insert(browserGrids).values({ id: foreign, organizationId: otherOrg.organizationId, name: 'Theirs', provider: 'browserstack' });
    expect((await request(app).post('/api/mobile-tests').send({ ...SHOP, name: 'Foreign', gridId: foreign })).status).toBe(404);

    // Cleared: the test keeps running from its page, with the grid chosen there.
    expect((await request(app).put(`/api/mobile-tests/${id}`).send({ ...SHOP, gridId: null })).body.gridId).toBeNull();
  });
});

describe('running on a device', () => {
  it('pins a delayed debug run to its saved working copy and version', async () => {
    const { mobileRunner } = await import('./mobile-tests.routes');
    const start = mobileRunner.start;
    mobileRunner.start = async () => {};
    try {
      const id = (await request(app).post('/api/mobile-tests').send(SHOP).expect(201)).body.id;
      const queued = (await request(app).post(`/api/mobile-tests/${id}/runs`).send({gridId:browserstack,environmentId:staging}).expect(202)).body;
      expect(queued.testVersion).toBe(1);
      await request(app).put(`/api/mobile-tests/${id}`).send({...SHOP,deviceName:'Samsung Galaxy S24',steps:[]}).expect(200);
      await start(queued.id, organizationId, editor.id);
      const run = await finished(queued.id);
      expect(run).toMatchObject({status:'passed',testVersion:1,device:'Google Pixel 8 · 14.0'});
      const session = hub.requests.find(r => r.method === 'POST' && r.path === '/bs-hub/session')!;
      expect(session.body.capabilities.alwaysMatch['bstack:options'].deviceName).toBe('Google Pixel 8');
    } finally {
      mobileRunner.start = start;
    }
  });
  it('signs in on BrowserStack with the environment\'s values, step by step', async () => {
    const id = (await request(app).post('/api/mobile-tests').send(SHOP)).body.id;
    const started = await request(app).post(`/api/mobile-tests/${id}/runs`).send({ gridId: browserstack, environmentId: staging });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: 'queued', device: 'Google Pixel 8 · 14.0' });
    const run = await finished(started.body.id);

    expect(run.status).toBe('passed');
    expect(run.steps.map((s: any) => s.status)).toEqual(Array(7).fill('passed'));
    expect(run.steps[5].detail).toBe('"Welcome, Ann"');
    expect(run.screenshot).toBe('iVBORw0KGgo=');
    expect(run.sessionUrl).toBe('https://app-automate.browserstack.com/s/abc');

    const opened = hub.requests.find((r) => r.path === '/bs-hub/session')!;
    expect(opened.auth).toBe(`Basic ${Buffer.from('qa-user:grid-key-123').toString('base64')}`);
    expect(opened.body.capabilities.alwaysMatch).toMatchObject({
      platformName: 'Android',
      'appium:app': SHOP.app,
      'appium:automationName': 'UiAutomator2',
      'bstack:options': { deviceName: 'Google Pixel 8', osVersion: '14.0', sessionName: 'Sign in to the shop', userName: 'qa-user' },
    });
    // The swipe went up the screen, and the grid was told the session passed.
    const swipe = hub.requests.find((r) => r.path.endsWith('/actions'))!.body.actions[0].actions;
    expect(swipe[0]).toMatchObject({ x: 200, y: 600 });
    expect(swipe[3]).toMatchObject({ x: 200, y: 200 });
    expect(hub.requests.find((r) => r.path.endsWith('/execute/sync'))!.body.script).toContain('"status":"passed"');
    expect(hub.requests.at(-1)!.method).toBe('DELETE');
  });

  it('fails on the step that fails, skips the rest, and says so', async () => {
    const id = (await request(app).post('/api/mobile-tests').send(SHOP)).body.id;
    // Without the environment the password is unknown, and the step says which variable.
    const run = await finished((await request(app).post(`/api/mobile-tests/${id}/runs`).send({ gridId: browserstack })).body.id);
    expect(run.status).toBe('failed');
    expect(run.steps.map((s: any) => s.status)).toEqual(['passed', 'failed', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(run.error).toMatch(/Unresolved variable\(s\) user\.email/);

    await request(app).put(`/api/mobile-tests/${id}`).send({ ...SHOP, steps: [{ id: 'x', action: 'tap', target: '~nowhere' }] });
    const missing = await finished((await request(app).post(`/api/mobile-tests/${id}/runs`).send({ gridId: lambdatest, environmentId: staging })).body.id);
    expect(missing).toMatchObject({ status: 'failed', error: 'No visible element ~nowhere within 1s.', sessionUrl: null });
    expect(hub.requests.filter((r) => r.path.endsWith('/execute/sync')).at(-1)!.body.script).toBe('lambda-status=failed');
  });

  it('reports a device the grid could not give, without the grid\'s key', async () => {
    hub.refuseSession = 'Could not find device Google Pixel 99 for user qa-user with key grid-key-123';
    const id = (await request(app).post('/api/mobile-tests').send({ ...SHOP, deviceName: 'Google Pixel 99' })).body.id;
    const run = await finished((await request(app).post(`/api/mobile-tests/${id}/runs`).send({ gridId: browserstack, environmentId: staging })).body.id);
    expect(run).toMatchObject({ status: 'error', error: 'BrowserStack: Could not find device Google Pixel 99 for user qa-user with key ***' });
  });

  it('refuses a Playwright server, a test with no steps, and a viewer', async () => {
    const id = (await request(app).post('/api/mobile-tests').send(SHOP)).body.id;
    expect((await request(app).post(`/api/mobile-tests/${id}/runs`).send({ gridId: playwrightServer })).body.error).toMatch(/runs browsers only/);
    const empty = (await request(app).post('/api/mobile-tests').send({ ...SHOP, name: 'Empty', steps: [] })).body.id;
    expect((await request(app).post(`/api/mobile-tests/${empty}/runs`).send({ gridId: browserstack })).body.error).toBe('The test has no steps to run.');
    currentUser = viewer;
    expect((await request(app).post(`/api/mobile-tests/${id}/runs`).send({ gridId: browserstack })).status).toBe(403);
    expect(hub.requests).toHaveLength(0);
  });
});

describe('the inspector', () => {
  const OPEN = { gridId: '', platform: 'android', app: SHOP.app, deviceName: 'Google Pixel 8', osVersion: '14.0' };
  const find = (tree: any, match: (node: any) => boolean): any => {
    if (match(tree)) return tree;
    for (const child of tree.children ?? []) {
      const found = find(child, match);
      if (found) return found;
    }
    return null;
  };

  it('opens the app on a device, and follows it screen by screen', async () => {
    const opened = await request(app).post('/api/mobile-inspector').send({ ...OPEN, gridId: browserstack });
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({ platform: 'android', window: { width: 400, height: 800 }, screenshot: 'iVBORw0KGgo=', device: 'Google Pixel 8 · Android 14.0' });
    const button = find(opened.body.tree, (n) => n.attributes?.['content-desc'] === 'login');
    expect(button).toMatchObject({ type: 'android.widget.Button', bounds: { x: 40, y: 600, width: 320, height: 80 } });
    const session = hub.requests.find((r) => r.method === 'POST' && r.path === '/bs-hub/session')!;
    expect(session.body.capabilities.alwaysMatch['bstack:options'].buildName).toBe('WebFlowMaster · inspector');
    const id = opened.body.id;

    const act = (body: unknown) => request(app).post(`/api/mobile-inspector/${id}/actions`).send(body);
    // No environment in the inspector: a value naming a variable is refused with the name.
    const variable = await act({ kind: 'step', step: { id: 'd', action: 'type', target: '~email', value: '{{user.email}}' } });
    expect(variable.body.error).toMatch(/Unresolved variable\(s\) user\.email/);
    expect((await act({ kind: 'step', step: { id: 'a', action: 'type', target: '~email', value: 'ann@shop.test' } })).body.error).toBeNull();
    await act({ kind: 'step', step: { id: 'b', action: 'type', target: '~password', value: 'S3cret!' } });
    // A tap on the picture of the button, in the tree's coordinates.
    const after = await act({ kind: 'tapAt', x: 200, y: 640 });
    expect(after.status).toBe(200);
    expect(find(after.body.tree, (n) => n.attributes?.['resource-id'] === 'com.shop:id/welcome').attributes.text).toBe('Welcome, Ann & co');

    const failed = await act({ kind: 'step', step: { id: 'c', action: 'tap', target: '~nothing' } });
    expect(failed.body.error).toMatch(/No visible element ~nothing/);
    expect(failed.body.tree).not.toBeNull();

    expect((await request(app).get(`/api/mobile-inspector/${id}`)).status).toBe(200);
    const audit = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    expect(audit.some((a) => a.action === 'mobile_test.inspector_opened')).toBe(true);

    hub.requests = [];
    expect((await request(app).delete(`/api/mobile-inspector/${id}`)).status).toBe(204);
    expect(hub.requests.some((r) => r.method === 'DELETE' && r.path === '/bs-hub/session/sess-1')).toBe(true);
    const gone = await request(app).get(`/api/mobile-inspector/${id}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toMatch(/has ended/);
  });

  it('holds one session per person, and keeps it from everybody else', async () => {
    const first = (await request(app).post('/api/mobile-inspector').send({ ...OPEN, gridId: browserstack })).body.id;
    const second = (await request(app).post('/api/mobile-inspector').send({ ...OPEN, gridId: lambdatest })).body.id;
    expect((await request(app).get(`/api/mobile-inspector/${first}`)).status).toBe(404);
    expect((await request(app).get(`/api/mobile-inspector/${second}`)).status).toBe(200);

    currentUser = otherOrg;
    expect((await request(app).get(`/api/mobile-inspector/${second}`)).status).toBe(404);
    expect((await request(app).delete(`/api/mobile-inspector/${second}`)).status).toBe(404);
    currentUser = viewer;
    expect((await request(app).post('/api/mobile-inspector').send({ ...OPEN, gridId: browserstack })).status).toBe(403);
    currentUser = editor;
    await request(app).delete(`/api/mobile-inspector/${second}`);
  });

  it('refuses a Playwright server, and says why a device was not given, without the key', async () => {
    const playwright = await request(app).post('/api/mobile-inspector').send({ ...OPEN, gridId: playwrightServer });
    expect(playwright.status).toBe(400);
    hub.refuseSession = 'Could not find device Google Pixel 99 (key grid-key-123)';
    const refused = await request(app).post('/api/mobile-inspector').send({ ...OPEN, gridId: browserstack, deviceName: 'Google Pixel 99' });
    expect(refused.status).toBe(502);
    expect(refused.body.error).toMatch(/^BrowserStack: .*Could not find device Google Pixel 99/);
    expect(refused.body.error).not.toContain('grid-key-123');
  });
});

describe('uploading an app', () => {
  it('stores it on the grid and answers its address there', async () => {
    const bs = await request(app).post(`/api/browser-grids/${browserstack}/apps`).attach('file', Buffer.from('PK fake apk'), 'shop.apk');
    expect(bs.status).toBe(201);
    expect(bs.body.app).toBe('bs://c700ce60cf13ae8ed97705a55b8e022f13c5827c');
    expect(hub.requests.at(-1)!.auth).toBe(`Basic ${Buffer.from('qa-user:grid-key-123').toString('base64')}`);

    const lt = await request(app).post(`/api/browser-grids/${lambdatest}/apps`).attach('file', Buffer.from('fake ipa'), 'Shop.ipa');
    expect(lt.body.app).toBe('lt://APP10160271981701234567');

    expect((await request(app).post(`/api/browser-grids/${browserstack}/apps`).attach('file', Buffer.from('x'), 'shop.zip')).body.error).toBe('An app is an .apk, .aab or .ipa file.');
    expect((await request(app).post(`/api/browser-grids/${playwrightServer}/apps`).attach('file', Buffer.from('x'), 'shop.apk')).status).toBe(400);
    const audit = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    expect(audit.filter((a) => a.action === 'mobile_test.app_uploaded')).toHaveLength(2);
  });
});
