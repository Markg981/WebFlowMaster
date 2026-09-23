import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

/**
 * Browser work a person waits for, submitted to the worker and answered like a request.
 *
 * The queue is a fake: what is under test is the contract around it — nothing is submitted when
 * no worker would pick it up, a task that does not come back is reported as such, and the worker
 * side resolves secrets itself rather than receiving them.
 */

const executeTestSequence = vi.fn();
vi.mock('./playwright-service', () => ({
  playwrightService: {
    executeTestSequence: (...args: any[]) => executeTestSequence(...args),
    executeAdhocSequence: vi.fn(async (payload: any) => ({ success: true, echoed: payload })),
    loadWebsite: vi.fn(async (url: string) => ({ success: true, html: `<html>${url}</html>` })),
    detectElements: vi.fn(async () => ({ elements: [], screenshot: undefined, summary: {} })),
  },
}));

const { privilegedDb } = await import('./db');
const { environments, secrets, tests, users } = await import('@shared/schema');
const { createTestOrganization } = await import('./tests/factories');
const { encryptSecret } = await import('./crypto');
const {
  BrowserTaskError,
  browserTaskMode,
  createBrowserTaskRunner,
  performBrowserTask,
} = await import('./browser-tasks');

const envelope = { task: { kind: 'load-website' as const, url: 'https://example.test' }, userId: 1, organizationId: 1 };

function fakeQueue(workers: number, answer: () => Promise<unknown> = async () => ({ success: true })) {
  const added: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];
  const queue = {
    added,
    getWorkersCount: vi.fn(async () => workers),
    add: vi.fn(async (name: string, data: unknown, options: Record<string, unknown>) => {
      added.push({ name, data, options });
      return { id: 'job-1', waitUntilFinished: vi.fn(answer) };
    }),
  };
  return queue;
}

describe('browserTaskMode', () => {
  it('sends tasks to the worker unless told otherwise, and keeps them here under test', () => {
    expect(browserTaskMode({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('worker');
    expect(browserTaskMode({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('worker');
    expect(browserTaskMode({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('inline');
    expect(browserTaskMode({ NODE_ENV: 'production', BROWSER_TASKS: 'inline' } as NodeJS.ProcessEnv)).toBe('inline');
    expect(browserTaskMode({ NODE_ENV: 'test', BROWSER_TASKS: 'worker' } as NodeJS.ProcessEnv)).toBe('worker');
  });
});

describe('a task sent to the worker', () => {
  it('is submitted once, not retried, and answered with what the worker returned', async () => {
    const queue = fakeQueue(1, async () => ({ success: true, html: '<html/>' }));
    const runner = createBrowserTaskRunner({ mode: 'worker', queue: () => queue, events: () => ({}) });

    const answer = await runner.run(envelope);

    expect(answer).toEqual({ success: true, html: '<html/>' });
    expect(queue.added).toEqual([
      expect.objectContaining({ name: 'load-website', data: expect.objectContaining(envelope), options: expect.objectContaining({ attempts: 1 }) }),
    ]);
  });

  it('is not submitted when no worker is running, and says how to start one', async () => {
    const queue = fakeQueue(0);
    const runner = createBrowserTaskRunner({ mode: 'worker', queue: () => queue, events: () => ({}) });

    const failure = await runner.run(envelope).catch((error) => error);

    expect(failure).toBeInstanceOf(BrowserTaskError);
    expect(failure).toMatchObject({ code: 'no_worker', status: 503 });
    expect(failure.message).toMatch(/dev:worker/);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('asks whether a worker is running at most once in a while', async () => {
    let clock = 0;
    const queue = fakeQueue(1);
    const runner = createBrowserTaskRunner({ mode: 'worker', queue: () => queue, events: () => ({}), workerCheckTtlMs: 5_000, now: () => clock });

    await runner.run(envelope);
    clock = 1_000;
    await runner.run(envelope);
    clock = 10_000;
    await runner.run(envelope);

    expect(queue.getWorkersCount).toHaveBeenCalledTimes(2);
  });

  it('reports a task that did not come back in time as a timeout, not as its failure', async () => {
    const queue = fakeQueue(1, async () => {
      throw new Error('Job wait load-website timed out before finishing, no finish notification arrived after 10ms (id=job-1)');
    });
    const runner = createBrowserTaskRunner({ mode: 'worker', queue: () => queue, events: () => ({}), timeoutMs: 10 });

    await expect(runner.run(envelope)).rejects.toMatchObject({ code: 'timed_out', status: 504 });
  });

  it("passes on a task's own failure as it is", async () => {
    const queue = fakeQueue(1, async () => {
      throw new Error('net::ERR_NAME_NOT_RESOLVED');
    });
    const runner = createBrowserTaskRunner({ mode: 'worker', queue: () => queue, events: () => ({}) });

    const failure = await runner.run(envelope).catch((error) => error);
    expect(failure).not.toBeInstanceOf(BrowserTaskError);
    expect(failure.message).toBe('net::ERR_NAME_NOT_RESOLVED');
  });

  it('says the queue is unreachable when it cannot even ask', async () => {
    const queue = fakeQueue(1);
    queue.getWorkersCount.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const runner = createBrowserTaskRunner({ mode: 'worker', queue: () => queue, events: () => ({}) });

    await expect(runner.run(envelope)).rejects.toMatchObject({ code: 'queue_unavailable', status: 503 });
  });
});

describe('a task run here', () => {
  it('runs in this process without touching a queue', async () => {
    const perform = vi.fn(async () => 'done');
    const queue = vi.fn();
    const runner = createBrowserTaskRunner({ mode: 'inline', perform, queue: queue as any });

    expect(await runner.run(envelope)).toBe('done');
    expect(perform).toHaveBeenCalledWith(expect.objectContaining(envelope));
    expect(queue).not.toHaveBeenCalled();
  });
});

describe('performBrowserTask, where the browser runs', () => {
  let organizationId: number;
  let userId: number;

  beforeEach(async () => {
    executeTestSequence.mockReset();
    executeTestSequence.mockResolvedValue({ success: true, steps: [] });
    organizationId = await createTestOrganization(`Tasks ${uuidv4().slice(0, 6)}`);
    const [user] = await privilegedDb
      .insert(users)
      .values({ username: `tasks-${uuidv4().slice(0, 8)}`, password: 'x', organizationId })
      .returning();
    userId = user.id;
  });

  async function insertTest(orgId: number, ownerId: number) {
    const [test] = await privilegedDb
      .insert(tests)
      .values({ userId: ownerId, organizationId: orgId, name: 'Login', url: 'https://example.test/{{path}}', sequence: [], elements: [] })
      .returning();
    return test;
  }

  it("runs a saved test with its environment's secrets, resolved here rather than sent in the job", async () => {
    const test = await insertTest(organizationId, userId);
    const [environment] = await privilegedDb
      .insert(environments)
      .values({ name: `env-${uuidv4().slice(0, 8)}`, userId, organizationId })
      .returning();
    const sealed = encryptSecret('login');
    await privilegedDb.insert(secrets).values({
      environmentId: environment.id,
      organizationId,
      userId,
      keyName: 'path',
      encryptedValue: sealed.encryptedValue,
      iv: sealed.iv,
      authTag: sealed.authTag,
    } as any);

    await performBrowserTask({ task: { kind: 'run-test', testId: test.id, environmentId: environment.id }, userId, organizationId });

    const [ranTest, ranBy, , , vars, scope] = executeTestSequence.mock.calls[0];
    expect(ranTest.id).toBe(test.id);
    expect(ranBy).toBe(userId);
    expect(vars.path).toBe('login');
    expect(scope).toEqual({ environmentId: environment.id, organizationId });
  });

  it("does not run another organization's test", async () => {
    const otherOrganizationId = await createTestOrganization(`Other ${uuidv4().slice(0, 6)}`);
    const [stranger] = await privilegedDb
      .insert(users)
      .values({ username: `stranger-${uuidv4().slice(0, 8)}`, password: 'x', organizationId: otherOrganizationId })
      .returning();
    const theirs = await insertTest(otherOrganizationId, stranger.id);

    await expect(
      performBrowserTask({ task: { kind: 'run-test', testId: theirs.id, environmentId: null }, userId, organizationId }),
    ).rejects.toThrow(/not found/);
    expect(executeTestSequence).not.toHaveBeenCalled();
  });

  it("gives an ad-hoc preview the session's organization, whatever the payload says", async () => {
    const answer = (await performBrowserTask({
      task: { kind: 'adhoc-sequence', payload: { url: 'https://example.test', sequence: [], elements: [], organizationId: 999 } as any },
      userId,
      organizationId,
    })) as { echoed: { organizationId: number } };

    expect(answer.echoed.organizationId).toBe(organizationId);
  });
});
