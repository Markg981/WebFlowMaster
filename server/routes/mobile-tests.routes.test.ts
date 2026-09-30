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
  if (rest === '/actions' || rest === '/back' || rest === '/appium/device/hide_keyboard' || rest === '/execute/sync') return json(200, { value: null });
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
    expect((await request(app).post('/api/mobile-tests').send({ ...SHOP, name: 'Bad app', app: 'shop.apk' })).body.error).toMatch(/bs:\/\/…, lt:\/\/… or an https:\/\//);

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
});

describe('running on a device', () => {
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

describe('uploading an app', () => {
  it('stores it on the grid and answers its address there', async () => {
    const bs = await request(app).post(`/api/browser-grids/${browserstack}/apps`).attach('file', Buffer.from('PK fake apk'), 'shop.apk');
    expect(bs.status).toBe(201);
    expect(bs.body.app).toBe('bs://c700ce60cf13ae8ed97705a55b8e022f13c5827c');
    expect(hub.requests.at(-1)!.auth).toBe(`Basic ${Buffer.from('qa-user:grid-key-123').toString('base64')}`);

    const lt = await request(app).post(`/api/browser-grids/${lambdatest}/apps`).attach('file', Buffer.from('fake ipa'), 'Shop.ipa');
    expect(lt.body.app).toBe('lt://APP10160271981701234567');

    expect((await request(app).post(`/api/browser-grids/${browserstack}/apps`).attach('file', Buffer.from('x'), 'shop.zip')).body.error).toBe('An app is an .apk, .aab or .ipa file.');
    expect((await request(app).post(`/api/browser-grids/${playwrightServer}/apps`).attach('file', Buffer.from('x'), 'shop.apk')).status).toBe(502);
    const audit = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
    expect(audit.filter((a) => a.action === 'mobile_test.app_uploaded')).toHaveLength(2);
  });
});
