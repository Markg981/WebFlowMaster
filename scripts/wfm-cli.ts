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
 * It speaks /api/v1 only, the API that promises to stay put and the only one a key with scopes
 * opens. It has no imports on purpose: the server hands out its own build of it at /cli/wfm.mjs,
 * so a pipeline downloads the CLI that matches the server it talks to and needs nothing else.
 *
 * Exit codes are the interface:
 *   0  the run passed
 *   1  the run finished and something in it failed
 *   2  the command could not be carried out (bad usage, no credentials, no server)
 */

export const EXIT_PASSED = 0;
export const EXIT_RUN_FAILED = 1;
export const EXIT_TOOL_ERROR = 2;

type Command = 'run' | 'status' | 'junit' | 'export' | 'help';

export interface CliOptions {
  command: Command;
  target?: string;
  baseUrl?: string;
  apiKey?: string;
  wait: boolean;
  timeoutSeconds: number;
  pollSeconds: number;
  junitPath?: string;
  htmlPath?: string;
  pdfPath?: string;
  allurePath?: string;
  environmentId?: number;
  updateBaselines: boolean;
  json: boolean;
  idempotencyKey?: string;
  /** Send the build, commit and branch read from the CI's environment. On unless --no-ci. */
  ci: boolean;
}

export interface CliIo {
  fetchImpl: typeof fetch;
  writeFile: (path: string, contents: string | Uint8Array) => Promise<void>;
  appendFile: (path: string, contents: string) => Promise<void>;
  log: (line: string) => void;
  error: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  env: Record<string, string | undefined>;
}

export const USAGE = `wfm — run WebFlowMaster test plans from a pipeline

Usage:
  wfm run <planId> [--wait] [--junit <file>] [--html <file>] [--pdf <file>] [--allure <file>]
                   [--environment <id>] [--update-baselines]
  wfm status <runId>
  wfm junit <runId> [--junit <file>]
  wfm export <runId> [--html <file>] [--pdf <file>] [--allure <file>]

Options:
  --url <url>            Server base URL (default: $WFM_URL)
  --key <key>            API key (default: $WFM_API_KEY). Needs runs:write to start a run, runs:read to read one.
  --wait                 Wait for the run to finish and exit non-zero if it failed
  --timeout <seconds>    How long to wait before giving up (default: 1800)
  --poll <seconds>       How often to ask whether it has finished (default: 5)
  --junit <file>         Write the run's JUnit XML here once it has finished
  --html <file>          Write the self-contained HTML report here once it has finished
  --pdf <file>           Write the PDF report here once it has finished
  --allure <file>        Write a zip of Allure results here once it has finished
  --environment <id>     Run against this environment
  --update-baselines     Accept this run's screenshots as the new visual baselines
  --idempotency-key <k>  Start at most one run for this key (default: $WFM_IDEMPOTENCY_KEY).
                         Pass the build id, and a re-run of the same step follows the run
                         it already started instead of starting another.
  --no-ci                Do not send the build, commit and branch read from the CI's environment
  --json                 Print the final run as JSON

On GitHub Actions it also sets the step outputs run-id, status and report-url, and writes a
summary of the run to the job's page.

Exit codes: 0 passed · 1 the run failed · 2 the command could not be carried out
`;

const defaults = (command: Command): CliOptions => ({
  command,
  wait: false,
  timeoutSeconds: 1800,
  pollSeconds: 5,
  updateBaselines: false,
  json: false,
  ci: true,
});

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions | { error: string } {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') return defaults('help');
  if (command !== 'run' && command !== 'status' && command !== 'junit' && command !== 'export') {
    return { error: `Unknown command "${command}".` };
  }

  const options: CliOptions = {
    ...defaults(command),
    baseUrl: env.WFM_URL,
    apiKey: env.WFM_API_KEY,
    idempotencyKey: env.WFM_IDEMPOTENCY_KEY || undefined,
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
      case '--no-ci': options.ci = false; break;
      case '--junit': options.junitPath = value(); break;
      case '--html': options.htmlPath = value(); break;
      case '--pdf': options.pdfPath = value(); break;
      case '--allure': options.allurePath = value(); break;
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
  if (options.command === 'export' && !options.htmlPath && !options.pdfPath && !options.allurePath) {
    return { error: 'export needs at least one of --html, --pdf or --allure.' };
  }
  // A report means knowing how the run ended, which means waiting for it.
  if (options.command === 'run' && (options.junitPath || options.htmlPath || options.pdfPath || options.allurePath)) {
    options.wait = true;
  }
  return options;
}

/**
 * A run is over when its status stops being one of these.
 *
 * Kept in step with IN_FLIGHT_EXECUTION_STATUSES in shared/execution-status.ts, written out here
 * because this script has no imports on purpose. A state missing from this list is not a
 * cosmetic slip: `queued` was, and a run that had only just been accepted looked finished, so the
 * pipeline reported before a single test had run.
 */
const IN_PROGRESS = new Set(['queued', 'pending', 'running', 'cancelling']);

/** A run as /api/v1 describes it, as far as this reads it. */
export interface RunRecord {
  id: string;
  status: string;
  planName?: string | null;
  durationMs?: number | null;
  tests?: {
    total?: number | null;
    passed?: number | null;
    failed?: number | null;
    skipped?: number | null;
    /** Failures of tests in quarantine: in the failed count, not in the verdict or the exit code. */
    quarantinedFailures?: number | null;
  };
  failure?: { code: string; message?: string | null } | null;
  links?: { report?: string | null };
}

/** The build, commit and branch, as /api/v1 takes them (shared/ci.ts has the server's rules). */
export interface CiContext {
  provider: 'github' | 'gitlab' | 'jenkins' | 'azure' | 'bitbucket' | 'circleci' | 'other';
  repository?: string;
  commit?: string;
  branch?: string;
  pullRequest?: string;
  buildId?: string;
  buildUrl?: string;
  actor?: string;
}

/**
 * Where this pipeline is, read from the variables each CI system sets on every job.
 *
 * Cleaned to what the server accepts, field by field: a value it would refuse is dropped rather
 * than sent. The context is a courtesy to whoever reads the report, and must never be the reason
 * a run did not start.
 */
export function detectCi(env: Record<string, string | undefined>): CiContext | undefined {
  const v = (name: string) => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };
  let raw: CiContext | undefined;

  if (v('GITHUB_ACTIONS') === 'true') {
    const repository = v('GITHUB_REPOSITORY');
    const runId = v('GITHUB_RUN_ID');
    const attempt = v('GITHUB_RUN_ATTEMPT');
    const pr = /^refs\/pull\/(\d+)\//.exec(v('GITHUB_REF') ?? '')?.[1];
    raw = {
      provider: 'github',
      repository,
      commit: v('GITHUB_SHA'),
      branch: v('GITHUB_HEAD_REF') ?? v('GITHUB_REF_NAME'),
      pullRequest: pr,
      buildId: runId ? `${runId}${attempt && attempt !== '1' ? `.${attempt}` : ''}` : undefined,
      buildUrl:
        repository && runId
          ? `${v('GITHUB_SERVER_URL') ?? 'https://github.com'}/${repository}/actions/runs/${runId}${attempt && attempt !== '1' ? `/attempts/${attempt}` : ''}`
          : undefined,
      actor: v('GITHUB_ACTOR'),
    };
  } else if (v('GITLAB_CI')) {
    raw = {
      provider: 'gitlab',
      repository: v('CI_PROJECT_PATH'),
      commit: v('CI_COMMIT_SHA'),
      branch: v('CI_MERGE_REQUEST_SOURCE_BRANCH_NAME') ?? v('CI_COMMIT_REF_NAME'),
      pullRequest: v('CI_MERGE_REQUEST_IID'),
      buildId: v('CI_PIPELINE_ID'),
      buildUrl: v('CI_PIPELINE_URL') ?? v('CI_JOB_URL'),
      actor: v('GITLAB_USER_LOGIN'),
    };
  } else if (v('TF_BUILD')?.toLowerCase() === 'true') {
    const collection = v('SYSTEM_COLLECTIONURI');
    const project = v('SYSTEM_TEAMPROJECT');
    const buildId = v('BUILD_BUILDID');
    raw = {
      provider: 'azure',
      repository: v('BUILD_REPOSITORY_NAME'),
      commit: v('BUILD_SOURCEVERSION'),
      branch: (v('SYSTEM_PULLREQUEST_SOURCEBRANCH') ?? v('BUILD_SOURCEBRANCH'))?.replace(/^refs\/heads\//, ''),
      pullRequest: v('SYSTEM_PULLREQUEST_PULLREQUESTNUMBER') ?? v('SYSTEM_PULLREQUEST_PULLREQUESTID'),
      buildId: v('BUILD_BUILDNUMBER') ?? buildId,
      buildUrl:
        collection && project && buildId
          ? `${collection.replace(/\/?$/, '/')}${encodeURIComponent(project)}/_build/results?buildId=${encodeURIComponent(buildId)}`
          : undefined,
      actor: v('BUILD_REQUESTEDFOR'),
    };
  } else if (v('BITBUCKET_BUILD_NUMBER')) {
    const repository = v('BITBUCKET_REPO_FULL_NAME');
    const number = v('BITBUCKET_BUILD_NUMBER');
    raw = {
      provider: 'bitbucket',
      repository,
      commit: v('BITBUCKET_COMMIT'),
      branch: v('BITBUCKET_BRANCH'),
      pullRequest: v('BITBUCKET_PR_ID'),
      buildId: number,
      buildUrl: repository && number ? `https://bitbucket.org/${repository}/pipelines/results/${number}` : undefined,
    };
  } else if (v('CIRCLECI') === 'true') {
    const owner = v('CIRCLE_PROJECT_USERNAME');
    const name = v('CIRCLE_PROJECT_REPONAME');
    raw = {
      provider: 'circleci',
      repository: owner && name ? `${owner}/${name}` : undefined,
      commit: v('CIRCLE_SHA1'),
      branch: v('CIRCLE_BRANCH'),
      pullRequest: v('CIRCLE_PR_NUMBER'),
      buildId: v('CIRCLE_BUILD_NUM'),
      buildUrl: v('CIRCLE_BUILD_URL'),
      actor: v('CIRCLE_USERNAME'),
    };
  } else if (v('JENKINS_URL')) {
    // Last: a Jenkins agent is sometimes a container that inherited other systems' variables.
    const job = v('JOB_NAME');
    const number = v('BUILD_NUMBER');
    raw = {
      provider: 'jenkins',
      repository: v('GIT_URL')?.replace(/^[a-z]+:\/\/[^@/]*@/i, 'https://').replace(/\.git$/, ''),
      commit: v('GIT_COMMIT'),
      branch: v('CHANGE_BRANCH') ?? v('BRANCH_NAME') ?? v('GIT_BRANCH')?.replace(/^origin\//, ''),
      pullRequest: v('CHANGE_ID'),
      buildId: job && number ? `${job} #${number}` : number,
      buildUrl: v('BUILD_URL'),
      actor: v('BUILD_USER_ID'),
    };
  }
  return raw ? cleanCi(raw) : undefined;
}

function cleanCi(raw: CiContext): CiContext {
  const clip = (value: string | undefined, max: number) => (value ? value.slice(0, max) : undefined);
  const ci: CiContext = {
    provider: raw.provider,
    repository: clip(raw.repository, 300),
    commit: raw.commit && /^[0-9a-f]{7,64}$/i.test(raw.commit) ? raw.commit : undefined,
    branch: clip(raw.branch, 300),
    pullRequest: clip(raw.pullRequest, 50),
    buildId: clip(raw.buildId, 200),
    buildUrl: raw.buildUrl && /^https?:\/\/\S+$/i.test(raw.buildUrl) && raw.buildUrl.length <= 2000 ? raw.buildUrl : undefined,
    actor: clip(raw.actor, 200),
  };
  // An absent field is left out, not sent as undefined or empty.
  return Object.fromEntries(Object.entries(ci).filter(([, value]) => value !== undefined && value !== '')) as unknown as CiContext;
}

type Call = (path: string, init?: RequestInit) => Promise<Response>;

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

  const call: Call = async (path, init = {}) =>
    io.fetchImpl(`${options.baseUrl!.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        'X-API-Key': options.apiKey!,
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    });

  try {
    if (options.command === 'junit') {
      return await download(io, call, options.target!, 'junit', options.junitPath ?? `junit-${options.target}.xml`);
    }
    if (options.command === 'export') {
      return await writeReports(options, io, call, options.target!);
    }

    let runId = options.target!;
    if (options.command === 'run') {
      const ci = options.ci ? detectCi(io.env) : undefined;
      const response = await call(`/api/v1/plans/${encodeURIComponent(options.target!)}/runs`, {
        method: 'POST',
        ...(options.idempotencyKey ? { headers: { 'Idempotency-Key': options.idempotencyKey } } : {}),
        body: JSON.stringify({
          ...(options.environmentId !== undefined ? { environmentId: options.environmentId } : {}),
          ...(options.updateBaselines ? { updateBaselines: true } : {}),
          ...(ci ? { ci } : {}),
        }),
      });
      if (!response.ok) {
        io.error(`Could not start the plan: ${response.status} ${await errorText(response)}`);
        return EXIT_TOOL_ERROR;
      }
      const started: RunRecord = await response.json();
      runId = started?.id;
      if (!runId) {
        io.error('The server started a run but did not say which one.');
        return EXIT_TOOL_ERROR;
      }
      io.log(`Started run ${runId}${ci ? ` for ${ci.repository ?? ci.provider}${ci.commit ? `@${ci.commit.slice(0, 7)}` : ''}` : ''}.`);
      await githubOutputs(io, { id: runId, status: started.status, links: started.links });
      if (!options.wait) return EXIT_PASSED;
    }

    const run = await waitForRun(runId, options, io, call);
    if (!run) {
      io.error(`Timed out after ${options.timeoutSeconds}s waiting for run ${runId}.`);
      return EXIT_TOOL_ERROR;
    }

    // Written whether the run passed or not: a failed run is when they are read.
    if (options.junitPath) {
      const written = await download(io, call, runId, 'junit', options.junitPath);
      if (written !== EXIT_PASSED) return written;
    }
    const reports = await writeReports(options, io, call, runId);
    if (reports !== EXIT_PASSED) return reports;

    if (options.json) io.log(JSON.stringify(run, null, 2));
    else io.log(describeRun(run));

    if (IN_PROGRESS.has(run.status)) return EXIT_PASSED;
    const passed = run.status === 'completed';
    await githubOutputs(io, run);
    await githubSummary(io, run);
    if (!passed && io.env.GITHUB_ACTIONS === 'true') {
      // An annotation on the job, so the failure is on the page the build fails on.
      io.log(`::error title=WebFlowMaster::${describeRun(run).replace(/[\r\n%]/g, ' ')}`);
    }
    return passed ? EXIT_PASSED : EXIT_RUN_FAILED;
  } catch (error: any) {
    io.error(`Could not reach ${options.baseUrl}: ${error?.message ?? String(error)}`);
    return EXIT_TOOL_ERROR;
  }
}

async function waitForRun(runId: string, options: CliOptions, io: CliIo, call: Call): Promise<RunRecord | null> {
  const deadline = io.now() + options.timeoutSeconds * 1000;
  let lastStatus: string | undefined;

  for (;;) {
    const response = await call(`/api/v1/runs/${encodeURIComponent(runId)}`);
    if (response.status === 404) throw new Error(`Run ${runId} not found.`);
    if (!response.ok) throw new Error(`Asking about the run failed: ${response.status} ${await errorText(response)}`);
    const run: RunRecord = await response.json();

    if (run.status !== lastStatus) {
      lastStatus = run.status;
      io.log(`Run ${runId}: ${run.status}`);
    }
    // `status` alone decides. A run is over when the worker says it is, not when the counts
    // look complete: a plan can legitimately finish with fewer results than tests.
    if (!IN_PROGRESS.has(run.status) || options.command === 'status') return run;
    if (io.now() >= deadline) return null;
    await io.sleep(options.pollSeconds * 1000);
  }
}

async function download(io: CliIo, call: Call, runId: string, what: 'junit' | 'html' | 'pdf' | 'allure', target: string): Promise<number> {
  const path =
    what === 'junit' ? `/api/v1/runs/${encodeURIComponent(runId)}/junit` : `/api/v1/runs/${encodeURIComponent(runId)}/export/${what}`;
  const response = await call(path);
  if (!response.ok) {
    io.error(`Could not fetch the ${what === 'junit' ? 'JUnit' : what.toUpperCase()} report: ${response.status} ${await errorText(response)}`);
    return EXIT_TOOL_ERROR;
  }
  const contents = what === 'junit' || what === 'html' ? await response.text() : new Uint8Array(await response.arrayBuffer());
  await io.writeFile(target, contents);
  io.log(`Wrote ${target}.`);
  return EXIT_PASSED;
}

async function writeReports(options: CliOptions, io: CliIo, call: Call, runId: string): Promise<number> {
  const wanted: Array<['html' | 'pdf' | 'allure', string | undefined]> = [
    ['html', options.htmlPath],
    ['pdf', options.pdfPath],
    ['allure', options.allurePath],
  ];
  for (const [format, target] of wanted) {
    if (!target) continue;
    const written = await download(io, call, runId, format, target);
    if (written !== EXIT_PASSED) return written;
  }
  return EXIT_PASSED;
}

/** Step outputs a later step can use: `steps.<id>.outputs.report-url`. Only on GitHub Actions. */
async function githubOutputs(io: CliIo, run: Pick<RunRecord, 'id' | 'status' | 'links'>): Promise<void> {
  const file = io.env.GITHUB_OUTPUT;
  if (io.env.GITHUB_ACTIONS !== 'true' || !file) return;
  const lines = [`run-id=${run.id}`, `status=${run.status}`, `report-url=${run.links?.report ?? ''}`];
  await io.appendFile(file, lines.join('\n') + '\n');
}

/** The run on the job's summary page. Only on GitHub Actions. */
async function githubSummary(io: CliIo, run: RunRecord): Promise<void> {
  const file = io.env.GITHUB_STEP_SUMMARY;
  if (io.env.GITHUB_ACTIONS !== 'true' || !file) return;
  await io.appendFile(file, markdownSummary(run));
}

export function markdownSummary(run: RunRecord): string {
  const passed = run.status === 'completed';
  const t = run.tests ?? {};
  const cell = (value: number | null | undefined) => String(value ?? 0);
  const title = `${passed ? '✅' : '❌'} ${run.planName ?? 'Test plan'}: ${passed ? 'passed' : run.status.replace('_', ' ')}`;
  return [
    `### ${title}`,
    '',
    '| Tests | Passed | Failed | Skipped | Duration |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${cell(t.total)} | ${cell(t.passed)} | ${cell(t.failed)}${t.quarantinedFailures ? ` (${t.quarantinedFailures} in quarantine)` : ''} | ${cell(t.skipped)} | ${typeof run.durationMs === 'number' ? `${(run.durationMs / 1000).toFixed(1)} s` : '—'} |`,
    '',
    ...(run.failure?.message ? [`> ${run.failure.message}`, ''] : []),
    run.links?.report ? `[Open the report](${run.links.report}) · run \`${run.id}\`` : `Run \`${run.id}\``,
    '',
  ].join('\n');
}

export function describeRun(run: RunRecord): string {
  const t = run.tests ?? {};
  const counts =
    typeof t.total === 'number' && t.total > 0
      ? `${t.passed ?? 0}/${t.total} passed` +
        (t.failed ? `, ${t.failed} failed` : '') +
        (t.quarantinedFailures ? ` (${t.quarantinedFailures} in quarantine)` : '') +
        (t.skipped ? `, ${t.skipped} skipped` : '')
      : 'no tests ran';
  const duration = typeof run.durationMs === 'number' ? ` in ${(run.durationMs / 1000).toFixed(1)}s` : '';
  const name = run.planName ? `${run.planName}: ` : '';
  const link = run.links?.report ? ` — ${run.links.report}` : '';
  return `${name}${run.status} — ${counts}${duration}${link}`;
}

/** /api/v1 errors are `{ error: { code, message } }`; anything else is shown as it came. */
async function errorText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) return `${parsed.error.code ? `${parsed.error.code}: ` : ''}${parsed.error.message}`;
    } catch {
      /* not JSON */
    }
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

/* c8 ignore start — the process wrapper; everything it calls is tested directly. */
export async function main(argv: string[]): Promise<number> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error(USAGE);
    return EXIT_TOOL_ERROR;
  }
  return runCli(parsed, {
    fetchImpl: fetch,
    writeFile: async (file, contents) => {
      await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
      await fs.writeFile(file, contents);
    },
    appendFile: (file, contents) => fs.appendFile(file, contents, 'utf8'),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    env: process.env,
  });
}

// Only when run as a program, never when imported by a test.
if (process.argv[1] && /wfm(-cli)?(\.m?[tj]s)?$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
/* c8 ignore stop */
