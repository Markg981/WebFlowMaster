import { describe, it, expect, vi } from 'vitest';
import {
  EXIT_PASSED,
  EXIT_RUN_FAILED,
  parseArgs,
  runCli,
  type CliIo,
  type CliOptions,
} from './wfm-cli';

/** `wfm hub import|audit|job`: the QA hub import over /api/v1/qa-hub. */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function io(fetchImpl: ReturnType<typeof vi.fn>) {
  const lines: string[] = [];
  let clock = 0;
  const context = {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    writeFile: async () => {},
    appendFile: async () => {},
    log: (line: string) => lines.push(line),
    error: (line: string) => lines.push(line),
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    env: {},
    lines,
  } as unknown as CliIo & { lines: string[] };
  return context;
}

const parsed = (argv: string[]) => parseArgs(argv, {} as NodeJS.ProcessEnv);
const options = (argv: string[]) => {
  const result = parsed(argv);
  expect('error' in result, JSON.stringify(result)).toBe(false);
  return result as CliOptions;
};

describe('wfm hub', () => {
  it('parses the import flags', () => {
    expect(
      options([
        'hub',
        'import',
        'DMO Core,DMO Sales',
        '--project',
        '7',
        '--feature-highlights',
        'A,B',
        '--sync',
        '--include-deprecated',
        '--wait',
      ]),
    ).toMatchObject({
      hubAction: 'import',
      hubModules: ['DMO Core', 'DMO Sales'],
      project: '7',
      featureHighlights: ['A', 'B'],
      sync: true,
      includeDeprecated: true,
      wait: true,
    });
  });

  it('refuses an import without modules and an unknown action', () => {
    expect(parsed(['hub', 'import'])).toHaveProperty('error');
    expect(parsed(['hub', 'nope'])).toHaveProperty('error');
  });

  it('starts the job, waits for it and fails the exit code when a case failed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'j1', status: 'queued' }, 202))
      .mockResolvedValueOnce(jsonResponse({ id: 'j1', status: 'running' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 'j1', status: 'succeeded', summary: { created: 2, failed: 1 } }),
      );
    const context = io(fetchImpl);
    const code = await runCli(
      options(['hub', 'import', 'DMO Core', '--wait', '--url', 'http://x', '--key', 'k']),
      context,
    );
    expect(code).toBe(EXIT_RUN_FAILED);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/api/v1/qa-hub/import/modules');
    expect(JSON.parse(init.body)).toMatchObject({ modules: ['DMO Core'], sync: false });
    expect(context.lines.join('\n')).toContain('created: 2');
  });

  it('prints the audit per module', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        modules: [
          {
            module: 'DMO Core',
            defined: 4,
            imported: 3,
            missing: 1,
            duplicateCases: 0,
            taxonomyDiffers: 0,
          },
        ],
        totals: { duplicates: 0, taxonomyDifferences: 0, orphans: 0 },
      }),
    );
    const context = io(fetchImpl);
    const code = await runCli(
      options(['hub', 'audit', 'DMO Core', '--url', 'http://x', '--key', 'k']),
      context,
    );
    expect(code).toBe(EXIT_PASSED);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/v1/qa-hub/audit?modules=DMO+Core');
    expect(context.lines.join('\n')).toContain('DMO Core: defined 4, imported 3, missing 1');
  });
});
