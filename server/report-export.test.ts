import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

/**
 * Exported reports: HTML, PDF and Allure results, from one run.
 *
 * What is worth a test: the zip is one any unzip reads (checked by reading it back, CRCs
 * included); the HTML opens with nothing outside it, escapes what tests are called and what
 * they failed with, and embeds the failing screenshot; quarantine and retries survive into
 * Allure in Allure's own words, with a history id stable across runs; the PDF is a PDF; and
 * another organization's run is not there.
 */

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

const { privilegedDb } = await import('./db');
const { reportTestCaseResults, testPlanExecutions, testPlans, users } = await import('@shared/schema');
const { createTestOrganization } = await import('./tests/factories');
const { tenancyMiddleware, runAsOrganization } = await import('./middleware/tenancy');
const { default: reportsRoutes } = await import('./routes/reports.routes');
const { setArtifactStoreForTest } = await import('./artifact-store');
const { createZip, crc32 } = await import('./zip');
const { exportRun } = await import('./report-export');
const { historyIdFor } = await import('./allure-export');

/** Reads a stored-only zip back: what an unzip tool does, CRC check included. */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
    const crc = buffer.readUInt32LE(offset + 16);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    expect(buffer.readUInt32LE(local)).toBe(0x04034b50);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, data);
    offset += 46 + nameLength;
  }
  return files;
}

describe('the zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('reads back as written, names in UTF-8 included, and refuses a path that climbs out', () => {
    const zip = createZip([
      { name: 'a-result.json', data: Buffer.from('{"ok":true}') },
      { name: 'dir/café.txt', data: Buffer.from('ciao') },
      { name: 'empty.txt', data: Buffer.alloc(0) },
    ]);
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(['a-result.json', 'dir/café.txt', 'empty.txt']);
    expect(files.get('dir/café.txt')!.toString()).toBe('ciao');
    expect(() => createZip([{ name: '../evil', data: Buffer.alloc(1) }])).toThrow(/Refusing/);
  });
});

describe('exporting a run', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');
  let app: express.Express;
  let current: { id: number; username: string; organizationId: number; role: string };
  let org: number;
  let planId: string;
  let executionId: string;

  beforeAll(() => {
    app = express();
    app.use((req, _res, next) => {
      (req as any).user = current;
      (req as any).isAuthenticated = () => true;
      next();
    });
    app.use(tenancyMiddleware);
    app.use(reportsRoutes);
    setArtifactStoreForTest({
      kind: 'local',
      read: async (key: string) => (key.endsWith('/ui_2/step_fail.png') ? PNG : null),
      write: async () => {},
      open: async () => null,
      publishDirectory: async () => 0,
      deletePrefix: async () => 0,
    });
  });

  afterAll(() => setArtifactStoreForTest(undefined));

  beforeEach(async () => {
    org = await createTestOrganization('Export Org');
    const [user] = await privilegedDb.insert(users).values({ username: `exporter-${uuidv4().slice(0, 8)}`, password: 'x', organizationId: org, role: 'viewer' }).returning();
    current = { id: user.id, username: user.username, organizationId: org, role: 'viewer' };
    planId = uuidv4();
    executionId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'Nightly checkout', userId: user.id, organizationId: org } as any);
    await privilegedDb.insert(testPlanExecutions).values({
      id: executionId, organizationId: org, testPlanId: planId, status: 'failed', triggeredBy: 'scheduled',
      startedAt: new Date('2026-09-24T02:00:00Z'), completedAt: new Date('2026-09-24T02:03:00Z'), executionDurationMs: 180_000,
    } as any);
    const base = { organizationId: org, testPlanExecutionId: executionId, testType: 'ui', browser: 'chromium', startedAt: new Date('2026-09-24T02:00:10Z'), completedAt: new Date('2026-09-24T02:00:20Z'), durationMs: 10_000 };
    await privilegedDb.insert(reportTestCaseResults).values([
      { ...base, id: uuidv4(), testName: 'Login', status: 'Passed', attempts: 2, module: 'Auth' },
      {
        ...base, id: uuidv4(), testName: 'Pay <script>alert(1)</script>', status: 'Failed', module: 'Checkout', severity: 'Critical',
        reasonForFailure: 'Expected "Thank you" & got "Error"',
        screenshotUrl: `/results/${planId}/${executionId}/ui_2/step_fail.png`,
        detailedLog: JSON.stringify([
          { name: 'Open cart', type: 'navigate', status: 'passed', details: 'ok' },
          {
            name: 'Check accessibility', type: 'assertAccessible', status: 'failed', error: '1 accessibility violation',
            accessibility: { url: 'x', threshold: 'serious', blocking: 1, passes: 3, incomplete: 0, violations: [{ id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', helpUrl: 'u', tags: [], count: 2, targets: ['#pay'], blocking: true }] },
          },
          { name: 'Confirm', type: 'click', status: 'passed', details: 'never reached' },
        ]),
        networkSummary: { requests: 5, failed: 1, transferredBytes: 100, failures: [{ method: 'POST', url: 'https://shop.test/api/orders', status: 500, statusText: 'Internal Server Error', timeMs: 900, resourceType: 'fetch' }], slowest: [] },
      },
      { ...base, id: uuidv4(), testName: 'Search', status: 'Failed', quarantined: true, reasonForFailure: 'Timeout' },
    ] as any);
  });

  it('as HTML: self-contained, escaped, with what failed first and its screenshot embedded', async () => {
    const response = await request(app).get(`/api/test-plan-executions/${executionId}/export/html`).expect(200);

    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="nightly-checkout-[0-9a-f]{8}\.html"$/);
    const html = response.text;
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).toContain('Pay &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Expected &quot;Thank you&quot; &amp; got &quot;Error&quot;');
    expect(html).toContain('What failed (2)');
    expect(html).toContain(`src="data:image/png;base64,${PNG.toString('base64')}"`);
    expect(html).toContain('POST https://shop.test/api/orders → 500');
    expect(html).toContain('button-name (critical, 2 elements)');
    expect(html).toContain('in quarantine: did not fail the run');
    expect(html).toContain('2 attempts');
  });

  it('as Allure results: one per test, in Allure\'s own words for quarantine and retries', async () => {
    const response = await request(app)
      .get(`/api/test-plan-executions/${executionId}/export/allure`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toBe('application/zip');

    const files = readZip(response.body as Buffer);
    const results = [...files.entries()].filter(([name]) => name.endsWith('-result.json')).map(([, data]) => JSON.parse(data.toString()));
    expect(results).toHaveLength(3);
    const byName = (name: string) => results.find((r) => r.name === name);

    expect(byName('Login')).toMatchObject({ status: 'passed', statusDetails: { flaky: true } });
    expect(byName('Search')).toMatchObject({ status: 'failed', statusDetails: { muted: true, message: 'Timeout' } });
    const pay = byName('Pay <script>alert(1)</script>');
    expect(pay.historyId).toBe(historyIdFor(planId, { testName: 'Pay <script>alert(1)</script>', browser: 'chromium' }));
    expect(pay.labels).toEqual(expect.arrayContaining([{ name: 'severity', value: 'critical' }, { name: 'feature', value: 'Checkout' }, { name: 'parentSuite', value: 'Nightly checkout' }]));
    expect(pay.parameters).toContainEqual({ name: 'browser', value: 'chromium' });
    // The step after the one that failed never ran.
    expect(pay.steps.map((s: { status: string }) => s.status)).toEqual(['passed', 'failed', 'skipped']);
    expect(files.get(pay.attachments[0].source)).toEqual(PNG);
    expect(files.get('environment.properties')!.toString()).toContain('Plan=Nightly checkout');
    expect(JSON.parse(files.get('categories.json')!.toString()).map((c: { name: string }) => c.name)).toContain('Accessibility violations');
  });

  it('as PDF, rendered by a real browser', async () => {
    const exported = await runAsOrganization(org, () => exportRun(executionId, 'pdf'));
    expect(exported!.contentType).toBe('application/pdf');
    expect(exported!.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(exported!.body.length).toBeGreaterThan(5_000);
  }, 60_000);

  it('refuses a format it does not know, and does not find another organization\'s run', async () => {
    await request(app).get(`/api/test-plan-executions/${executionId}/export/docx`).expect(400);
    const other = await createTestOrganization('Other Export Org');
    current = { ...current, organizationId: other };
    await request(app).get(`/api/test-plan-executions/${executionId}/export/html`).expect(404);
  });
});
