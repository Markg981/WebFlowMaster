import http from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { register, unique } from './helpers';
import { parseArgs, runCli } from '../scripts/wfm-cli';

/**
 * The execution contracts of the release (P18), end to end.
 *
 * One verdict per run, whoever reads it: the report page, the internal and public APIs, the CLI's
 * exit code, the JUnit file, the HTML, PDF and Allure exports, for a run that passes, one that
 * fails, one whose test could not run and one that lost a result. And the browser behaviours a
 * test leans on — a dialog, an upload, a download, an iframe, a popup, a cancel — on every engine.
 */

const BASE_URL = 'http://127.0.0.1:5080';

interface Fixture {
  baseUrl: string;
  effects: string[];
  /** Requests to /hold waiting for release, by key. */
  held: Map<string, http.ServerResponse[]>;
  close(): Promise<void>;
}

async function startFixture(): Promise<Fixture> {
  const effects: string[] = [];
  const held = new Map<string, http.ServerResponse[]>();
  const pages: Record<string, string> = {
    '/green': '<!doctype html><title>Green</title><p id="out">Ready</p>',
    '/behaviours': `<!doctype html><title>Behaviours</title>
<button id="ask">Ask</button><p id="out"></p>
<input type="file" id="file" aria-label="File"><p id="uploaded"></p>
<a id="dl" href="/report.csv" download>Download</a>
<iframe name="inner" src="/inner"></iframe>
<button id="open">Open</button>
<script>
  const post = (body) => fetch('/effect', { method: 'POST', body });
  document.getElementById('ask').onclick = () => {
    const name = prompt('Name?');
    document.getElementById('out').textContent = 'Hello ' + name;
    post('dialog:' + name);
  };
  document.getElementById('file').onchange = async (event) => {
    const file = event.target.files[0];
    const text = (await file.text()).trim();
    document.getElementById('uploaded').textContent = file.name + ': ' + text;
    post('upload:' + file.name + ':' + text);
  };
  document.getElementById('open').onclick = () => window.open('/popup');
</script>`,
    '/inner': `<!doctype html><input id="city" aria-label="City"><button id="send">Send</button>
<p id="sent"></p>
<script>
  document.getElementById('send').onclick = () => {
    const city = document.getElementById('city').value;
    document.getElementById('sent').textContent = 'Sent ' + city;
    fetch('/effect', { method: 'POST', body: 'frame:' + city });
  };
</script>`,
    '/popup': `<!doctype html><title>Popup</title><h1 id="popup-title">Popup page</h1>
<script>fetch('/effect', { method: 'POST', body: 'popup:opened' });</script>`,
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.method === 'GET' && pages[url.pathname]) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pages[url.pathname]);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/report.csv') {
        effects.push('download');
        res.writeHead(200, {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="report.csv"',
        });
        res.end('item,total\nbooks,3\n');
        return;
      }
      if (req.method === 'GET' && url.pathname === '/hold') {
        const key = url.searchParams.get('key') ?? '';
        held.set(key, [...(held.get(key) ?? []), res]);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/effect') {
        effects.push(body);
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
    held,
    close: () =>
      new Promise((resolve) => {
        for (const waiting of held.values())
          for (const res of waiting) res.writeHead(200, { 'Content-Type': 'text/html' }).end('');
        server.close(() => resolve());
      }),
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

async function publishedTest(
  page: Page,
  name: string,
  path: string,
  sequence: unknown[],
  extra: Record<string, unknown> = {},
): Promise<number> {
  const response = await page.request.post('/api/tests', {
    data: { name, url: `${fixture.baseUrl}${path}`, elements: [], sequence, ...extra },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { id } = (await response.json()) as { id: number };
  expect((await page.request.post(`/api/tests/${id}/publish`, { data: {} })).ok()).toBe(true);
  return id;
}

async function planOf(page: Page, testId: number, browserName: string): Promise<string> {
  const response = await page.request.post('/api/test-plans', {
    data: {
      name: unique('contract_plan'),
      selectedTests: [{ id: testId, type: 'ui' }],
      testMachinesConfig: [{ browserName, headless: true }],
      maxParallelTests: 1,
      captureScreenshots: 'never',
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function apiKey(page: Page): Promise<string> {
  const response = await page.request.post('/api/api-keys', {
    data: { name: unique('contracts'), scopes: ['runs:read', 'runs:write'] },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { key: string }).key;
}

interface CliOutcome {
  code: number;
  runId: string;
  files: Map<string, Buffer>;
  output: string;
}

/** The CLI as a pipeline runs it, in this process: same parsing, same exit code. */
async function cli(argv: string[], key: string): Promise<CliOutcome> {
  const parsed = parseArgs([...argv, '--url', BASE_URL, '--key', key, '--poll', '1', '--no-ci']);
  if ('error' in parsed) throw new Error(parsed.error);
  const files = new Map<string, Buffer>();
  const lines: string[] = [];
  const code = await runCli(parsed, {
    fetchImpl: fetch,
    writeFile: async (path, contents) => {
      files.set(path, Buffer.from(contents));
    },
    appendFile: async () => {},
    log: (line) => lines.push(line),
    error: (line) => lines.push(`error: ${line}`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    env: {},
  });
  const output = lines.join('\n');
  const runId = /Started run ([^\s.]+)/.exec(output)?.[1] ?? argv[1] ?? '';
  return { code, runId, files, output };
}

/** Reads a zip of stored entries, as the Allure export writes it. */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    files.set(name, buffer.subarray(start, start + size));
    offset += 46 + nameLength;
  }
  return files;
}

const allureStatuses = (zip: Buffer) =>
  [...readZip(zip).entries()]
    .filter(([name]) => name.endsWith('-result.json'))
    .map(([, data]) => {
      const result = JSON.parse(data.toString()) as { name: string; status: string };
      return `${result.name.startsWith('Run ') ? result.name : 'test'}:${result.status}`;
    })
    .sort();

const junitTotals = (xml: string) => {
  const root = /<testsuites [^>]*>/.exec(xml)?.[0] ?? '';
  const count = (name: string) => Number(new RegExp(`${name}="(\\d+)"`).exec(root)?.[1]);
  return { tests: count('tests'), failures: count('failures'), errors: count('errors') };
};

/**
 * Rejects the result of any test named contract_lost_*, the way a database refusing the write
 * would (P01): the run cannot account for that test and must not say it completed.
 */
async function withLostResults<T>(work: () => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const drop = 'DROP TRIGGER IF EXISTS e2e_contract_lost ON report_test_case_results';
  try {
    await client.query(`CREATE OR REPLACE FUNCTION e2e_contract_lost() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.test_name LIKE 'contract\\_lost\\_%' THEN
          RAISE EXCEPTION 'synthetic write rejection';
        END IF;
        RETURN NEW;
      END $$`);
    await client.query(drop);
    await client.query(`CREATE TRIGGER e2e_contract_lost BEFORE INSERT ON report_test_case_results
      FOR EACH ROW EXECUTE FUNCTION e2e_contract_lost()`);
    return await work();
  } finally {
    await client.query(drop);
    await client.query('DROP FUNCTION IF EXISTS e2e_contract_lost()');
    await client.end();
  }
}

test('one verdict per run on every surface: UI, APIs, CLI exit code, JUnit, HTML, PDF and Allure', async ({
  page,
}, info) => {
  // What is compared here is the server's reading of a run, which no engine changes.
  test.skip(info.project.name !== 'chromium', 'Verdicts are engine-independent');
  test.setTimeout(600_000);
  await register(page);
  const key = await apiKey(page);
  const assertOut = (expected: string) => [
    step('check', 'assertTextContains', expected, { selector: '#out' }),
  ];

  const cases = [
    {
      label: 'green',
      name: unique('contract_green'),
      sequence: assertOut('Ready'),
      extra: {},
      run: 'completed',
      exit: 0,
      junit: { tests: 1, failures: 0, errors: 0 },
      allure: ['test:passed'],
      row: 'Passed',
    },
    {
      label: 'fail',
      name: unique('contract_fail'),
      sequence: assertOut('Something else'),
      extra: {},
      run: 'failed',
      exit: 1,
      junit: { tests: 1, failures: 1, errors: 0 },
      allure: ['test:failed'],
      row: 'Failed',
    },
    {
      // A shared data set that does not exist: the test never gets to ask the application.
      label: 'test error',
      name: unique('contract_error'),
      sequence: assertOut('Ready'),
      extra: { dataset: [{ $sharedSet: 2_000_000_000 }] },
      run: 'failed',
      exit: 1,
      junit: { tests: 1, failures: 0, errors: 1 },
      allure: ['test:broken'],
      row: 'Error',
    },
    {
      // The test passes, but its result cannot be written down.
      label: 'incomplete',
      name: unique('contract_lost'),
      sequence: assertOut('Ready'),
      extra: {},
      run: 'error',
      exit: 1,
      junit: { tests: 1, failures: 0, errors: 1 },
      allure: ['Run error:broken'],
      row: null,
    },
  ];

  for (const c of cases) {
    const testId = await publishedTest(page, c.name, '/green', c.sequence, c.extra);
    const planId = await planOf(page, testId, 'chromium');
    const argv = ['run', planId, '--wait', '--junit', 'j.xml', '--html', 'r.html'];
    argv.push('--pdf', 'r.pdf', '--allure', 'a.zip', '--timeout', '300');
    const outcome =
      c.label === 'incomplete' ? await withLostResults(() => cli(argv, key)) : await cli(argv, key);
    const where = `${c.label}: ${outcome.output}`;
    expect(outcome.runId, where).toMatch(/^[0-9a-f-]{36}$/);
    const runId = outcome.runId;

    // The CLI's exit code, and the files it wrote for the pipeline.
    expect(outcome.code, where).toBe(c.exit);
    expect(junitTotals(outcome.files.get('j.xml')!.toString()), where).toEqual(c.junit);
    expect(outcome.files.get('r.html')!.toString(), where).toContain(`class="verdict v-${c.run}"`);
    expect(outcome.files.get('r.pdf')!.subarray(0, 5).toString(), where).toBe('%PDF-');
    expect(allureStatuses(outcome.files.get('a.zip')!), where).toEqual(c.allure);

    // The internal API and the public one.
    const internal = await (await page.request.get(`/api/test-plan-executions/${runId}`)).json();
    expect(internal.status, where).toBe(c.run);
    const v1 = await page.request.get(`/api/v1/runs/${runId}`, { headers: { 'X-API-Key': key } });
    expect((await v1.json()).status, where).toBe(c.run);
    const v1Junit = await page.request.get(`/api/v1/runs/${runId}/junit`, {
      headers: { 'X-API-Key': key },
    });
    expect(junitTotals(await v1Junit.text()), where).toEqual(c.junit);
    const exported = await page.request.get(`/api/test-plan-executions/${runId}/export/junit`);
    expect(junitTotals(await exported.text()), where).toEqual(c.junit);

    // The report's rows, and the page a person reads.
    const report = await (
      await page.request.get(`/api/test-plan-executions/${runId}/report`)
    ).json();
    const rows = Object.values(
      report.testGroupings as Record<
        string,
        { components: Record<string, { tests: { testName: string; status: string }[] }> }
      >,
    ).flatMap((group) => Object.values(group.components).flatMap((component) => component.tests));
    expect(
      rows.filter((r) => r.testName === c.name).map((r) => r.status),
      where,
    ).toEqual(c.row ? [c.row] : []);
    await page.goto(`/test-plans/${planId}/executions/${runId}/report`);
    await expect(page.getByTestId('run-status')).toContainText(c.run.toUpperCase());
    if (c.run === 'error') await expect(page.getByTestId('run-ending')).toBeVisible();
  }
});

test('dialog, upload, download, iframe and popup behave the same on every engine', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const browserName = info.project.name;
  await register(page);
  const frame = 'iframe[name="inner"]';
  const testId = await publishedTest(page, unique('contract_behaviours'), '/behaviours', [
    step('answer', 'handleDialog', 'accept:Ada'),
    step('ask', 'click', '', { selector: '#ask' }),
    step('greeted', 'assertTextContains', 'Hello Ada', { selector: '#out' }),
    step('upload', 'uploadFile', 'notes.txt|hello upload', { selector: '#file' }),
    step('uploaded', 'assertTextContains', 'notes.txt: hello upload', { selector: '#uploaded' }),
    step('download', 'expectDownload', 'name: report.csv; contains: total', { selector: '#dl' }),
    step('city', 'input', 'Torino', { selector: '#city', frameSelector: frame }),
    step('send', 'click', '', { selector: '#send', frameSelector: frame }),
    step('sent', 'assertTextContains', 'Sent Torino', { selector: '#sent', frameSelector: frame }),
    step('open', 'click', '', { selector: '#open' }),
    step('popup', 'switchTab', ''),
    step('popped', 'assertTextContains', 'Popup page', { selector: '#popup-title' }),
    step('close', 'closeTab'),
    step('back', 'assertTextContains', 'Hello Ada', { selector: '#out' }),
  ]);
  const planId = await planOf(page, testId, browserName);

  fixture.effects.length = 0;
  const started = await page.request.post(`/api/run-test-plan/${planId}`, { data: {} });
  expect(started.ok()).toBe(true);
  const runId = (await started.json()).data.id;
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/test-plan-executions/${runId}`)).json()).status,
      { timeout: 240_000 },
    )
    .not.toMatch(/^(queued|running)$/);
  const report = await (await page.request.get(`/api/test-plan-executions/${runId}/report`)).json();
  const rows = Object.values(
    report.testGroupings as Record<
      string,
      { components: Record<string, { tests: { status: string; reasonForFailure?: string }[] }> }
    >,
  ).flatMap((group) => Object.values(group.components).flatMap((component) => component.tests));
  expect(
    rows.map((r) => r.status),
    rows[0]?.reasonForFailure ?? '',
  ).toEqual(['Passed']);
  expect((await (await page.request.get(`/api/test-plan-executions/${runId}`)).json()).status).toBe(
    'completed',
  );
  expect([...fixture.effects].sort()).toEqual(
    [
      'dialog:Ada',
      'upload:notes.txt:hello upload',
      'download',
      'frame:Torino',
      'popup:opened',
    ].sort(),
  );
});

test('a run cancelled through the public API ends cancelled everywhere, on every engine', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const browserName = info.project.name;
  await register(page);
  const key = await apiKey(page);
  const hold = unique('hold');
  const testId = await publishedTest(page, unique('contract_cancel'), `/hold?key=${hold}`, [
    step('never', 'assertTextContains', 'unreachable', { selector: 'body' }),
  ]);
  const planId = await planOf(page, testId, browserName);
  const headers = { 'X-API-Key': key };

  const started = await page.request.post(`/api/v1/plans/${planId}/runs`, { headers, data: {} });
  expect(started.status(), await started.text()).toBe(202);
  const runId = ((await started.json()) as { id: string }).id;
  // The browser is on the page, waiting for it: the run is in the middle of its test.
  await expect.poll(() => fixture.held.get(hold)?.length ?? 0, { timeout: 120_000 }).toBe(1);

  const cancelled = await page.request.post(`/api/v1/runs/${runId}/cancel`, { headers, data: {} });
  expect(cancelled.ok(), await cancelled.text()).toBe(true);
  await expect
    .poll(
      async () => {
        const logs = await (
          await page.request.get(`/api/test-plan-executions/${runId}/logs`)
        ).json();
        return logs.some(
          (entry: { message: string }) =>
            entry.message === 'Stopping the run: the run was cancelled.',
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  for (const res of fixture.held.get(hold) ?? [])
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>Released</p>');
  fixture.held.delete(hold);

  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/runs/${runId}`, { headers })).json()).status,
      {
        timeout: 120_000,
      },
    )
    .toBe('cancelled');
  const status = await cli(['status', runId], key);
  expect(status.code, status.output).toBe(1);
  const junit = await (await page.request.get(`/api/v1/runs/${runId}/junit`, { headers })).text();
  expect(junitTotals(junit).errors).toBeGreaterThanOrEqual(1);
  expect(junit).toContain('<testcase name="Run cancelled"');
  await page.goto(`/test-plans/${planId}/executions/${runId}/report`);
  await expect(page.getByTestId('run-status')).toContainText('CANCELLED');
});
