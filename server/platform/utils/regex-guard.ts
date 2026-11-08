/**
 * Runs a user-written regular expression with a hard time budget.
 *
 * V8 matches with backtracking, and static checks cannot catch every catastrophic pattern. So the
 * match runs in a reusable worker thread while the caller waits synchronously (Atomics.wait) for
 * at most `timeoutMs`; on timeout the worker is terminated (a new one starts on the next call) and
 * RegexTimeoutError is thrown. The worker is unref'd, so it never keeps the process alive.
 */
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';

export const REGEX_TIMEOUT_MS = 100;
const STARTUP_TIMEOUT_MS = 5_000;

export class RegexTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`regex timed out after ${timeoutMs} ms`);
    this.name = 'RegexTimeoutError';
  }
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const flag = new Int32Array(workerData.shared);
const out = workerData.port;
parentPort.on('message', (m) => {
  let result;
  try {
    const re = new RegExp(m.source, m.flags);
    if (m.mode === 'test') result = { ok: true, value: re.test(m.text) };
    else {
      const r = re.exec(m.text);
      result = { ok: true, value: r ? { groups: Array.from(r), index: r.index } : null };
    }
  } catch (e) {
    result = { ok: false, error: String((e && e.message) || e) };
  }
  out.postMessage(result);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
Atomics.store(flag, 1, 1);
Atomics.notify(flag, 1);
`;

interface Runner {
  worker: Worker;
  flag: Int32Array;
  port: MessagePort;
}
let runner: Runner | null = null;

function stop(r: Runner): void {
  void r.worker.terminate();
  r.port.close();
  if (runner === r) runner = null;
}

function getRunner(): Runner {
  if (runner) return runner;
  const flag = new Int32Array(new SharedArrayBuffer(8));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { shared: flag.buffer, port: port2 },
    transferList: [port2],
  });
  worker.unref();
  worker.on('error', () => {});
  const r: Runner = { worker, flag, port: port1 };
  if (Atomics.wait(flag, 1, 0, STARTUP_TIMEOUT_MS) === 'timed-out') {
    stop(r);
    throw new Error('the regex worker did not start');
  }
  runner = r;
  return r;
}

type Raw = { ok: true; value: unknown } | { ok: false; error: string };

function run(mode: 'test' | 'exec', source: string, flags: string, text: string, ms: number) {
  const r = getRunner();
  Atomics.store(r.flag, 0, 0);
  r.worker.postMessage({ mode, source, flags, text });
  if (Atomics.wait(r.flag, 0, 0, ms) === 'timed-out') {
    stop(r);
    throw new RegexTimeoutError(ms);
  }
  const msg = receiveMessageOnPort(r.port)?.message as Raw | undefined;
  if (!msg) throw new Error('the regex worker returned no result');
  if (!msg.ok) throw new Error(msg.error);
  return msg.value;
}

export interface GuardMatch {
  groups: (string | undefined)[];
  index: number;
}

/** `new RegExp(source, flags).test(text)` within the time budget. */
export function guardedTest(
  source: string,
  flags: string,
  text: string,
  opts: { timeoutMs?: number } = {},
): boolean {
  return run('test', source, flags, text, opts.timeoutMs ?? REGEX_TIMEOUT_MS) as boolean;
}

/** `new RegExp(source, flags).exec(text)` within the time budget. */
export function guardedMatch(
  source: string,
  flags: string,
  text: string,
  opts: { timeoutMs?: number } = {},
): GuardMatch | null {
  return run('exec', source, flags, text, opts.timeoutMs ?? REGEX_TIMEOUT_MS) as GuardMatch | null;
}
