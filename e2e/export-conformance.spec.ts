import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { register, unique } from './helpers';

/**
 * The exportable subset, run twice (P15, M04): once as a WebFlowMaster plan, once as the file the
 * strict export writes, against the same controlled page. Both must leave the same effects on the
 * fixture, pass the same assertions and fail the same way on a wrong one; a test with a step that
 * has no equivalent must be refused by strict mode, and its draft must fail rather than pass.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

interface Fixture {
  baseUrl: string;
  effects: string[];
  close(): Promise<void>;
}

/** A page that records what it is made to do: the setup call, the saves, the frame and the cleanup. */
async function startFixture(): Promise<Fixture> {
  const effects: string[] = [];
  const page = `<!doctype html><title>Export fixture</title>
<input id="who" aria-label="Who"><button id="save">Save</button><p id="out"></p>
<label><input type="checkbox" id="agree"> Agree</label>
<button id="inc">Add</button><ul id="items"></ul><span id="count">0</span>
<iframe name="inner" src="/inner"></iframe>
<script>
  const post = (body) => fetch('/effect', { method: 'POST', body });
  document.getElementById('save').onclick = () => {
    const who = document.getElementById('who').value;
    document.getElementById('out').textContent = 'Saved: ' + who;
    post('saved:' + who);
  };
  document.getElementById('inc').onclick = () => {
    document.getElementById('items').append(document.createElement('li'));
    document.getElementById('count').textContent = String(document.querySelectorAll('#items li').length);
  };
</script>`;
  // "Sent" appears once the fixture has recorded the effect, so the test can wait for it: the
  // click is the last step, and the page may close before an unawaited request leaves.
  const inner = `<!doctype html><input id="city" aria-label="City"><button id="send">Send</button>
<p id="sent"></p>
<script>
  document.getElementById('send').onclick = () =>
    fetch('/effect', { method: 'POST', body: 'city:' + document.getElementById('city').value })
      .then(() => { document.getElementById('sent').textContent = 'Sent'; });
</script>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const html = (text: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(text);
      };
      if (req.method === 'GET' && url.pathname === '/form') return html(page);
      if (req.method === 'GET' && url.pathname === '/inner') return html(inner);
      if (req.method === 'POST' && url.pathname === '/effect') {
        effects.push(body);
        res.writeHead(204).end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/seed') {
        effects.push(`seed:${(JSON.parse(body || '{}') as { who?: string }).who}`);
        res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"ok":true}');
        return;
      }
      if (req.method === 'DELETE' && url.pathname === '/seed') {
        effects.push(`cleanup:${url.searchParams.get('who')}`);
        res.writeHead(204).end();
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    effects,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

let fixture: Fixture;

test.beforeAll(async () => {
  fixture = await startFixture();
});

test.afterAll(async () => {
  await fixture?.close();
});

function step(
  id: string,
  action: string,
  value = '',
  target?: { selector: string; frameSelector?: string },
) {
  return {
    id,
    action: { id: action, type: action, name: action },
    value,
    ...(target
      ? {
          targetElement: {
            id: `${id}-target`,
            selector: target.selector,
            type: 'element',
            tag: 'div',
            text: '',
            attributes: {},
            frameSelector: target.frameSelector ?? null,
          },
        }
      : {}),
  };
}

/** The same flow for everyone; `expected` is what the assertion after the save looks for. */
function flow(who: string, expected: string) {
  return [
    step('who', 'setVariable', `who=${who}`),
    step('type', 'input', '{{who}}', { selector: '#who' }),
    step('save', 'click', '', { selector: '#save' }),
    step('saved', 'assertTextContains', expected, { selector: '#out' }),
    step('agree', 'click', '', { selector: '#agree' }),
    step('agreed', 'assertState', 'checked', { selector: '#agree' }),
    step('loop', 'repeat', '2'),
    step('add', 'click', '', { selector: '#inc' }),
    step('end', 'endLoop'),
    step('counted', 'assertTextContains', '2', { selector: '#count' }),
    step('city', 'input', 'Torino', { selector: '#city', frameSelector: 'iframe[name="inner"]' }),
    step('send', 'click', '', { selector: '#send', frameSelector: 'iframe[name="inner"]' }),
    step('sent', 'assertTextContains', 'Sent', {
      selector: '#sent',
      frameSelector: 'iframe[name="inner"]',
    }),
  ];
}

function setupAndCleanup(who: string) {
  const call = (name: string, method: string) => ({
    id: name,
    name,
    method,
    url: `${fixture.baseUrl}/seed`,
    queryParams: method === 'DELETE' ? [{ key: 'who', value: who, enabled: true }] : null,
    requestHeaders: method === 'POST' ? { 'Content-Type': 'application/json' } : null,
    requestBody: method === 'POST' ? JSON.stringify({ who }) : null,
    sourceApiTestId: null,
  });
  return { preconditions: [call('Seed', 'POST')], cleanups: [call('Remove seed', 'DELETE')] };
}

interface Outcome {
  status: 'passed' | 'failed';
  error: string;
}

/**
 * Runs exported files with Playwright itself, in a configuration of their own, outside this run.
 * Asynchronously: the fixture answering them lives in this process.
 */
async function runExported(
  dir: string,
  browserName: string,
  files: Record<string, string>,
): Promise<Map<string, Outcome>> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, code] of Object.entries(files)) writeFileSync(join(dir, name), code);
  writeFileSync(
    join(dir, 'playwright.config.mjs'),
    `export default ${JSON.stringify({
      testDir: '.',
      testMatch: '*.spec.ts',
      workers: 1,
      retries: 0,
      timeout: 120_000,
      outputDir: './results',
      use: { browserName, headless: true },
    })};\n`,
  );
  const report = join(dir, 'report.json');
  // The outer run's worker variables would make the inner one think it is a worker.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(TEST_|PW_)/.test(key)),
  );
  const child = spawn(
    process.execPath,
    [
      join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      '--config',
      join(dir, 'playwright.config.mjs'),
      '--reporter=json',
    ],
    {
      cwd: dir,
      env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: report },
      timeout: 300_000,
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  await new Promise((resolve) => child.on('close', resolve));
  type Spec = {
    title: string;
    tests: { results: { status: string; error?: { message?: string } }[] }[];
  };
  type Suite = { specs?: Spec[]; suites?: Suite[] };
  let parsed: Suite;
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8')) as Suite;
  } catch {
    throw new Error(`The exported files did not run:\n${output}`);
  }
  const outcomes = new Map<string, Outcome>();
  const visit = (suite: Suite) => {
    for (const spec of suite.specs ?? []) {
      const last = spec.tests[0]?.results.at(-1);
      outcomes.set(spec.title, {
        status: last?.status === 'passed' ? 'passed' : 'failed',
        error: last?.error?.message ?? '',
      });
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  visit(parsed);
  return outcomes;
}

test('the exportable subset does the same as a run, and strict never writes an incomplete file', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const browserName = info.project.name;
  await register(page);

  const cases = [
    { name: unique('export_green'), who: 'Ada', expected: 'Saved: Ada', passes: true },
    { name: unique('export_red'), who: 'Eve', expected: 'Saved: Nobody', passes: false },
  ];
  const saved: { id: number; name: string }[] = [];
  for (const c of cases) {
    const response = await page.request.post('/api/tests', {
      data: {
        name: c.name,
        url: `${fixture.baseUrl}/form`,
        elements: [],
        sequence: flow(c.who, c.expected),
        ...setupAndCleanup(c.who),
      },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { id: number };
    expect((await page.request.post(`/api/tests/${created.id}/publish`, { data: {} })).ok()).toBe(
      true,
    );
    saved.push({ id: created.id, name: c.name });
  }
  // A working copy that would fail: neither the plan nor the export may pick it up.
  expect(
    (
      await page.request.put(`/api/tests/${saved[0].id}`, {
        data: { sequence: flow('Ada', 'Saved: not the published version') },
      })
    ).ok(),
  ).toBe(true);

  // 1. WebFlowMaster runs them.
  fixture.effects.length = 0;
  const created = await page.request.post('/api/test-plans', {
    data: {
      name: unique('export_conformance_plan'),
      selectedTests: saved.map((t) => ({ id: t.id, type: 'ui' })),
      testMachinesConfig: [{ browserName, headless: true }],
      maxParallelTests: 1,
      captureScreenshots: 'never',
    },
  });
  expect(created.status()).toBe(201);
  const plan = (await created.json()) as { id: number };
  const started = await page.request.post(`/api/run-test-plan/${plan.id}`, { data: {} });
  expect(started.ok()).toBe(true);
  const runId = (await started.json()).data.id;
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/test-plan-executions/${runId}`)).json()).status,
      { timeout: 240_000 },
    )
    // One of the two is meant to fail, and a run with a failed test ends as failed.
    .toBe('failed');
  const report = await (await page.request.get(`/api/test-plan-executions/${runId}/report`)).json();
  type Row = {
    testName: string;
    status: string;
    testVersion: number | null;
    reasonForFailure?: string | null;
  };
  const rows: Row[] = Object.values(
    report.testGroupings as Record<string, { components: Record<string, { tests: Row[] }> }>,
  ).flatMap((group) => Object.values(group.components).flatMap((c) => c.tests));
  const wfmEffects = [...fixture.effects].sort();

  // 2. The strict export of the same tests, run by Playwright alone.
  const files: Record<string, string> = {};
  for (const t of saved) {
    const response = await page.request.get(
      `/api/tests/${t.id}/playwright?mode=strict&format=json`,
    );
    expect(response.status(), await response.text()).toBe(200);
    const exported = (await response.json()) as {
      fileName: string;
      code: string;
      complete: boolean;
      findings: unknown[];
    };
    expect(exported.complete).toBe(true);
    expect(exported.findings).toEqual([]);
    expect(exported.code).not.toContain('test.skip');
    // The version the plan ran, named by the export.
    const row = rows.find((r) => r.testName === t.name);
    expect(response.headers()['x-wfm-export-source']).toBe('published');
    expect(response.headers()['x-wfm-export-version']).toBe(String(row?.testVersion));
    files[exported.fileName] = exported.code;
  }
  fixture.effects.length = 0;
  const outcomes = await runExported(
    join(root, '.local', 'e2e', 'export-conformance', browserName),
    browserName,
    files,
  );
  const fileEffects = [...fixture.effects].sort();

  // 3. Same effects, same assertions, same negative outcome.
  expect(wfmEffects).toEqual(
    [
      'seed:Ada',
      'saved:Ada',
      'city:Torino',
      'cleanup:Ada',
      'seed:Eve',
      'saved:Eve',
      'cleanup:Eve',
    ].sort(),
  );
  expect(fileEffects).toEqual(wfmEffects);
  for (const c of cases) {
    const row = rows.find((r) => r.testName === c.name);
    const outcome = outcomes.get(c.name);
    expect(row?.status, `${c.name}: ${row?.reasonForFailure}`).toBe(c.passes ? 'Passed' : 'Failed');
    expect(outcome?.status, `${c.name}: ${outcome?.error}`).toBe(c.passes ? 'passed' : 'failed');
    if (!c.passes) {
      expect(row?.reasonForFailure ?? '').toContain(c.expected);
      expect(outcome?.error ?? '').toContain(c.expected);
    }
  }

  // 4. A step with no equivalent: strict refuses with the list, the draft fails where it stands.
  const unportable = await page.request.post('/api/tests', {
    data: {
      name: unique('export_unportable'),
      url: `${fixture.baseUrl}/form`,
      elements: [],
      sequence: [
        step('type', 'input', 'Ada', { selector: '#who' }),
        step('query', 'queryDatabase', 'SELECT 1'),
        step('save', 'click', '', { selector: '#save' }),
      ],
    },
  });
  expect(unportable.status()).toBe(201);
  const unportableId = ((await unportable.json()) as { id: number }).id;
  const refused = await page.request.get(`/api/tests/${unportableId}/playwright?mode=strict`);
  expect(refused.status()).toBe(422);
  const body = (await refused.json()) as {
    error: string;
    findings: { step: number | null; area: string; support: string }[];
  };
  expect(body.findings).toEqual([
    expect.objectContaining({ step: 2, area: 'action', support: 'unsupported' }),
  ]);
  expect(refused.headers()['content-disposition']).toBeUndefined();

  fixture.effects.length = 0;
  const draft = await page.request.get(`/api/tests/${unportableId}/playwright?format=json`);
  expect(draft.status()).toBe(200);
  const drafted = (await draft.json()) as { fileName: string; code: string; complete: boolean };
  expect(drafted.complete).toBe(false);
  expect(drafted.code).toContain('// DRAFT');
  expect(drafted.code).not.toContain('test.skip');
  const draftOutcome = await runExported(
    join(root, '.local', 'e2e', 'export-conformance', `${browserName}-draft`),
    browserName,
    { [drafted.fileName]: drafted.code },
  );
  const only = [...draftOutcome.values()];
  expect(only).toHaveLength(1);
  expect(only[0].status).toBe('failed');
  expect(only[0].error).toContain('step 2');
  // It stopped at the step it could not do: the save after it never happened.
  expect(fixture.effects).toEqual([]);
});
