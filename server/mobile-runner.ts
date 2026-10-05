import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { browserGrids, mobileTestRuns, mobileTests, type MobileTest } from '@shared/schema';
import {
  MOBILE_ACTIONS,
  parseMobileLocator,
  type MobileStep,
  type MobileStepResult,
  type MobileExecutionStep,
} from '@shared/mobile';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { withExecutionUsage } from './execution-usage';
import { toGridConfig, type GridConfig } from './browser-grids';
import { resolveVariables, findUnresolvedVariables } from './variables';
import { substituteVariables } from './outbound-http';
import { AppiumSession, WebDriverError, type Fetch } from './appium-client';
import { AgentHttp } from './agents/agent-fetch';
import { LOCAL_APPIUM_DEFAULT_URL } from '@shared/browser-grids';
import { executeMobileFlow, validateMobileExecution } from './mobile-flow';
import { prepareMobileSteps } from './mobile-step-groups';

/**
 * Running a mobile test (shared/mobile.ts) on a cloud grid's real device.
 *
 * BrowserStack App Automate and LambdaTest Real Device both take a W3C WebDriver session through
 * Appium, with the app, the device and the credentials in the capabilities. The session is the
 * only thing that differs; the steps are the same requests on either.
 *
 * The grid's key is decrypted here, when the session is opened, and travels only to the grid:
 * never in the run's row, its steps or its error.
 */

/** The grids' addresses. A field so the tests can point them at a stand-in. */
export const mobileEndpoints = {
  browserstackHub: 'https://hub-cloud.browserstack.com/wd/hub',
  browserstackApi: 'https://api-cloud.browserstack.com',
  lambdatestHub: 'https://mobile-hub.lambdatest.com/wd/hub',
  lambdatestApi: 'https://manual-api.lambdatest.com',
};

/** How long a step looks for its element before it fails. */
export const ELEMENT_TIMEOUT_MS = 15_000;
const POLL_MS = 500;

const basic = (grid: GridConfig) => `Basic ${Buffer.from(`${grid.username ?? ''}:${grid.key ?? ''}`).toString('base64')}`;

export function mobileSessionRequest(grid: GridConfig, test: Pick<MobileTest, 'platform' | 'app' | 'deviceName' | 'osVersion' | 'name'>, build: string) {
  const platformName = test.platform === 'ios' ? 'iOS' : 'Android';
  const automationName = test.platform === 'ios' ? 'XCUITest' : 'UiAutomator2';
  if (grid.provider === 'browserstack') {
    return {
      hubUrl: mobileEndpoints.browserstackHub,
      authorization: basic(grid),
      capabilities: {
        platformName,
        'appium:app': test.app,
        'appium:automationName': automationName,
        'bstack:options': {
          userName: grid.username ?? '',
          accessKey: grid.key ?? '',
          deviceName: test.deviceName,
          ...(test.osVersion ? { osVersion: test.osVersion } : {}),
          projectName: 'WebFlowMaster',
          buildName: build,
          sessionName: test.name,
        },
      },
    };
  }
  if (grid.provider === 'lambdatest') {
    return {
      hubUrl: mobileEndpoints.lambdatestHub,
      authorization: basic(grid),
      capabilities: {
        platformName,
        'appium:automationName': automationName,
        'lt:options': {
          username: grid.username ?? '',
          accessKey: grid.key ?? '',
          deviceName: test.deviceName,
          ...(test.osVersion ? { platformVersion: test.osVersion } : {}),
          app: test.app,
          isRealMobile: true,
          w3c: true,
          build,
          name: test.name,
        },
      },
    };
  }
  if (grid.provider === 'local_appium') {
    // Appium's own capabilities, for whatever it has: an emulator, a simulator, a phone on USB.
    return {
      hubUrl: grid.endpoint || LOCAL_APPIUM_DEFAULT_URL,
      authorization: undefined,
      capabilities: {
        platformName,
        'appium:automationName': automationName,
        'appium:deviceName': test.deviceName,
        ...(test.osVersion ? { 'appium:platformVersion': test.osVersion } : {}),
        'appium:app': test.app,
        'appium:newCommandTimeout': 300,
      },
    };
  }
  throw new Error(`"${grid.name}" is a Playwright server, which runs browsers only. Choose a BrowserStack, LambdaTest or local Appium grid for a mobile app.`);
}

/**
 * How requests reach the grid's Appium: the clouds straight from the server; a local Appium
 * through its pool's agent (server/agents/agent-fetch.ts), from the machine it runs next to.
 * `close` gives back what the agent lent.
 */
export function appiumTransport(grid: GridConfig, override?: Fetch): { fetch: Fetch; close: () => Promise<void> } {
  if (override) return { fetch: override, close: async () => {} };
  if (grid.provider === 'local_appium') {
    if (!grid.agentPool || grid.organizationId == null) {
      throw new Error(`"${grid.name}" names no pool of agents to reach Appium through.`);
    }
    const http = new AgentHttp({ organizationId: grid.organizationId, pool: grid.agentPool });
    return { fetch: (url, init) => http.fetch(url, init), close: () => http.close() };
  }
  return { fetch: (url, init) => fetch(url, init), close: async () => {} };
}

/** The key never leaves in a message, should a grid quote a capability back. */
export function redactGridSecret(message: string, grid: GridConfig): string {
  return grid.key ? message.split(grid.key).join('***') : message;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForElement(session: AppiumSession, locator: NonNullable<ReturnType<typeof parseMobileLocator>>, timeoutMs: number, visible = true) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const element = await session.find(locator);
    if (element && (!visible || (await session.displayed(element).catch(() => false)))) return element;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

export interface StepContext {
  session: AppiumSession;
  platform: MobileTest['platform'];
  vars: Record<string, string>;
  elementTimeoutMs?: number;
}

/** One step. Throws with a message a tester can act on when it fails. */
export async function runMobileStep(ctx: StepContext, step: MobileStep): Promise<string | undefined> {
  const { session } = ctx;
  const timeout = ctx.elementTimeoutMs ?? ELEMENT_TIMEOUT_MS;
  const resolve = (raw: string | undefined) => {
    const text = raw ?? '';
    const missing = findUnresolvedVariables(text, ctx.vars);
    if (missing.length) throw new Error(`Unresolved variable(s) ${missing.join(', ')}. Select an environment that defines them.`);
    return substituteVariables(text, ctx.vars);
  };
  const spec = MOBILE_ACTIONS[step.action];
  let locator = null;
  if (spec.target) {
    locator = parseMobileLocator(resolve(step.target), ctx.platform);
    if (!locator) throw new Error(`"${step.target}" is not a locator for this platform.`);
  }
  const element = async () => {
    const found = await waitForElement(session, locator!, timeout);
    if (!found) throw new Error(`No visible element ${step.target} within ${Math.round(timeout / 1000)}s.`);
    return found;
  };

  switch (step.action) {
    case 'tap':
      await session.click(await element());
      return;
    case 'type': {
      const target = await element();
      await session.clear(target).catch(() => undefined);
      await session.type(target, resolve(step.value));
      return;
    }
    case 'clear':
      await session.clear(await element());
      return;
    case 'waitFor':
    case 'assertVisible':
      await element();
      return;
    case 'assertNotVisible': {
      const deadline = Date.now() + Math.min(timeout, 5_000);
      for (;;) {
        const found = await session.find(locator!);
        if (!found || !(await session.displayed(found).catch(() => false))) return;
        if (Date.now() >= deadline) throw new Error(`${step.target} is still visible.`);
        await sleep(POLL_MS);
      }
    }
    case 'assertText': {
      const wanted = resolve(step.value);
      const target = await element();
      const deadline = Date.now() + Math.min(timeout, 5_000);
      for (;;) {
        const text = await session.text(target);
        if (text.includes(wanted)) return `"${text.slice(0, 120)}"`;
        if (Date.now() >= deadline) throw new Error(`${step.target} shows "${text.slice(0, 200)}", not "${wanted}".`);
        await sleep(POLL_MS);
      }
    }
    case 'swipe': {
      const { width, height } = await session.windowSize();
      const direction = resolve(step.value).trim().toLowerCase();
      const cx = width / 2;
      const cy = height / 2;
      // The finger moves the way the direction says; the content moves the same way.
      const moves: Record<string, [number, number, number, number]> = {
        up: [cx, height * 0.75, cx, height * 0.25],
        down: [cx, height * 0.25, cx, height * 0.75],
        left: [width * 0.85, cy, width * 0.15, cy],
        right: [width * 0.15, cy, width * 0.85, cy],
      };
      const move = moves[direction];
      if (!move) throw new Error(`swipe takes up, down, left or right, not "${direction}".`);
      await session.drag({ x: move[0], y: move[1] }, { x: move[2], y: move[3] });
      return;
    }
    case 'back':
      await session.back();
      return;
    case 'hideKeyboard':
      await session.hideKeyboard();
      return;
    case 'wait':
      await sleep(Math.min(Number(resolve(step.value)) || 0, 60) * 1000);
      return;
    default:
      throw new Error(`The mobile action ${step.action} requires a test flow, not an inspector interaction.`);
  }
}

export interface RunDeps {
  fetch?: Fetch;
  elementTimeoutMs?: number;
}

/** Tells the grid whether the session passed, so its dashboard agrees with the report. */
async function markSession(session: AppiumSession, grid: GridConfig, passed: boolean, reason: string) {
  // A local Appium has no dashboard to tell.
  if (grid.provider !== 'browserstack' && grid.provider !== 'lambdatest') return;
  const status = passed ? 'passed' : 'failed';
  const script =
    grid.provider === 'browserstack'
      ? `browserstack_executor: ${JSON.stringify({ action: 'setSessionStatus', arguments: { status, reason: reason.slice(0, 250) } })}`
      : `lambda-status=${status}`;
  await session.execute(script).catch(() => undefined);
}

/** BrowserStack's page for the session, with its video and logs. */
async function sessionUrl(grid: GridConfig, sessionId: string, doFetch: Fetch): Promise<string | null> {
  if (grid.provider !== 'browserstack') return null;
  try {
    const response = await doFetch(`${mobileEndpoints.browserstackApi}/app-automate/sessions/${sessionId}.json`, {
      method: 'GET',
      headers: { Authorization: basic(grid), Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body: any = await response.json();
    return body?.automation_session?.public_url ?? body?.automation_session?.browser_url ?? null;
  } catch {
    return null;
  }
}

/** How one run of a mobile test ended: on its own page or as a row of a plan's report. */
export interface MobileOutcome {
  status: 'passed' | 'failed' | 'error';
  steps: MobileStepResult[];
  error: string | null;
  /** The device's screen at the end, base64 PNG. */
  screenshot: string | null;
  sessionUrl: string | null;
}

/**
 * Opens a session on the grid's device, runs the steps and closes it. Never throws: a session
 * that would not open, or a grid that runs no apps, is an 'error' outcome with the reason.
 */
export async function performMobileTest(
  test: Pick<MobileTest, 'platform' | 'app' | 'deviceName' | 'osVersion' | 'name' | 'steps'> & { executionSteps?: MobileExecutionStep[] },
  grid: GridConfig,
  vars: Record<string, string>,
  build: string,
  deps: RunDeps & { onStep?: (steps: MobileStepResult[]) => Promise<void> } = {},
): Promise<MobileOutcome> {
  const results: MobileStepResult[] = [];
  let session: AppiumSession | null = null;
  let transport: ReturnType<typeof appiumTransport> | null = null;
  try {
    const steps = test.executionSteps ?? test.steps;
    validateMobileExecution(steps, test.platform);
    const request = mobileSessionRequest(grid, test, build);
    transport = appiumTransport(grid, deps.fetch);
    const doFetch = transport.fetch;
    session = await AppiumSession.open({ ...request, fetch: doFetch });

    const flow = await executeMobileFlow({ steps, session, platform: test.platform, vars,
      primitive: step => runMobileStep({ session: session!, platform: test.platform, vars, elementTimeoutMs: deps.elementTimeoutMs }, step),
      onStep: deps.onStep ? rows => deps.onStep!(rows.map(row => ({ ...row, error: row.error ? redactGridSecret(row.error, grid) : undefined }))) : undefined });
    results.push(...flow.results.map(row => ({ ...row, error: row.error ? redactGridSecret(row.error, grid) : undefined })));
    const failure = flow.failure ? redactGridSecret(flow.failure, grid) : null;

    const screenshot = await session.screenshot();
    await markSession(session, grid, !failure, failure ?? 'All steps passed');
    const url = await sessionUrl(grid, session.id, doFetch);
    return { status: failure ? 'failed' : 'passed', steps: results, error: failure, screenshot, sessionUrl: url };
  } catch (error: any) {
    const message = error instanceof WebDriverError ? `${grid.name}: ${error.message}` : String(error?.message ?? error);
    return { status: 'error', steps: results, error: redactGridSecret(message, grid), screenshot: null, sessionUrl: null };
  } finally {
    await session?.close();
    await transport?.close();
  }
}

/** The device a mobile test runs on, as a plan's report names it: "Pixel 8 · 14.0". */
export const mobileDeviceLabel = (test: Pick<MobileTest, 'deviceName' | 'osVersion'>) =>
  test.osVersion ? `${test.deviceName} · ${test.osVersion}` : test.deviceName;

/**
 * Runs a queued run to its end, writing each step as it goes so the page can follow it. Never
 * throws: whatever went wrong is the run's error.
 */
export async function executeMobileRun(runId: string, organizationId: number, userId: number, deps: RunDeps = {}): Promise<void> {
  await runWithTenant(organizationId, async () => {
    const update = (values: Partial<typeof mobileTestRuns.$inferInsert>) =>
      withTenantTransaction(async (tx) => {
        await tx.update(mobileTestRuns).set(values).where(eq(mobileTestRuns.id, runId));
      });

    const loaded = await withTenantTransaction(async (tx) => {
      const [run] = await tx.select().from(mobileTestRuns).where(eq(mobileTestRuns.id, runId)).limit(1);
      if (!run) return null;
      const [test] = await tx.select().from(mobileTests).where(eq(mobileTests.id, run.mobileTestId)).limit(1);
      const [grid] = run.gridId ? await tx.select().from(browserGrids).where(eq(browserGrids.id, run.gridId)).limit(1) : [];
      // A delayed debug run must use the working copy it was started with.
      const definition = test && run.testSnapshot ? { ...test, ...run.testSnapshot } as MobileTest & {executionSteps?:MobileExecutionStep[]} : test;
      return { run, test: definition, grid };
    });
    if (!loaded) return;
    const { run, test, grid: gridRow } = loaded;
    if (!test || !gridRow) {
      await update({ status: 'error', error: !test ? 'The test was deleted.' : 'The grid was deleted.', finishedAt: new Date() });
      return;
    }
    const grid = toGridConfig(gridRow);
    try {
      if (!('executionSteps' in test)) {
        const executionSteps=await withTenantTransaction(tx=>prepareMobileSteps(tx,test));
        Object.assign(test,{executionSteps});
        await update({testSnapshot:{...run.testSnapshot,...test,executionSteps}});
      }
      await update({ status: 'running', startedAt: new Date() });
      const vars = await resolveVariables({ userId, organizationId, environmentId: run.environmentId });
      const outcome = await withExecutionUsage('mobile', () => performMobileTest(test, grid, vars, `WebFlowMaster · ${test.name}`, {
        ...deps,
        onStep: (steps) => update({ steps }),
      }), runId);
      await update({
        status: outcome.status,
        steps: outcome.steps,
        error: outcome.error,
        screenshot: outcome.screenshot,
        sessionUrl: outcome.sessionUrl,
        finishedAt: new Date(),
      });
    } catch (error: any) {
      await update({ status: 'error', error: redactGridSecret(String(error?.message ?? error), grid), finishedAt: new Date() });
    }
  }, { userId, role: 'editor' });
}

/**
 * Sends an app to the grid's storage and answers its address there: bs://… on BrowserStack,
 * lt://… on LambdaTest. The file is streamed from disk, not held in memory.
 */
export async function uploadApp(grid: GridConfig, filePath: string, fileName: string, doFetch: Fetch = (url, init) => fetch(url, init)): Promise<string> {
  const blob = await fs.openAsBlob(filePath);
  const form = new FormData();
  const name = path.basename(fileName);
  let url: string;
  if (grid.provider === 'browserstack') {
    form.append('file', blob, name);
    form.append('custom_id', name.replace(/\.(apk|aab|ipa)$/i, '').slice(0, 100));
    url = `${mobileEndpoints.browserstackApi}/app-automate/upload`;
  } else if (grid.provider === 'lambdatest') {
    form.append('appFile', blob, name);
    form.append('name', name);
    url = `${mobileEndpoints.lambdatestApi}/app/upload/realDevice`;
  } else if (grid.provider === 'local_appium') {
    throw new Error(`"${grid.name}" is a local Appium: put the app on the agent's machine and give its path, or an http(s):// address Appium can download it from.`);
  } else {
    throw new Error(`"${grid.name}" is a Playwright server: apps are uploaded to BrowserStack or LambdaTest.`);
  }
  const response = await doFetch(url, { method: 'POST', headers: { Authorization: basic(grid) }, body: form });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok || !body?.app_url) {
    const reason = body?.error ?? body?.message ?? (text.slice(0, 200) || `HTTP ${response.status}`);
    throw new Error(redactGridSecret(`${grid.name} refused the app: ${reason}`, grid));
  }
  return String(body.app_url);
}
