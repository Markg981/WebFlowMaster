import type { Redis } from 'ioredis';
import { FLOW_ACTION_IDS } from '@shared/flow';
import {
  DEBUG_IDLE_TIMEOUT_MS,
  type DebugCommand,
  type DebugPause,
  type DebugState,
  type DebugStepPatch,
  type DebugStepRecord,
  type PauseReason,
} from '@shared/debug-session';

/**
 * The two halves of a debug session (shared/debug-session.ts) and what joins them.
 *
 * The browser runs where the preview runs — in the worker, usually — and the person is on the
 * web server. Neither calls the other: the web server writes commands into the session's channel
 * and reads its state from it; the runner, between steps, reads the commands and writes its
 * state. In the web process (BROWSER_TASKS=inline, and the tests) the channel is memory; with a
 * worker it is Redis, which both already share.
 */

export interface DebugSessionMeta {
  userId: number;
  organizationId: number;
  createdAt: string;
}

export interface DebugChannel {
  open(id: string, meta: DebugSessionMeta): Promise<void>;
  meta(id: string): Promise<DebugSessionMeta | null>;
  publish(id: string, state: DebugState): Promise<void>;
  read(id: string): Promise<DebugState | null>;
  send(id: string, command: DebugCommand): Promise<void>;
  /** Every command waiting, without waiting for one. */
  drain(id: string): Promise<DebugCommand[]>;
  /** The next command, waiting for it up to `ms`; null when none came. */
  next(id: string, ms: number): Promise<DebugCommand | null>;
  /** The session a user has open, so starting another can close it. */
  activeFor(userId: number): Promise<string | null>;
  setActive(userId: number, id: string | null): Promise<void>;
}

export function memoryDebugChannel(): DebugChannel {
  const metas = new Map<string, DebugSessionMeta>();
  const states = new Map<string, DebugState>();
  const queues = new Map<string, DebugCommand[]>();
  const waiters = new Map<string, (command: DebugCommand | null) => void>();
  const active = new Map<number, string>();
  return {
    async open(id, meta) {
      metas.set(id, meta);
      queues.set(id, []);
    },
    async meta(id) {
      return metas.get(id) ?? null;
    },
    async publish(id, state) {
      states.set(id, state);
    },
    async read(id) {
      return states.get(id) ?? null;
    },
    async send(id, command) {
      const waiter = waiters.get(id);
      if (waiter) {
        waiters.delete(id);
        waiter(command);
        return;
      }
      (queues.get(id) ?? queues.set(id, []).get(id)!).push(command);
    },
    async drain(id) {
      const waiting = queues.get(id) ?? [];
      queues.set(id, []);
      return waiting;
    },
    next(id, ms) {
      const waiting = queues.get(id) ?? [];
      if (waiting.length > 0) return Promise.resolve(waiting.shift()!);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(id);
          resolve(null);
        }, ms);
        waiters.set(id, (command) => {
          clearTimeout(timer);
          resolve(command);
        });
      });
    },
    async activeFor(userId) {
      return active.get(userId) ?? null;
    },
    async setActive(userId, id) {
      if (id) active.set(userId, id);
      else active.delete(userId);
    },
  };
}

/** Kept an hour past its last write: long enough for any session, short enough to clean itself. */
const REDIS_TTL_SECONDS = 3600;

export function redisDebugChannel(redis: Redis): DebugChannel {
  const key = (id: string, part: string) => `debug:${id}:${part}`;
  const parse = <T>(raw: string | null): T | null => {
    try {
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  };
  return {
    async open(id, meta) {
      await redis.set(key(id, 'meta'), JSON.stringify(meta), 'EX', REDIS_TTL_SECONDS);
    },
    async meta(id) {
      return parse<DebugSessionMeta>(await redis.get(key(id, 'meta')));
    },
    async publish(id, state) {
      await redis.set(key(id, 'state'), JSON.stringify(state), 'EX', REDIS_TTL_SECONDS);
    },
    async read(id) {
      return parse<DebugState>(await redis.get(key(id, 'state')));
    },
    async send(id, command) {
      await redis.rpush(key(id, 'commands'), JSON.stringify(command));
      await redis.expire(key(id, 'commands'), REDIS_TTL_SECONDS);
    },
    async drain(id) {
      const commands: DebugCommand[] = [];
      for (;;) {
        const command = parse<DebugCommand>(await redis.lpop(key(id, 'commands')));
        if (!command) return commands;
        commands.push(command);
      }
    },
    async next(id, ms) {
      // Its own connection: BLPOP holds the one it runs on until a command comes, and a paused
      // session waits at human speed.
      const blocking = redis.duplicate();
      try {
        const popped = await blocking.blpop(key(id, 'commands'), Math.max(1, Math.ceil(ms / 1000)));
        return popped ? parse<DebugCommand>(popped[1]) : null;
      } finally {
        blocking.disconnect();
      }
    },
    async activeFor(userId) {
      return redis.get(`debug:user:${userId}`);
    },
    async setActive(userId, id) {
      if (id) await redis.set(`debug:user:${userId}`, id, 'EX', REDIS_TTL_SECONDS);
      else await redis.del(`debug:user:${userId}`);
    },
  };
}

/** The part of a sequence step the session reads and corrects. */
export interface DebugStep {
  id?: string;
  calledFrom?: string;
  action?: { id?: string; name?: string } | null;
  targetElement?: { selector?: string } | null;
  value?: unknown;
}

export interface DebugStepContext<S extends DebugStep = DebugStep> {
  pc: number;
  step: S;
  /** Takes a picture of the page as it is now, or null. */
  screenshot: () => Promise<string | null>;
  url: () => string | null;
}

export type DebugDecision<S extends DebugStep = DebugStep> =
  | { kind: 'run'; step: S; corrected: boolean }
  | { kind: 'skip' }
  | { kind: 'stop'; reason: string };

/** What the runner asks the session between steps (server/playwright-service.ts). */
export interface DebugHooks {
  /** The run's variables, handed over once the run has them, and read as they change. */
  watch(vars: Record<string, string>): void;
  beforeStep<S extends DebugStep>(context: DebugStepContext<S>): Promise<DebugDecision<S>>;
  afterFailure<S extends DebugStep>(context: DebugStepContext<S> & { error: string }): Promise<DebugDecision<S>>;
  record(record: DebugStepRecord): Promise<void>;
  finish(outcome: { success: boolean; error: string | null }): Promise<void>;
}

/** A step with the correction made to it; the step itself is left as it was. */
export function applyPatch<S extends DebugStep>(step: S, patch: DebugStepPatch | undefined): { step: S; corrected: boolean } {
  if (!patch) return { step, corrected: false };
  let corrected = false;
  let next: S = step;
  if (typeof patch.selector === 'string' && patch.selector.trim() && patch.selector.trim() !== step.targetElement?.selector) {
    next = { ...next, targetElement: { ...(step.targetElement ?? {}), selector: patch.selector.trim() } };
    corrected = true;
  }
  if (typeof patch.value === 'string' && patch.value !== (step.value ?? '')) {
    next = { ...next, value: patch.value };
    corrected = true;
  }
  return { step: next, corrected };
}

export const canSkipStep = (actionId: string | undefined) => !actionId || !FLOW_ACTION_IDS.has(actionId);

export interface DebugControllerOptions {
  breakpoints: string[];
  /** The names that came from the environment: their values are secrets, and are not shown. */
  environmentKeys: Iterable<string>;
  idleTimeoutMs?: number;
  now?: () => Date;
}

/**
 * The runner's half: decides, before each step and after a failure, whether to go on, and waits
 * for the person when not.
 */
export class DebugController implements DebugHooks {
  private readonly breakpoints: Set<string>;
  private readonly environmentKeys: Set<string>;
  private readonly idleTimeoutMs: number;
  private readonly now: () => Date;
  private stepping = false;
  private pauseAsked = false;
  private stopAsked = false;
  private previousCall: string | null = null;
  private steps: DebugStepRecord[] = [];
  private skipped = 0;
  private status: DebugState['status'] = 'running';
  private paused: DebugPause | null = null;
  private vars: Record<string, string> = {};

  constructor(
    readonly id: string,
    private readonly channel: DebugChannel,
    private readonly options: DebugControllerOptions,
  ) {
    this.breakpoints = new Set(options.breakpoints);
    this.environmentKeys = new Set(options.environmentKeys);
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEBUG_IDLE_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  private snapshot(outcome: DebugState['outcome'] = null): DebugState {
    return {
      id: this.id,
      status: this.status,
      paused: this.paused,
      steps: this.steps,
      variables: Object.entries(this.vars).map(([name, value]) => ({
        name,
        value: this.environmentKeys.has(name) ? null : String(value),
      })),
      breakpoints: [...this.breakpoints],
      outcome,
      updatedAt: this.now().toISOString(),
    };
  }

  watch(vars: Record<string, string>): void {
    this.vars = vars;
  }

  private publish(outcome: DebugState['outcome'] = null) {
    return this.channel.publish(this.id, this.snapshot(outcome));
  }

  /** Applies what came in while the steps were running: breakpoints, a pause, a stop. */
  private absorb(command: DebugCommand) {
    if (command.type === 'breakpoints') {
      this.breakpoints.clear();
      for (const id of command.breakpoints ?? []) this.breakpoints.add(id);
    } else if (command.type === 'pause') {
      this.pauseAsked = true;
    } else if (command.type === 'stop') {
      this.stopAsked = true;
    }
  }

  private pauseReason(step: DebugStep): PauseReason | null {
    const call = step.calledFrom ?? null;
    const enteringCall = call !== null && call !== this.previousCall;
    this.previousCall = call;
    if (this.pauseAsked) return 'pause';
    if (this.stepping) return 'step';
    if (step.id && this.breakpoints.has(step.id)) return 'breakpoint';
    // A breakpoint on a group call stops at the group's first step.
    if (enteringCall && this.breakpoints.has(call!)) return 'breakpoint';
    return null;
  }

  async beforeStep<S extends DebugStep>(context: DebugStepContext<S>): Promise<DebugDecision<S>> {
    for (const command of await this.channel.drain(this.id)) this.absorb(command);
    if (this.stopAsked) return { kind: 'stop', reason: 'Stopped while debugging.' };
    const reason = this.pauseReason(context.step);
    if (!reason) return { kind: 'run', step: context.step, corrected: false };
    return this.waitAt(context, reason, null);
  }

  async afterFailure<S extends DebugStep>(context: DebugStepContext<S> & { error: string }): Promise<DebugDecision<S>> {
    for (const command of await this.channel.drain(this.id)) this.absorb(command);
    if (this.stopAsked) return { kind: 'stop', reason: 'Stopped while debugging.' };
    return this.waitAt(context, 'failure', context.error);
  }

  private async waitAt<S extends DebugStep>(context: DebugStepContext<S>, reason: PauseReason, error: string | null): Promise<DebugDecision<S>> {
    const { step } = context;
    const actionId = step.action?.id ?? 'unknown';
    this.pauseAsked = false;
    this.status = 'paused';
    this.paused = {
      pc: context.pc,
      stepId: step.id ?? null,
      calledFrom: step.calledFrom ?? null,
      name: step.action?.name ?? actionId,
      actionId,
      reason,
      error,
      selector: step.targetElement?.selector ?? null,
      value: step.value === undefined || step.value === null ? null : String(step.value),
      canSkip: canSkipStep(step.action?.id),
      screenshot: await context.screenshot().catch(() => null),
      url: context.url(),
    };
    await this.publish();

    for (;;) {
      const command = await this.channel.next(this.id, this.idleTimeoutMs);
      if (!command) return this.resume({ kind: 'stop', reason: `Stopped after ${Math.round(this.idleTimeoutMs / 60_000)} minutes without a command.` });
      if (command.type === 'breakpoints') {
        this.absorb(command);
        await this.publish();
        continue;
      }
      if (command.type === 'stop') return this.resume({ kind: 'stop', reason: 'Stopped while debugging.' });
      if (command.type === 'skip' && this.paused.canSkip) {
        this.skipped += 1;
        return this.resume({ kind: 'skip' });
      }
      const failed = reason === 'failure';
      if ((failed && command.type === 'retry') || (!failed && (command.type === 'continue' || command.type === 'step'))) {
        this.stepping = command.type === 'step' || (failed && this.stepping);
        const { step: next, corrected } = applyPatch(step, command.patch);
        return this.resume({ kind: 'run', step: next, corrected });
      }
      // Anything else does not apply here — the web server refuses it before it is sent.
    }
  }

  private async resume<S extends DebugStep>(decision: DebugDecision<S>): Promise<DebugDecision<S>> {
    this.status = 'running';
    this.paused = null;
    await this.publish();
    return decision;
  }

  async record(record: DebugStepRecord): Promise<void> {
    this.steps = [...this.steps, record];
    await this.publish();
  }

  async finish(outcome: { success: boolean; error: string | null }): Promise<void> {
    this.status = this.stopAsked || /^Stopped/.test(outcome.error ?? '') ? 'stopped' : 'finished';
    this.paused = null;
    // A run that passed over a step has not shown the test passes.
    await this.publish({ success: outcome.success && this.skipped === 0, error: outcome.error, skipped: this.skipped });
  }

  /** The run could not be carried out at all. */
  async fail(message: string): Promise<void> {
    this.status = 'error';
    this.paused = null;
    await this.publish({ success: false, error: message, skipped: this.skipped });
  }
}

let defaultChannel: Promise<DebugChannel> | undefined;

/** The channel this process uses: Redis when browsers run in a worker, memory when they run here. */
export function debugChannel(): Promise<DebugChannel> {
  // The promise, not its value: two first callers at once must get the same channel.
  defaultChannel ??= (async () => {
    const { browserTaskMode } = await import('./browser-tasks');
    if (browserTaskMode() === 'inline') return memoryDebugChannel();
    const { connection } = await import('./redis');
    return redisDebugChannel(connection);
  })();
  return defaultChannel;
}
