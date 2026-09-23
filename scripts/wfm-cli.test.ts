import { describe, it, expect, vi } from 'vitest';
import {
  EXIT_PASSED,
  EXIT_RUN_FAILED,
  EXIT_TOOL_ERROR,
  describeRun,
  parseArgs,
  runCli,
  type CliIo,
  type CliOptions,
} from './wfm-cli';

/**
 * The command a pipeline runs. Its exit code is its interface: a step that exits 0 on a failed
 * run is worse than no step at all, so most of what follows is about that number.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

function io(fetchImpl: ReturnType<typeof vi.fn>): CliIo & { lines: string[]; errors: string[]; files: Map<string, string> } {
  const lines: string[] = [];
  const errors: string[] = [];
  const files = new Map<string, string>();
  let clock = 0;
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    writeFile: async (path, contents) => {
      files.set(path, contents);
    },
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
    // Time only moves when the CLI waits, so a test never actually waits.
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    lines,
    errors,
    files,
  };
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
  ...overrides,
});

describe('parseArgs', () => {
  it('reads a run command and its options', () => {
    const parsed = parseArgs(['run', 'plan-1', '--wait', '--environment', '4', '--timeout', '90'], {} as NodeJS.ProcessEnv);

    expect(parsed).toMatchObject({ command: 'run', target: 'plan-1', wait: true, environmentId: 4, timeoutSeconds: 90 });
  });

  it('takes the server and the key from the environment, as a pipeline supplies them', () => {
    const parsed = parseArgs(['status', 'exec-1'], { WFM_URL: 'https://ci.test', WFM_API_KEY: 'wfm_abc' } as NodeJS.ProcessEnv);

    expect(parsed).toMatchObject({ baseUrl: 'https://ci.test', apiKey: 'wfm_abc' });
  });

  it('waits when asked for a JUnit file, because it cannot write one before the run ends', () => {
    const parsed = parseArgs(['run', 'plan-1', '--junit', 'out.xml'], {} as NodeJS.ProcessEnv) as CliOptions;

    expect(parsed.wait).toBe(true);
  });

  it('refuses what it cannot act on rather than guessing', () => {
    expect(parseArgs(['run'], {} as NodeJS.ProcessEnv)).toEqual({ error: 'run needs an id. See --help.' });
    expect(parseArgs(['fly', 'plan-1'], {} as NodeJS.ProcessEnv)).toEqual({ error: 'Unknown command "fly".' });
    expect(parseArgs(['run', 'plan-1', '--turbo'], {} as NodeJS.ProcessEnv)).toEqual({ error: 'Unknown option "--turbo".' });
    expect(parseArgs(['run', 'plan-1', '--timeout', 'soon'], {} as NodeJS.ProcessEnv)).toMatchObject({
      error: expect.stringContaining('--timeout'),
    });
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

  it('starts a run and sends the key with it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { id: 'exec-1' } }, 200));
    const context = io(fetchImpl);

    const code = await runCli(options(), context);

    expect(code).toBe(EXIT_PASSED);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://wfm.test/api/run-test-plan/plan-1');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe('wfm_key');
    expect(context.lines.join(' ')).toContain('exec-1');
  });

  it('exits 0 when the run it waited for passed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'exec-1' } }, 200))
      .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status: 'running' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status: 'completed', totalTests: 3, passedTests: 3 }));

    expect(await runCli(options({ wait: true }), io(fetchImpl))).toBe(EXIT_PASSED);
  });

  it('keeps waiting while the run is still in the queue', async () => {
    // A run the server has just accepted is `queued`. When that word was missing from the
    // list of states that mean "still going", the CLI read it as finished and the pipeline
    // reported before a single test had run.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'exec-1' } }, 200))
      .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status: 'queued' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status: 'running' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status: 'failed', totalTests: 1, failedTests: 1 }));

    expect(await runCli(options({ wait: true }), io(fetchImpl))).toBe(EXIT_RUN_FAILED);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('fails a run that was cancelled or ran out of time, rather than passing it', async () => {
    for (const status of ['cancelled', 'timed_out']) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'exec-1' } }, 200))
        .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status }));

      expect(await runCli(options({ wait: true }), io(fetchImpl))).toBe(EXIT_RUN_FAILED);
    }
  });

  it('exits 1 when the run it waited for failed — the number that matters', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'exec-1' } }, 200))
      .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status: 'failed', totalTests: 3, passedTests: 2, failedTests: 1 }));

    expect(await runCli(options({ wait: true }), io(fetchImpl))).toBe(EXIT_RUN_FAILED);
  });

  it('exits 1 for a run that could not execute, not 0', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'exec-1' } }, 200))
      .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status: 'error' }));

    expect(await runCli(options({ wait: true }), io(fetchImpl))).toBe(EXIT_RUN_FAILED);
  });

  it('gives up after the timeout rather than hanging the pipeline', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'exec-1' } }, 200))
      .mockResolvedValue(jsonResponse({ id: 'exec-1', status: 'running' }));
    const context = io(fetchImpl);

    const code = await runCli(options({ wait: true, timeoutSeconds: 3, pollSeconds: 1 }), context);

    expect(code).toBe(EXIT_TOOL_ERROR);
    expect(context.errors.join(' ')).toContain('Timed out');
  });

  it('writes the JUnit file the pipeline will publish', async () => {
    const xml = '<?xml version="1.0"?><testsuites />';
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'exec-1' } }, 200))
      .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status: 'completed', totalTests: 1, passedTests: 1 }))
      .mockResolvedValueOnce(textResponse(xml));
    const context = io(fetchImpl);

    const code = await runCli(options({ wait: true, junitPath: 'results/junit.xml' }), context);

    expect(code).toBe(EXIT_PASSED);
    expect(context.files.get('results/junit.xml')).toBe(xml);
  });

  it('still writes the JUnit file when the run failed, because that is when it is read', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'exec-1' } }, 200))
      .mockResolvedValueOnce(jsonResponse({ id: 'exec-1', status: 'failed', totalTests: 2, passedTests: 1, failedTests: 1 }))
      .mockResolvedValueOnce(textResponse('<testsuites />'));
    const context = io(fetchImpl);

    const code = await runCli(options({ wait: true, junitPath: 'junit.xml' }), context);

    expect(code).toBe(EXIT_RUN_FAILED);
    expect(context.files.has('junit.xml')).toBe(true);
  });

  it('reports a refused start as a tool error, not as a failed test run', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401));
    const context = io(fetchImpl);

    expect(await runCli(options(), context)).toBe(EXIT_TOOL_ERROR);
    expect(context.errors.join(' ')).toContain('401');
  });

  it('reports an unreachable server as a tool error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const context = io(fetchImpl);

    expect(await runCli(options(), context)).toBe(EXIT_TOOL_ERROR);
    expect(context.errors.join(' ')).toContain('ECONNREFUSED');
  });

  it('answers status without starting anything', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'exec-1', status: 'running', totalTests: 0 }));
    const context = io(fetchImpl);

    const code = await runCli(options({ command: 'status', target: 'exec-1' }), context);

    expect(code).toBe(EXIT_PASSED);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://wfm.test/api/test-plan-executions/exec-1');
    expect(fetchImpl.mock.calls.every(([, init]: any[]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('fetches a JUnit report for a run that already finished', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('<testsuites />'));
    const context = io(fetchImpl);

    const code = await runCli(options({ command: 'junit', target: 'exec-9', junitPath: 'out.xml' }), context);

    expect(code).toBe(EXIT_PASSED);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://wfm.test/api/test-plan-executions/exec-9/junit');
    expect(context.files.get('out.xml')).toBe('<testsuites />');
  });

  it('passes the environment and the baseline switch through to the run', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'exec-1' } }, 200));

    await runCli(options({ environmentId: 7, updateBaselines: true }), io(fetchImpl));

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ environmentId: 7, updateBaselines: true });
  });
});

describe('describeRun', () => {
  it('says the verdict and the counts in one line', () => {
    expect(
      describeRun({
        id: 'exec-1',
        status: 'failed',
        testPlanName: 'Nightly',
        totalTests: 10,
        passedTests: 7,
        failedTests: 3,
        executionDurationMs: 95_000,
      }),
    ).toBe('Nightly: failed — 7/10 passed, 3 failed in 95.0s');
  });

  it('does not pretend a run with no results had any', () => {
    expect(describeRun({ id: 'exec-1', status: 'error' })).toContain('no tests ran');
  });
});
