import { Queue, QueueEvents } from 'bullmq';
import { eq } from 'drizzle-orm';
import { tests } from '@shared/schema';
import { playwrightService, type AdhocSequencePayload } from './playwright-service';
import { resolveVariables } from './variables';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { getCorrelationId } from './middleware/correlation';
import { connection } from './redis';

/**
 * The browser work a person waits for — a preview of a sequence, a single test run, a page
 * loaded or surveyed for its elements — run where the browsers are.
 *
 * These ran inside the web server. A browser is hundreds of megabytes and seconds of CPU, so
 * three people previewing at once slowed every page of the application for everyone, and one
 * browser that hung held a request, a connection and its memory until the process was restarted.
 * Plan runs already went to the worker; these are the rest.
 *
 * They stay request and response: the route submits the task and waits for its answer, so the
 * pages that call them need not change. What moves is where the browser runs.
 *
 * Recording is not here and cannot be: it opens a visible window on the machine the server runs
 * on and keeps the live session in that process's memory between requests.
 */

export const BROWSER_TASK_QUEUE_NAME = 'browser-tasks';

export type BrowserTask =
  | { kind: 'adhoc-sequence'; payload: Omit<AdhocSequencePayload, 'organizationId'> }
  | { kind: 'run-test'; testId: number; environmentId: number | null }
  | { kind: 'load-website'; url: string }
  | { kind: 'detect-elements'; url: string };

/**
 * A task and who it is for. The organization comes from the session that asked, never from the
 * task's own fields, so a job cannot name a tenant whose environment it would resolve.
 *
 * Nothing secret travels in it: the environment is named by id and resolved by whoever runs the
 * task, so decrypted values never sit in Redis.
 */
export interface BrowserTaskEnvelope {
  task: BrowserTask;
  userId: number;
  organizationId: number;
  correlationId?: string;
}

export type BrowserTaskFailureCode = 'no_worker' | 'timed_out' | 'queue_unavailable';

/** Why a task got no answer — distinct from a task that ran and failed, which is its answer. */
export class BrowserTaskError extends Error {
  constructor(
    readonly code: BrowserTaskFailureCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BrowserTaskError';
  }
}

/** Runs a task here, in this process. What the worker calls, and what inline mode calls. */
export async function performBrowserTask(envelope: BrowserTaskEnvelope): Promise<unknown> {
  const { task, userId, organizationId } = envelope;
  return runWithTenant(organizationId, async () => {
    switch (task.kind) {
      case 'adhoc-sequence':
        return playwrightService.executeAdhocSequence({ ...task.payload, organizationId }, userId);
      case 'load-website':
        return playwrightService.loadWebsite(task.url, userId);
      case 'detect-elements':
        return playwrightService.detectElements(task.url, userId);
      case 'run-test': {
        // Under RLS: another organization's test is not found, as it was in the route.
        const [test] = await withTenantTransaction((tx) =>
          tx.select().from(tests).where(eq(tests.id, task.testId)).limit(1),
        );
        if (!test) throw new Error(`Test ${task.testId} not found`);
        const vars = await resolveVariables({ userId, organizationId, environmentId: task.environmentId });
        return playwrightService.executeTestSequence(
          test,
          userId,
          undefined,
          undefined,
          vars,
          // The environment that supplies the variables supplies the saved login too.
          task.environmentId ? { environmentId: task.environmentId, organizationId } : undefined,
        );
      }
      default: {
        const unknown: never = task;
        throw new Error(`Unknown browser task ${(unknown as { kind?: string }).kind}`);
      }
    }
  });
}

/** Where tasks run: 'worker' in production; 'inline' keeps them in the web process. */
export type BrowserTaskMode = 'worker' | 'inline';

export function browserTaskMode(env: NodeJS.ProcessEnv = process.env): BrowserTaskMode {
  if (env.BROWSER_TASKS === 'inline' || env.BROWSER_TASKS === 'worker') return env.BROWSER_TASKS;
  // Tests drive the routes without a worker; everything else has one, as plan runs need it.
  return env.NODE_ENV === 'test' ? 'inline' : 'worker';
}

/** Longest a person waits for a task before being told it did not come back. */
export const BROWSER_TASK_TIMEOUT_MS = Number(process.env.BROWSER_TASK_TIMEOUT_MS) || 5 * 60_000;

export interface BrowserTaskQueuePort {
  add(name: string, data: BrowserTaskEnvelope, options: Record<string, unknown>): Promise<{ id?: string; waitUntilFinished(events: any, ttl?: number): Promise<unknown> }>;
  getWorkersCount(): Promise<number>;
}

export interface BrowserTaskRunnerDeps {
  mode: BrowserTaskMode;
  /** Built on first use, so a process in inline mode never opens a Redis connection for this. */
  queue?: () => BrowserTaskQueuePort;
  events?: () => unknown;
  timeoutMs?: number;
  perform?: (envelope: BrowserTaskEnvelope) => Promise<unknown>;
  /** How long a "there is a worker" answer is trusted, so every preview does not ask Redis. */
  workerCheckTtlMs?: number;
  now?: () => number;
}

export function createBrowserTaskRunner(deps: BrowserTaskRunnerDeps) {
  const perform = deps.perform ?? performBrowserTask;
  const timeoutMs = deps.timeoutMs ?? BROWSER_TASK_TIMEOUT_MS;
  const ttl = deps.workerCheckTtlMs ?? 5_000;
  const now = deps.now ?? Date.now;
  let workersSeenAt = -Infinity;

  async function assertWorker(queue: BrowserTaskQueuePort) {
    if (now() - workersSeenAt < ttl) return;
    let count: number;
    try {
      count = await queue.getWorkersCount();
    } catch (error: any) {
      throw new BrowserTaskError('queue_unavailable', `The task queue is not reachable: ${error?.message ?? error}`, 503);
    }
    if (count === 0) {
      // Said now rather than after five minutes of a spinner: a task nobody will pick up is the
      // one failure worth reporting before it is submitted.
      throw new BrowserTaskError(
        'no_worker',
        'No worker is running to open a browser. Start one (npm run dev:worker), or set BROWSER_TASKS=inline to run browsers in the web server.',
        503,
      );
    }
    workersSeenAt = now();
  }

  async function run<T = unknown>(envelope: BrowserTaskEnvelope): Promise<T> {
    const withCorrelation = { ...envelope, correlationId: envelope.correlationId ?? getCorrelationId() ?? undefined };
    if (deps.mode === 'inline') return (await perform(withCorrelation)) as T;

    const queue = deps.queue!();
    await assertWorker(queue);
    const job = await queue.add(envelope.task.kind, withCorrelation, {
      // Nobody is waiting for a retry of a preview: the person sees the failure and runs it again.
      attempts: 1,
      // Kept a minute for the answer to be collected, then gone: results carry screenshots.
      removeOnComplete: { age: 60 },
      removeOnFail: { age: 3600 },
    });
    try {
      return (await job.waitUntilFinished(deps.events!(), timeoutMs)) as T;
    } catch (error: any) {
      if (/timed out/i.test(String(error?.message))) {
        throw new BrowserTaskError('timed_out', `The browser did not finish within ${Math.round(timeoutMs / 1000)} seconds.`, 504);
      }
      // The task ran and threw: its own error, as the route reported it when it ran here.
      throw error;
    }
  }

  return { run };
}

let queue: Queue | undefined;
let events: QueueEvents | undefined;

/** The runner the routes use. The queue and its event stream are opened on the first task. */
export const browserTasks = createBrowserTaskRunner({
  mode: browserTaskMode(),
  queue: () => {
    queue ??= new Queue(BROWSER_TASK_QUEUE_NAME, { connection });
    return queue as unknown as BrowserTaskQueuePort;
  },
  events: () => {
    // Its own connection: it blocks reading the stream of finished jobs.
    events ??= new QueueEvents(BROWSER_TASK_QUEUE_NAME, { connection: connection.duplicate() });
    return events;
  },
});

/** Closes what this module opened, for a graceful shutdown. */
export async function closeBrowserTasks(): Promise<void> {
  await events?.close().catch(() => {});
  await queue?.close().catch(() => {});
}
