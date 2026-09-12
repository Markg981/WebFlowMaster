import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { privilegedDb } from './db';
import { environments } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { createTestOrganization, createTestUser } from './tests/factories';
import { saveLoginState, loadLoginState } from './login-state';

/**
 * Starting a test already logged in.
 *
 * Nothing reused a browser session: no storageState, no saved cookies, no httpCredentials.
 * Every test therefore authenticated through the UI first, which on DMO costs half a minute
 * per case and fails for reasons unrelated to what the test checks — the login form moved,
 * SSO was slow, the previous run locked the account.
 */

let server: http.Server;
let baseUrl: string;
let organizationId: number;
let userId: number;

/**
 * A page that can tell whether the browser arrives authenticated, which is the only
 * assertion that actually proves a session was reused.
 */
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const authenticated = (req.headers.cookie ?? '').includes('wfm_session=valid-token');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
      `<!doctype html><title>DMO</title><h1 id="state">${
        authenticated ? 'Signed in as svc-tester' : 'Please sign in'
      }</h1>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  organizationId = await createTestOrganization('Login State Org');
  userId = await createTestUser(organizationId, 'login-state-user');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await privilegedDb.delete(environments);
});

async function makeEnvironment(name = 'Acceptance'): Promise<number> {
  const [row] = await privilegedDb
    .insert(environments)
    .values({ name, userId, organizationId })
    .returning();
  return row.id;
}

/** A minimal but real Playwright storageState carrying the cookie the page looks for. */
const sessionState = (host: string, port: number) => ({
  cookies: [
    {
      name: 'wfm_session',
      value: 'valid-token',
      domain: host,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    },
  ],
  origins: [],
});

describe('saving and loading a login state', () => {
  it('round-trips the state through the environment', async () => {
    const environmentId = await makeEnvironment();
    const state = sessionState('127.0.0.1', 0);

    await saveLoginState({ environmentId, organizationId }, state);
    const loaded = await loadLoginState({ environmentId, organizationId });

    expect(loaded).toEqual(state);
  });

  it('stores it encrypted, not as readable JSON', async () => {
    const environmentId = await makeEnvironment();
    await saveLoginState({ environmentId, organizationId }, sessionState('127.0.0.1', 0));

    const [row] = await privilegedDb
      .select()
      .from(environments)
      .where(eq(environments.id, environmentId));

    // The payload is a credential for the system under test. A readable column here would
    // make the environments table a plaintext credential store.
    expect(row.loginState).toBeTruthy();
    expect(row.loginState).not.toContain('valid-token');
    expect(row.loginStateIv).toBeTruthy();
    expect(row.loginStateAuthTag).toBeTruthy();
    expect(row.loginStateCapturedAt).toBeInstanceOf(Date);
  });

  it('does not hand another organization its saved session', async () => {
    const otherOrg = await createTestOrganization('Other Login Org');
    const otherUser = await createTestUser(otherOrg, 'other-login-user');
    const [foreign] = await privilegedDb
      .insert(environments)
      .values({ name: 'Foreign env', userId: otherUser, organizationId: otherOrg })
      .returning();
    await saveLoginState(
      { environmentId: foreign.id, organizationId: otherOrg },
      sessionState('127.0.0.1', 0),
    );

    const loaded = await loadLoginState({ environmentId: foreign.id, organizationId });

    expect(loaded).toBeUndefined();
  });

  it('reports no state for an environment that has none', async () => {
    const environmentId = await makeEnvironment();

    expect(await loadLoginState({ environmentId, organizationId })).toBeUndefined();
  });
});

describe('running a test with a saved login state', () => {
  it('arrives at the page already authenticated', async () => {
    const { playwrightService } = await import('./playwright-service');
    const port = (server.address() as AddressInfo).port;
    const environmentId = await makeEnvironment();
    await saveLoginState({ environmentId, organizationId }, sessionState('127.0.0.1', port));

    const result = await playwrightService.executeTestSequence(
      {
        id: 1,
        userId,
        organizationId,
        projectId: null,
        name: 'already-signed-in',
        url: baseUrl,
        sequence: [
          {
            id: 's1',
            action: {
              id: 'assertTextContains',
              type: 'assertTextContains',
              name: 'Assert signed in',
              icon: 'check',
              description: 'x',
            },
            targetElement: {
              id: 'e1',
              type: 'heading',
              selector: '#state',
              text: '',
              tag: 'h1',
              attributes: {},
            },
            value: 'Signed in as svc-tester',
          },
        ],
        elements: [],
        preconditions: null,
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
        module: null,
        featureArea: null,
        scenario: null,
        component: null,
        priority: 'Medium',
        severity: 'Major',
      } as never,
      userId,
      undefined,
      undefined,
      undefined,
      { environmentId, organizationId },
    );

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
    expect(result.success).toBe(true);
  }, 60_000);

  it('still runs unauthenticated when the environment has no saved session', async () => {
    const { playwrightService } = await import('./playwright-service');
    const environmentId = await makeEnvironment();

    const result = await playwrightService.executeTestSequence(
      {
        id: 2,
        userId,
        organizationId,
        projectId: null,
        name: 'not-signed-in',
        url: baseUrl,
        sequence: [
          {
            id: 's1',
            action: {
              id: 'assertTextContains',
              type: 'assertTextContains',
              name: 'Assert signed out',
              icon: 'check',
              description: 'x',
            },
            targetElement: {
              id: 'e1',
              type: 'heading',
              selector: '#state',
              text: '',
              tag: 'h1',
              attributes: {},
            },
            value: 'Please sign in',
          },
        ],
        elements: [],
        preconditions: null,
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
        module: null,
        featureArea: null,
        scenario: null,
        component: null,
        priority: 'Medium',
        severity: 'Major',
      } as never,
      userId,
      undefined,
      undefined,
      undefined,
      { environmentId, organizationId },
    );

    expect(result.success).toBe(true);
  }, 60_000);
});

describe('capturing a login state from a recording session', () => {
  it('takes the session out of the live recording browser', async () => {
    const { playwrightService } = await import('./playwright-service');
    const environmentId = await makeEnvironment('Capture env');

    const started = await playwrightService.startRecordingSession(baseUrl, userId);
    expect(started.success).toBe(true);

    try {
      // Stand in for the tester signing in inside the recorder window: what matters to the
      // capture is that the context now holds a session cookie, not how it got one.
      await playwrightService.withRecordingContext(started.sessionId!, async (context) => {
        await context.addCookies([
          {
            name: 'wfm_session',
            value: 'valid-token',
            domain: '127.0.0.1',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax',
          },
        ]);
      });

      const saved = await playwrightService.captureLoginState(started.sessionId!, {
        environmentId,
        organizationId,
      });
      expect(saved).toBe(true);

      const loaded = await loadLoginState({ environmentId, organizationId });
      expect(JSON.stringify(loaded?.cookies)).toContain('valid-token');
    } finally {
      await playwrightService.stopRecordingSession(started.sessionId!, userId).catch(() => {});
    }
  }, 90_000);

  it('reports an unknown session rather than saving an empty state', async () => {
    const { playwrightService } = await import('./playwright-service');
    const environmentId = await makeEnvironment('No session env');

    const saved = await playwrightService.captureLoginState('no-such-session', {
      environmentId,
      organizationId,
    });

    expect(saved).toBe(false);
    expect(await loadLoginState({ environmentId, organizationId })).toBeUndefined();
  }, 30_000);
});
