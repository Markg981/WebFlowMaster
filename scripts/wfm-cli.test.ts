import { describe, it, expect, vi } from 'vitest';
import {
  EXIT_PASSED,
  EXIT_RUN_FAILED,
  EXIT_TOOL_ERROR,
  describeRun,
  detectCi,
  markdownSummary,
  parseArgs,
  runCli,
  type CliIo,
  type CliOptions,
} from './wfm-cli';

/**
 * The command a pipeline runs. Its exit code is its interface: a step that exits 0 on a failed
 * run is worse than no step at all, so most of what follows is about that number. The rest is
 * about what it tells the build: where the run came from, and where its reports are.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as unknown as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

function io(fetchImpl: ReturnType<typeof vi.fn>, env: Record<string, string> = {}) {
  const lines: string[] = [];
  const errors: string[] = [];
  const files = new Map<string, string | Uint8Array>();
  const appended = new Map<string, string>();
  let clock = 0;
  const context: CliIo & { lines: string[]; errors: string[]; files: typeof files; appended: typeof appended } = {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    writeFile: async (path, contents) => {
      files.set(path, contents);
    },
    appendFile: async (path, contents) => {
      appended.set(path, (appended.get(path) ?? '') + contents);
    },
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
    // Time only moves when the CLI waits, so a test never actually waits.
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    env,
    lines,
    errors,
    files,
    appended,
  };
  return context;
}

const options = (overrides: Partial<CliOptions> = {}): CliOptions => ({
  command: 'run',
  target: 'plan-1',
  baseUrl: 'https://wfm.test',
  apiKey: 'wfm_key',
  wait: false,
  timeoutSeconds: 60,
  pollSeconds: 1,
  updateBaselines: false,
  json: false,
  ci: true,
  ...overrides,
});

const started = (id = 'run-1') => jsonResponse({ id, status: 'queued', links: { report: `https://wfm.test/r/${id}` } }, 202);
const run = (status: string, tests: Record<string, number> = {}, extra: Record<string, unknown> = {}) =>
  jsonResponse({ id: 'run-1', status, planName: 'Nightly', tests, durationMs: 12_000, links: { report: 'https://wfm.test/r/run-1' }, ...extra });

describe('parseArgs', () => {
  it('reads a run command and its options', () => {
    const parsed = parseArgs(['run', 'plan-1', '--wait', '--environment', '4', '--timeout', '90'], {} as NodeJS.ProcessEnv);
    expect(parsed).toMatchObject({ command: 'run', target: 'plan-1', wait: true, environmentId: 4, timeoutSeconds: 90, ci: true });
  });

  it('takes the server and the key from the environment, as a pipeline supplies them', () => {
    const parsed = parseArgs(['status', 'run-1'], { WFM_URL: 'https://ci.test', WFM_API_KEY: 'wfm_abc' } as NodeJS.ProcessEnv);
    expect(parsed).toMatchObject({ baseUrl: 'https://ci.test', apiKey: 'wfm_abc' });
  });

  it('waits when asked for any report, because none can be written before the run ends', () => {
    for (const flag of ['--junit', '--html', '--pdf', '--allure']) {
      expect((parseArgs(['run', 'plan-1', flag, 'out'], {} as NodeJS.ProcessEnv) as CliOptions).wait).toBe(true);
    }
  });

  it('refuses what it cannot act on rather than guessing', () => {
    expect(parseArgs(['run'], {} as NodeJS.ProcessEnv)).toEqual({ error: 'run needs an id. See --help.' });
    expect(parseArgs(['fly', 'plan-1'], {} as NodeJS.ProcessEnv)).toEqual({ error: 'Unknown command "fly".' });
    expect(parseArgs(['run', 'plan-1', '--turbo'], {} as NodeJS.ProcessEnv)).toEqual({ error: 'Unknown option "--turbo".' });
    expect(parseArgs(['run', 'plan-1', '--timeout', 'soon'], {} as NodeJS.ProcessEnv)).toMatchObject({ error: expect.stringContaining('--timeout') });
    expect(parseArgs(['export', 'run-1'], {} as NodeJS.ProcessEnv)).toMatchObject({ error: expect.stringContaining('--html') });
  });

  it('reads the idempotency key from the flag or from WFM_IDEMPOTENCY_KEY, and --no-ci', () => {
    expect(parseArgs(['run', 'plan-1', '--idempotency-key', 'k1'], {} as NodeJS.ProcessEnv)).toMatchObject({ idempotencyKey: 'k1' });
    expect(parseArgs(['run', 'plan-1'], { WFM_IDEMPOTENCY_KEY: 'k2' } as NodeJS.ProcessEnv)).toMatchObject({ idempotencyKey: 'k2' });
    expect(parseArgs(['run', 'plan-1', '--idempotency-key', ' '], {} as NodeJS.ProcessEnv)).toEqual({ error: '--idempotency-key needs a value.' });
    expect(parseArgs(['run', 'plan-1', '--no-ci'], {} as NodeJS.ProcessEnv)).toMatchObject({ ci: false });
  });

  it('explains itself when asked, and when asked for nothing', () => {
    expect(parseArgs([], {} as NodeJS.ProcessEnv)).toMatchObject({ command: 'help' });
    expect(parseArgs(['--help'], {} as NodeJS.ProcessEnv)).toMatchObject({ command: 'help' });
  });
});

describe('runCli', () => {
  it('refuses to run without a server or a key, and says which is missing', async () => {
    const noUrl = io(vi.fn());
    expect(await runCli(options({ baseUrl: undefined }), noUrl)).toBe(EXIT_TOOL_ERROR);
    expect(noUrl.errors.join(' ')).toContain('WFM_URL');

    const noKey = io(vi.fn());
    expect(await runCli(options({ apiKey: undefined }), noKey)).toBe(EXIT_TOOL_ERROR);
    expect(noKey.errors.join(' ')).toContain('WFM_API_KEY');
  });

  it('starts a run through /api/v1 and sends the key with it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(started());
    const context = io(fetchImpl);

    expect(await runCli(options(), context)).toBe(EXIT_PASSED);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://wfm.test/api/v1/plans/plan-1/runs');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe('wfm_key');
    expect(JSON.parse(init.body)).toEqual({});
    expect(context.lines.join(' ')).toContain('run-1');
    // No key unless one was given: a random one per invocation would promise nothing.
    expect(init.headers['Idempotency-Key']).toBeUndefined();
  });

  it('sends the idempotency key it was given, so a re-run step follows the run it already started', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(started());
    await runCli(options({ idempotencyKey: 'build-4812' }), io(fetchImpl));
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['Idempotency-Key']).toBe('build-4812');
    expect(init.headers['X-API-Key']).toBe('wfm_key');
  });

  it('passes the environment and the baseline switch through to the run', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(started());
    await runCli(options({ environmentId: 7, updateBaselines: true }), io(fetchImpl));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ environmentId: 7, updateBaselines: true });
  });

  it('sends where the build is, read from the CI, unless told not to', async () => {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'acme/shop', GITHUB_SHA: '3f2a1c9d0e', GITHUB_REF_NAME: 'main', GITHUB_RUN_ID: '42' };
    const fetchImpl = vi.fn().mockResolvedValue(started());
    const context = io(fetchImpl, env);
    await runCli(options(), context);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).ci).toMatchObject({ provider: 'github', repository: 'acme/shop', commit: '3f2a1c9d0e' });
    expect(context.lines[0]).toBe('Started run run-1 for acme/shop@3f2a1c9.');

    const quiet = vi.fn().mockResolvedValue(started());
    await runCli(options({ ci: false }), io(quiet, env));
    expect(JSON.parse(quiet.mock.calls[0][1].body).ci).toBeUndefined();
  });

  it('exits 0 when the run it waited for passed', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(started()).mockResolvedValueOnce(run('running')).mockResolvedValueOnce(run('completed', { total: 3, passed: 3 }));
    expect(await runCli(options({ wait: true }), io(fetchImpl))).toBe(EXIT_PASSED);
    expect(fetchImpl.mock.calls[1][0]).toBe('https://wfm.test/api/v1/runs/run-1');
  });

  it('keeps waiting while the run is still in the queue', async () => {
    // A run the server has just accepted is `queued`. When that word was missing from the
    // list of states that mean "still going", the CLI read it as finished and the pipeline
    // reported before a single test had run.
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(run('queued'))
      .mockResolvedValueOnce(run('running'))
      .mockResolvedValueOnce(run('failed', { total: 1, failed: 1 }));
    expect(await runCli(options({ wait: true }), io(fetchImpl))).toBe(EXIT_RUN_FAILED);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('exits 1 for every way a run can end other than passing', async () => {
    for (const status of ['failed', 'error', 'cancelled', 'timed_out']) {
      const fetchImpl = vi.fn().mockResolvedValueOnce(started()).mockResolvedValueOnce(run(status));
      expect(await runCli(options({ wait: true }), io(fetchImpl))).toBe(EXIT_RUN_FAILED);
    }
  });

  it('gives up after the timeout rather than hanging the pipeline', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(started()).mockResolvedValue(run('running'));
    const context = io(fetchImpl);
    expect(await runCli(options({ wait: true, timeoutSeconds: 3, pollSeconds: 1 }), context)).toBe(EXIT_TOOL_ERROR);
    expect(context.errors.join(' ')).toContain('Timed out');
  });

  it('writes the JUnit file and the reports, from /api/v1, even when the run failed', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(run('failed', { total: 2, passed: 1, failed: 1 }))
      .mockResolvedValueOnce(textResponse('<testsuites />'))
      .mockResolvedValueOnce(textResponse('<!doctype html>'))
      .mockResolvedValueOnce(textResponse('%PDF-1.7'))
      .mockResolvedValueOnce(textResponse('PK'));
    const context = io(fetchImpl);

    const code = await runCli(options({ wait: true, junitPath: 'junit.xml', htmlPath: 'r.html', pdfPath: 'r.pdf', allurePath: 'allure.zip' }), context);

    expect(code).toBe(EXIT_RUN_FAILED);
    expect(fetchImpl.mock.calls.slice(2).map(([url]: any[]) => url)).toEqual([
      'https://wfm.test/api/v1/runs/run-1/junit',
      'https://wfm.test/api/v1/runs/run-1/export/html',
      'https://wfm.test/api/v1/runs/run-1/export/pdf',
      'https://wfm.test/api/v1/runs/run-1/export/allure',
    ]);
    expect(context.files.get('junit.xml')).toBe('<testsuites />');
    expect(context.files.get('r.html')).toBe('<!doctype html>');
    // Binary formats are written as bytes, not as text that would mangle them.
    expect(new TextDecoder().decode(context.files.get('r.pdf') as Uint8Array)).toBe('%PDF-1.7');
    expect(context.files.get('allure.zip')).toBeInstanceOf(Uint8Array);
  });

  it('reports a refused start as a tool error, with the server\'s own reason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'insufficient_scope', message: 'This key needs runs:write.' } }, 403));
    const context = io(fetchImpl);
    expect(await runCli(options(), context)).toBe(EXIT_TOOL_ERROR);
    expect(context.errors.join(' ')).toBe('Could not start the plan: 403 insufficient_scope: This key needs runs:write.');
  });

  it('reports an unreachable server as a tool error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const context = io(fetchImpl);
    expect(await runCli(options(), context)).toBe(EXIT_TOOL_ERROR);
    expect(context.errors.join(' ')).toContain('ECONNREFUSED');
  });

  it('answers status without starting anything', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(run('running'));
    expect(await runCli(options({ command: 'status', target: 'run-1' }), io(fetchImpl))).toBe(EXIT_PASSED);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://wfm.test/api/v1/runs/run-1');
    expect(fetchImpl.mock.calls.every(([, init]: any[]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('fetches a JUnit report, or the exports, for a run that already finished', async () => {
    const junit = vi.fn().mockResolvedValue(textResponse('<testsuites />'));
    const junitIo = io(junit);
    expect(await runCli(options({ command: 'junit', target: 'run-9', junitPath: 'out.xml' }), junitIo)).toBe(EXIT_PASSED);
    expect(junit.mock.calls[0][0]).toBe('https://wfm.test/api/v1/runs/run-9/junit');
    expect(junitIo.files.get('out.xml')).toBe('<testsuites />');

    const exports = vi.fn().mockResolvedValue(textResponse('<html>'));
    const exportIo = io(exports);
    expect(await runCli(options({ command: 'export', target: 'run-9', htmlPath: 'r.html' }), exportIo)).toBe(EXIT_PASSED);
    expect(exports.mock.calls[0][0]).toBe('https://wfm.test/api/v1/runs/run-9/export/html');
  });
});

describe('on GitHub Actions', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: '/gh/output', GITHUB_STEP_SUMMARY: '/gh/summary' };

  it('sets the step outputs and writes the run on the job summary, and annotates a failure', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(run('failed', { total: 10, passed: 7, failed: 3, quarantinedFailures: 1 }));
    const context = io(fetchImpl, env);

    expect(await runCli(options({ wait: true }), context)).toBe(EXIT_RUN_FAILED);

    // Once when started, so a later step has the id even if this one is cancelled; once at the end.
    expect(context.appended.get('/gh/output')).toBe(
      'run-id=run-1\nstatus=queued\nreport-url=https://wfm.test/r/run-1\n' + 'run-id=run-1\nstatus=failed\nreport-url=https://wfm.test/r/run-1\n',
    );
    expect(context.appended.get('/gh/summary')).toContain('### ❌ Nightly: failed');
    expect(context.appended.get('/gh/summary')).toContain('| 10 | 7 | 3 (1 in quarantine) | 0 | 12.0 s |');
    expect(context.lines).toContain('::error title=WebFlowMaster::Nightly: failed — 7/10 passed, 3 failed (1 in quarantine) in 12.0s — https://wfm.test/r/run-1');
  });

  it('writes nothing of the kind anywhere else', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(started()).mockResolvedValueOnce(run('completed', { total: 1, passed: 1 }));
    const context = io(fetchImpl, { GITHUB_OUTPUT: '/gh/output' });
    await runCli(options({ wait: true }), context);
    expect(context.appended.size).toBe(0);
    expect(context.lines.some((line) => line.startsWith('::'))).toBe(false);
  });
});

describe('detectCi', () => {
  it('reads GitHub Actions, including a pull request and a re-run attempt', () => {
    expect(
      detectCi({
        GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'acme/shop', GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/pull/17/merge',
        GITHUB_HEAD_REF: 'feature/pay', GITHUB_REF_NAME: '17/merge', GITHUB_RUN_ID: '9001', GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com', GITHUB_ACTOR: 'mario',
      }),
    ).toEqual({
      provider: 'github', repository: 'acme/shop', commit: 'a'.repeat(40), branch: 'feature/pay', pullRequest: '17',
      buildId: '9001.2', buildUrl: 'https://github.com/acme/shop/actions/runs/9001/attempts/2', actor: 'mario',
    });
  });

  it('reads GitLab CI, Azure Pipelines, Bitbucket, CircleCI and Jenkins', () => {
    expect(detectCi({ GITLAB_CI: 'true', CI_PROJECT_PATH: 'acme/shop', CI_COMMIT_SHA: 'b'.repeat(40), CI_COMMIT_REF_NAME: 'main', CI_PIPELINE_ID: '55', CI_PIPELINE_URL: 'https://gitlab.test/acme/shop/-/pipelines/55' }))
      .toMatchObject({ provider: 'gitlab', buildUrl: 'https://gitlab.test/acme/shop/-/pipelines/55', branch: 'main' });
    expect(detectCi({ TF_BUILD: 'True', BUILD_REPOSITORY_NAME: 'shop', BUILD_SOURCEVERSION: 'c'.repeat(40), BUILD_SOURCEBRANCH: 'refs/heads/release', BUILD_BUILDID: '77', BUILD_BUILDNUMBER: '20260924.3', SYSTEM_COLLECTIONURI: 'https://dev.azure.com/acme/', SYSTEM_TEAMPROJECT: 'Web Shop' }))
      .toMatchObject({ provider: 'azure', branch: 'release', buildId: '20260924.3', buildUrl: 'https://dev.azure.com/acme/Web%20Shop/_build/results?buildId=77' });
    expect(detectCi({ BITBUCKET_BUILD_NUMBER: '12', BITBUCKET_REPO_FULL_NAME: 'acme/shop', BITBUCKET_COMMIT: 'd'.repeat(40) }))
      .toMatchObject({ provider: 'bitbucket', buildUrl: 'https://bitbucket.org/acme/shop/pipelines/results/12' });
    expect(detectCi({ CIRCLECI: 'true', CIRCLE_PROJECT_USERNAME: 'acme', CIRCLE_PROJECT_REPONAME: 'shop', CIRCLE_BUILD_URL: 'https://circleci.com/gh/acme/shop/8' }))
      .toMatchObject({ provider: 'circleci', repository: 'acme/shop' });
    expect(detectCi({ JENKINS_URL: 'https://ci.acme.test/', JOB_NAME: 'shop/main', BUILD_NUMBER: '314', BUILD_URL: 'https://ci.acme.test/job/shop/314/', GIT_COMMIT: 'e'.repeat(40), GIT_BRANCH: 'origin/main', GIT_URL: 'https://token:x@git.acme.test/shop.git' }))
      .toEqual({ provider: 'jenkins', repository: 'https://git.acme.test/shop', commit: 'e'.repeat(40), branch: 'main', buildId: 'shop/main #314', buildUrl: 'https://ci.acme.test/job/shop/314/' });
  });

  it('drops what the server would refuse, rather than failing the run over it, and finds nothing outside CI', () => {
    expect(detectCi({ GITHUB_ACTIONS: 'true', GITHUB_SHA: 'not-a-sha', GITHUB_REPOSITORY: 'x'.repeat(500), GITHUB_SERVER_URL: 'javascript:alert(1)', GITHUB_RUN_ID: '1' }))
      .toEqual({ provider: 'github', repository: 'x'.repeat(300), buildId: '1' });
    expect(detectCi({ PATH: '/usr/bin' })).toBeUndefined();
  });
});

describe('describing a run', () => {
  it('says the verdict, the counts and where the report is, in one line', () => {
    expect(describeRun({ id: 'run-1', status: 'failed', planName: 'Nightly', tests: { total: 10, passed: 7, failed: 3 }, durationMs: 95_000 }))
      .toBe('Nightly: failed — 7/10 passed, 3 failed in 95.0s');
    expect(describeRun({ id: 'run-1', status: 'error' })).toContain('no tests ran');
  });

  it('writes a Markdown summary a job page can show', () => {
    expect(markdownSummary({ id: 'run-1', status: 'completed', planName: 'Smoke', tests: { total: 2, passed: 2 }, durationMs: 1000, links: { report: 'https://wfm.test/r/1' } }))
      .toBe('### ✅ Smoke: passed\n\n| Tests | Passed | Failed | Skipped | Duration |\n| ---: | ---: | ---: | ---: | ---: |\n| 2 | 2 | 0 | 0 | 1.0 s |\n\n[Open the report](https://wfm.test/r/1) · run `run-1`\n');
  });
});
