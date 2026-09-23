/**
 * The command a pipeline actually runs.
 *
 * Everything needed to run a plan from CI existed as HTTP endpoints and nothing tied them
 * together: a build step had to POST a run, learn its id from the response body, poll an
 * endpoint it had to know about, decide for itself what counts as a failure, and fetch a
 * report in a format it could publish. Every team would have written the same hundred lines
 * of shell, slightly differently, and each one would have got the exit code wrong in its own
 * way — the failure mode that matters, because a pipeline step that exits 0 on a failed test
 * run is worse than no pipeline step.
 *
 * Exit codes are the interface:
 *   0  the run passed
 *   1  the run finished and something in it failed
 *   2  the command could not be carried out (bad usage, no credentials, no server)
 */

export const EXIT_PASSED = 0;
export const EXIT_RUN_FAILED = 1;
export const EXIT_TOOL_ERROR = 2;

export interface CliOptions {
  command: 'run' | 'status' | 'junit' | 'help';
  target?: string;
  baseUrl?: string;
  apiKey?: string;
  wait: boolean;
  timeoutSeconds: number;
  pollSeconds: number;
  junitPath?: string;
  environmentId?: number;
  updateBaselines: boolean;
  json: boolean;
  idempotencyKey?: string;
}

export interface CliIo {
  fetchImpl: typeof fetch;
  writeFile: (path: string, contents: string) => Promise<void>;
  log: (line: string) => void;
  error: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const USAGE = `wfm — run WebFlowMaster test plans from a pipeline

Usage:
  wfm run <planId> [--wait] [--junit <file>] [--environment <id>] [--update-baselines]
  wfm status <executionId>
  wfm junit <executionId> [--junit <file>]

Options:
  --url <url>            Server base URL (default: $WFM_URL)
  --key <key>            API key (default: $WFM_API_KEY)
  --wait                 Wait for the run to finish and exit non-zero if it failed
  --timeout <seconds>    How long to wait before giving up (default: 1800)
  --poll <seconds>       How often to ask whether it has finished (default: 5)
  --junit <file>         Write the run's JUnit XML here once it has finished
  --environment <id>     Run against this environment
  --update-baselines     Accept this run's screenshots as the new visual baselines
  --idempotency-key <k>  Start at most one run for this key (default: $WFM_IDEMPOTENCY_KEY).
                         Pass the build id, and a re-run of the same step follows the run
                         it already started instead of starting another.
  --json                 Print the final execution record as JSON

Exit codes: 0 passed · 1 the run failed · 2 the command could not be carried out
`;

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions | { error: string } {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return {
      command: 'help',
      wait: false,
      timeoutSeconds: 1800,
      pollSeconds: 5,
      updateBaselines: false,
      json: false,
    };
  }
  if (command !== 'run' && command !== 'status' && command !== 'junit') {
    return { error: `Unknown command "${command}".` };
  }

  const options: CliOptions = {
    command,
    baseUrl: env.WFM_URL,
    apiKey: env.WFM_API_KEY,
    idempotencyKey: env.WFM_IDEMPOTENCY_KEY || undefined,
    wait: false,
    timeoutSeconds: 1800,
    pollSeconds: 5,
    updateBaselines: false,
    json: false,
  };

  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const argument = rest[i];
    const value = () => rest[++i];
    switch (argument) {
      case '--url': options.baseUrl = value(); break;
      case '--key': options.apiKey = value(); break;
      case '--wait': options.wait = true; break;
      case '--update-baselines': options.updateBaselines = true; break;
      case '--json': options.json = true; break;
      case '--junit': options.junitPath = value(); break;
      case '--timeout': options.timeoutSeconds = Number(value()); break;
      case '--poll': options.pollSeconds = Number(value()); break;
      case '--environment': options.environmentId = Number(value()); break;
      case '--idempotency-key': options.idempotencyKey = value(); break;
      default:
        if (argument.startsWith('-')) return { error: `Unknown option "${argument}".` };
        positional.push(argument);
    }
  }

  options.target = positional[0];
  if (!options.target) return { error: `${command} needs an id. See --help.` };
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
    return { error: '--timeout must be a positive number of seconds.' };
  }
  if (!Number.isFinite(options.pollSeconds) || options.pollSeconds <= 0) {
    return { error: '--poll must be a positive number of seconds.' };
  }
  if (options.environmentId !== undefined && !Number.isFinite(options.environmentId)) {
    return { error: '--environment must be an environment id.' };
  }
  if (options.idempotencyKey !== undefined && !options.idempotencyKey.trim()) {
    return { error: '--idempotency-key needs a value.' };
  }
  // Writing a JUnit file means knowing how the run ended, which means waiting for it.
  if (options.command === 'run' && options.junitPath) options.wait = true;
  return options;
}

/**
 * A run is over when its status stops being one of these.
 *
 * Kept in step with IN_FLIGHT_EXECUTION_STATUSES in shared/execution-status.ts, written out here
 * because this script has no imports on purpose — it is copied into pipelines on its own. A state
 * missing from this list is not a cosmetic slip: `queued` was, and a run that had only just been
 * accepted looked finished, so the pipeline reported before a single test had run.
 *
 * `pending` stays for servers that have not run migration 0021 yet.
 */
const IN_PROGRESS = new Set(['queued', 'pending', 'running', 'cancelling']);

interface ExecutionRecord {
  id: string;
  status: string;
  testPlanName?: string | null;
  totalTests?: number | null;
  passedTests?: number | null;
  failedTests?: number | null;
  skippedTests?: number | null;
  /** Failures of tests in quarantine: in the failed count, not in the verdict or the exit code. */
  quarantinedFailures?: number | null;
  executionDurationMs?: number | null;
  browsers?: unknown;
}

export async function runCli(options: CliOptions, io: CliIo): Promise<number> {
  if (options.command === 'help') {
    io.log(USAGE);
    return EXIT_PASSED;
  }
  if (!options.baseUrl) {
    io.error('No server URL. Pass --url or set WFM_URL.');
    return EXIT_TOOL_ERROR;
  }
  if (!options.apiKey) {
    io.error('No API key. Pass --key or set WFM_API_KEY.');
    return EXIT_TOOL_ERROR;
  }

  const call = async (path: string, init: RequestInit = {}) => {
    const response = await io.fetchImpl(`${options.baseUrl!.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        'X-API-Key': options.apiKey!,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return response;
  };

  try {
    if (options.command === 'junit') {
      return await writeJUnit(options, io, call, options.target!);
    }

    let executionId = options.target!;
    if (options.command === 'run') {
      const response = await call(`/api/run-test-plan/${encodeURIComponent(options.target!)}`, {
        method: 'POST',
        ...(options.idempotencyKey ? { headers: { 'Idempotency-Key': options.idempotencyKey } } : {}),
        body: JSON.stringify({
          environmentId: options.environmentId,
          updateBaselines: options.updateBaselines,
        }),
      });
      if (!response.ok) {
        io.error(`Could not start the plan: ${response.status} ${await safeText(response)}`);
        return EXIT_TOOL_ERROR;
      }
      const body = await response.json();
      executionId = body?.data?.id;
      if (!executionId) {
        io.error('The server started a run but did not say which one.');
        return EXIT_TOOL_ERROR;
      }
      io.log(`Started run ${executionId}.`);
      if (!options.wait) return EXIT_PASSED;
    }

    const execution = options.wait || options.command === 'status'
      ? await waitForRun(executionId, options, io, call)
      : null;
    if (!execution) {
      io.error(`Timed out after ${options.timeoutSeconds}s waiting for run ${executionId}.`);
      return EXIT_TOOL_ERROR;
    }

    if (options.junitPath) {
      const written = await writeJUnit(options, io, call, executionId);
      if (written !== EXIT_PASSED) return written;
    }

    if (options.json) io.log(JSON.stringify(execution, null, 2));
    else io.log(describeRun(execution));

    if (IN_PROGRESS.has(execution.status)) return EXIT_PASSED;
    return execution.status === 'completed' ? EXIT_PASSED : EXIT_RUN_FAILED;
  } catch (error: any) {
    io.error(`Could not reach ${options.baseUrl}: ${error?.message ?? String(error)}`);
    return EXIT_TOOL_ERROR;
  }
}

async function waitForRun(
  executionId: string,
  options: CliOptions,
  io: CliIo,
  call: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<ExecutionRecord | null> {
  const deadline = io.now() + options.timeoutSeconds * 1000;
  let lastStatus: string | undefined;

  for (;;) {
    const response = await call(`/api/test-plan-executions/${encodeURIComponent(executionId)}`);
    if (response.status === 404) throw new Error(`Run ${executionId} not found.`);
    if (!response.ok) throw new Error(`Asking about the run failed: ${response.status}`);
    const execution: ExecutionRecord = await response.json();

    if (execution.status !== lastStatus) {
      lastStatus = execution.status;
      io.log(`Run ${executionId}: ${execution.status}`);
    }
    // `status` alone decides. A run is over when the worker says it is, not when the counts
    // look complete: a plan can legitimately finish with fewer results than tests.
    if (!IN_PROGRESS.has(execution.status) || options.command === 'status') return execution;
    if (io.now() >= deadline) return null;
    await io.sleep(options.pollSeconds * 1000);
  }
}

async function writeJUnit(
  options: CliOptions,
  io: CliIo,
  call: (path: string, init?: RequestInit) => Promise<Response>,
  executionId: string,
): Promise<number> {
  const response = await call(`/api/test-plan-executions/${encodeURIComponent(executionId)}/junit`);
  if (!response.ok) {
    io.error(`Could not fetch the JUnit report: ${response.status} ${await safeText(response)}`);
    return EXIT_TOOL_ERROR;
  }
  const xml = await response.text();
  const target = options.junitPath ?? `junit-${executionId}.xml`;
  await io.writeFile(target, xml);
  io.log(`Wrote ${target}.`);
  return EXIT_PASSED;
}

export function describeRun(execution: ExecutionRecord): string {
  const counts =
    typeof execution.totalTests === 'number' && execution.totalTests > 0
      ? `${execution.passedTests ?? 0}/${execution.totalTests} passed` +
        (execution.failedTests ? `, ${execution.failedTests} failed` : '') +
        (execution.quarantinedFailures ? ` (${execution.quarantinedFailures} in quarantine)` : '') +
        (execution.skippedTests ? `, ${execution.skippedTests} skipped` : '')
      : 'no tests ran';
  const duration =
    typeof execution.executionDurationMs === 'number'
      ? ` in ${(execution.executionDurationMs / 1000).toFixed(1)}s`
      : '';
  const name = execution.testPlanName ? `${execution.testPlanName}: ` : '';
  return `${name}${execution.status} — ${counts}${duration}`;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/* c8 ignore start — the process wrapper; everything it calls is tested directly. */
export async function main(argv: string[]): Promise<number> {
  const fs = await import('node:fs/promises');
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error(USAGE);
    return EXIT_TOOL_ERROR;
  }
  return runCli(parsed, {
    fetchImpl: fetch,
    writeFile: (path, contents) => fs.writeFile(path, contents, 'utf8'),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  });
}

// Only when run as a program, never when imported by a test.
if (process.argv[1] && /wfm(-cli)?(\.[tj]s)?$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
/* c8 ignore stop */
