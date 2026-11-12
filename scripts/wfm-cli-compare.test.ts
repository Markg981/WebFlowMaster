import { describe, it, expect, vi } from 'vitest';
import {
  EXIT_PASSED,
  EXIT_RUN_FAILED,
  EXIT_TOOL_ERROR,
  comparisonExitCode,
  describeComparison,
  parseArgs,
  runCli,
  type CliIo,
  type CliOptions,
  type ComparisonRecord,
} from './wfm-cli';

/**
 * `wfm compare`: a migration gate in a pipeline. The exit code comes from the comparison's
 * verdict, so a step must not pass on a regression, on nothing compared, or on an error.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
  } as unknown as Response;
}

function io(fetchImpl: ReturnType<typeof vi.fn>, env: Record<string, string> = {}) {
  const lines: string[] = [];
  const errors: string[] = [];
  const files = new Map<string, string | Uint8Array>();
  const appended = new Map<string, string>();
  let clock = 0;
  const context: CliIo & {
    lines: string[];
    errors: string[];
    files: typeof files;
    appended: typeof appended;
  } = {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    writeFile: async (path, contents) => {
      files.set(path, contents);
    },
    appendFile: async (path, contents) => {
      appended.set(path, (appended.get(path) ?? '') + contents);
    },
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
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

const counts = (overrides: Record<string, number> = {}) => ({
  identical: 0,
  equivalent: 0,
  different: 0,
  outcome_mismatch: 0,
  both_failed: 0,
  not_comparable: 0,
  ...overrides,
});

const comparison = (
  status: string,
  byVerdict: Record<string, number> = {},
  extra: Partial<ComparisonRecord> = {},
): ComparisonRecord => {
  const verdicts = counts(byVerdict);
  return {
    id: 'cmp-1',
    status,
    verdict: status === 'completed' ? 'parity' : null,
    name: 'Angular 22',
    summary: { total: Object.values(verdicts).reduce((a, b) => a + b, 0), byVerdict: verdicts },
    baseline: { environmentName: 'prod' },
    candidate: { environmentName: 'staging' },
    links: { report: 'https://wfm.test/comparisons/cmp-1' },
    ...extra,
  };
};

const parsed = (argv: string[]) => parseArgs(argv, {} as NodeJS.ProcessEnv);
const base = ['compare', '--plan', 'plan-1', '--baseline', '1', '--candidate', '2'];

describe('parsing wfm compare', () => {
  it('reads the plan, the two environments and the gate, and waits for a gate or a report', () => {
    expect(parsed([...base, '--mode', 'parallel', '--name', 'Angular 22'])).toMatchObject({
      command: 'compare',
      planId: 'plan-1',
      baselineEnvironmentId: 1,
      candidateEnvironmentId: 2,
      compareMode: 'parallel',
      comparisonName: 'Angular 22',
      wait: false,
    });
    expect(parsed([...base, '--fail-on', 'different, not_comparable'])).toMatchObject({
      failOn: ['different', 'not_comparable'],
      wait: true,
    });
    expect(parsed([...base, '--pdf', 'parity.pdf'])).toMatchObject({ wait: true });
  });

  it('refuses what it cannot carry out', () => {
    for (const argv of [
      ['compare', '--baseline', '1', '--candidate', '2'],
      ['compare', '--plan', 'p', '--baseline', '1'],
      ['compare', '--plan', 'p', '--baseline', '1', '--candidate', '1'],
      ['compare', '--plan', 'p', '--baseline', 'prod', '--candidate', '2'],
      [...base, '--mode', 'sideways'],
      [...base, '--fail-on', 'identical'],
      [...base, '--fail-on', ''],
      [...base, '--junit', 'out.xml'],
      [...base, 'extra'],
    ]) {
      expect(parsed(argv), argv.join(' ')).toHaveProperty('error');
    }
  });
});

describe('the exit code of a comparison', () => {
  it('passes on parity and on accepted differences, by default', () => {
    expect(comparisonExitCode(comparison('completed', { identical: 3 }), ['different'])).toBe(
      EXIT_PASSED,
    );
    expect(
      comparisonExitCode(comparison('completed', { identical: 2, equivalent: 1 }), [
        'different',
        'outcome_mismatch',
      ]),
    ).toBe(EXIT_PASSED);
  });

  it('fails on a verdict in --fail-on, on nothing compared, and on an error or a cancel', () => {
    expect(
      comparisonExitCode(comparison('completed', { identical: 2, different: 1 }), ['different']),
    ).toBe(EXIT_RUN_FAILED);
    expect(
      comparisonExitCode(comparison('completed', { identical: 2, not_comparable: 1 }), [
        'not_comparable',
      ]),
    ).toBe(EXIT_RUN_FAILED);
    expect(comparisonExitCode(comparison('completed'), ['different'])).toBe(EXIT_RUN_FAILED);
    expect(comparisonExitCode(comparison('error', { identical: 1 }), ['different'])).toBe(
      EXIT_RUN_FAILED,
    );
    expect(comparisonExitCode(comparison('cancelled', { identical: 1 }), ['different'])).toBe(
      EXIT_RUN_FAILED,
    );
  });

  it('describes it in one line', () => {
    expect(describeComparison(comparison('completed', { identical: 2, outcome_mismatch: 1 }))).toBe(
      'Angular 22 prod → staging: parity — 2 identical, 1 outcome mismatch — https://wfm.test/comparisons/cmp-1',
    );
  });
});

describe('running wfm compare', () => {
  const options = (overrides: Partial<CliOptions> = {}): CliOptions => ({
    ...(parsed(base) as CliOptions),
    baseUrl: 'https://wfm.test',
    apiKey: 'wfm_key',
    ...overrides,
  });

  it('starts it with the environments and the key, and returns at once without --wait', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(comparison('running'), 202));
    const context = io(fetchImpl);

    expect(await runCli(options({ idempotencyKey: 'build-9' }), context)).toBe(EXIT_PASSED);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://wfm.test/api/v1/plans/plan-1/comparisons');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('build-9');
    expect(JSON.parse(init.body)).toEqual({ baselineEnvironmentId: 1, candidateEnvironmentId: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('waits for the verdict, writes the parity report whatever it is, and fails on a regression', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(comparison('running'), 202))
      .mockResolvedValueOnce(jsonResponse(comparison('comparing')))
      .mockResolvedValueOnce(
        jsonResponse(
          comparison('completed', { identical: 4, different: 1 }, { verdict: 'regressions' }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse('<html>parity</html>'));
    const context = io(fetchImpl, { GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: '/out' });

    const exit = await runCli(options({ wait: true, htmlPath: 'parity.html' }), context);

    expect(exit).toBe(EXIT_RUN_FAILED);
    expect(fetchImpl.mock.calls[3][0]).toBe(
      'https://wfm.test/api/v1/comparisons/cmp-1/export/html',
    );
    expect(context.files.get('parity.html')).toBe('<html>parity</html>');
    expect(context.appended.get('/out')).toContain('verdict=regressions');
    expect(context.lines.some((l) => l.startsWith('::error title=WebFlowMaster::'))).toBe(true);
  });

  it('gives up after --timeout as a tool error, and reports a refused start as one', async () => {
    const waiting = vi.fn().mockImplementation(async () => jsonResponse(comparison('running')));
    expect(await runCli(options({ wait: true, timeoutSeconds: 3 }), io(waiting))).toBe(
      EXIT_TOOL_ERROR,
    );

    const refused = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'plan_not_found', message: 'No such plan.' } }, 404),
      );
    const context = io(refused);
    expect(await runCli(options(), context)).toBe(EXIT_TOOL_ERROR);
    expect(context.errors[0]).toContain('plan_not_found');
  });
});
