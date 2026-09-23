import fs from 'node:fs';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { desc, eq, lt } from 'drizzle-orm';
import playwright from 'playwright';
import { runners, type Runner } from '@shared/schema';
import { privilegedDb } from './db';

/**
 * The worker processes that run plans, as they describe themselves.
 *
 * A worker registers when it starts, reports in every RUNNER_HEARTBEAT_INTERVAL_MS with how many
 * jobs it has, and hears back whether it should be taking new ones. That last part is draining:
 * an operator about to upgrade a machine drains its runner, waits for the running count to reach
 * zero, and stops it without cutting a run in half.
 *
 * Installation-wide and outside RLS (a runner serves every organization), so everything here is
 * on the privileged handle. Nothing here reads a run: what an owner is shown is machines, never
 * another organization's work.
 */

export const RUNNER_HEARTBEAT_INTERVAL_MS = Number(process.env.RUNNER_HEARTBEAT_INTERVAL_MS) || 15_000;
/** Not heard from for this long: offline. Three missed heartbeats, by default. */
export const RUNNER_OFFLINE_AFTER_MS = Number(process.env.RUNNER_OFFLINE_AFTER_MS) || RUNNER_HEARTBEAT_INTERVAL_MS * 3;
/** Gone this long: removed from the list. Its runs keep its id. */
const RUNNER_FORGET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type RunnerStatus = 'online' | 'draining' | 'offline';

/** This process's runner id, once it registered. Stamped on every run it takes. */
let thisRunnerId: string | null = null;

export function currentRunnerId(): string | null {
  return thisRunnerId;
}

/** Which of the three engines this machine can actually start. */
export function installedBrowsers(): string[] {
  const found: string[] = [];
  for (const engine of ['chromium', 'firefox', 'webkit'] as const) {
    try {
      const executable = playwright[engine].executablePath();
      if (executable && fs.existsSync(executable)) found.push(engine);
    } catch {
      // Not installed for this Playwright version.
    }
  }
  return found;
}

export interface RunnerDescription {
  concurrency: number;
  browserTaskConcurrency: number;
  version?: string | null;
  browsers?: string[];
}

/** Registers this process as a runner. Called once, when the worker starts. */
export async function registerRunner(description: RunnerDescription): Promise<string> {
  const hostname = os.hostname();
  const id = `${hostname}:${process.pid}:${randomBytes(2).toString('hex')}`;
  await privilegedDb.insert(runners).values({
    id,
    hostname,
    pid: process.pid,
    version: description.version ?? process.env.APP_VERSION ?? process.env.npm_package_version ?? null,
    concurrency: description.concurrency,
    browserTaskConcurrency: description.browserTaskConcurrency,
    browsers: description.browsers ?? installedBrowsers(),
  });
  thisRunnerId = id;
  return id;
}

/**
 * Reports in, and answers what the runner is being asked to be. Null when the row is gone — an
 * operator removed it, or it was forgotten after a long absence — in which case the worker
 * registers again.
 */
export async function runnerHeartbeat(id: string, activeJobs: number): Promise<'active' | 'drain' | null> {
  const [row] = await privilegedDb
    .update(runners)
    .set({ lastSeenAt: new Date(), activeJobs, stoppedAt: null })
    .where(eq(runners.id, id))
    .returning();
  return row?.desiredState ?? null;
}

/** A clean shutdown: offline at once, rather than after three missed heartbeats. */
export async function markRunnerStopped(id: string): Promise<void> {
  await privilegedDb.update(runners).set({ stoppedAt: new Date(), activeJobs: 0 }).where(eq(runners.id, id));
}

export function statusOf(runner: Pick<Runner, 'lastSeenAt' | 'stoppedAt' | 'desiredState'>, now = Date.now()): RunnerStatus {
  if (runner.stoppedAt || now - runner.lastSeenAt.getTime() > RUNNER_OFFLINE_AFTER_MS) return 'offline';
  return runner.desiredState === 'drain' ? 'draining' : 'online';
}

export async function listRunners(now = Date.now()) {
  // Forgotten, not just offline: a row from a container replaced a week ago is noise.
  await privilegedDb.delete(runners).where(lt(runners.lastSeenAt, new Date(now - RUNNER_FORGET_AFTER_MS)));
  const rows = await privilegedDb.select().from(runners).orderBy(desc(runners.lastSeenAt));
  return rows.map((row) => {
    const status = statusOf(row, now);
    return { ...row, status, activeJobs: status === 'offline' ? 0 : row.activeJobs };
  });
}

/** How many runners can take a plan run right now. Zero means every new run will wait. */
export async function availableRunnerCount(now = Date.now()): Promise<number> {
  const rows = await privilegedDb.select().from(runners);
  return rows.filter((row) => statusOf(row, now) === 'online').length;
}

export async function setRunnerDesiredState(id: string, desiredState: 'active' | 'drain'): Promise<Runner | null> {
  const [row] = await privilegedDb.update(runners).set({ desiredState }).where(eq(runners.id, id)).returning();
  return row ?? null;
}

/** What a runner pauses when drained: BullMQ workers, in practice. */
export interface PausableQueue {
  pause(doNotWaitActive?: boolean): Promise<void>;
  resume(): void;
}

/**
 * The worker's side of the registry: registers, reports in on a timer, and pauses or resumes its
 * queues as it is asked. Paused, the jobs in hand run to their end — only new ones stop coming —
 * so the operator watching the job count reach zero can stop the machine without cutting a run in
 * half.
 */
export class RunnerAgent {
  private id: string | null = null;
  private draining = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      description: RunnerDescription;
      queues: PausableQueue[];
      activeJobs: () => number;
      log?: (message: string) => void;
    },
  ) {}

  get runnerId(): string | null {
    return this.id;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /** Registers, before the queues are listened to, so the first run taken already names it. */
  async register(): Promise<string> {
    this.id = await registerRunner(this.options.description);
    return this.id;
  }

  start(intervalMs = RUNNER_HEARTBEAT_INTERVAL_MS): void {
    this.timer = setInterval(() => void this.tick().catch((e) => this.options.log?.(`Runner heartbeat failed: ${e?.message ?? e}`)), intervalMs);
    void this.tick().catch((e) => this.options.log?.(`Runner heartbeat failed: ${e?.message ?? e}`));
  }

  /** One report: say how busy, hear what to be. */
  async tick(): Promise<void> {
    if (!this.id) await this.register();
    const activeJobs = this.options.activeJobs();
    let desired = await runnerHeartbeat(this.id!, activeJobs);
    if (desired === null) {
      // The row is gone (forgotten after a long silence, or removed): register again.
      await this.register();
      this.options.log?.(`Runner row was missing; registered again as ${this.id}`);
      desired = 'active';
    }
    if (desired === 'drain' && !this.draining) {
      this.draining = true;
      // true: do not wait for the jobs in hand; they finish on their own, nothing new starts.
      await Promise.all(this.options.queues.map((queue) => queue.pause(true)));
      this.options.log?.(`Runner ${this.id} draining: ${activeJobs} job(s) still running, taking no new ones.`);
    } else if (desired === 'active' && this.draining) {
      this.draining = false;
      this.options.queues.forEach((queue) => queue.resume());
      this.options.log?.(`Runner ${this.id} resumed.`);
    }
  }

  /** A clean shutdown: stop reporting, and go offline at once. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.id) await markRunnerStopped(this.id).catch(() => {});
  }
}

/** Test seam: the process-wide id, reset between tests. */
export function resetCurrentRunner(): void {
  thisRunnerId = null;
}
