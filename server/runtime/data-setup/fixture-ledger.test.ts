import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import net from 'net';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { auditLog, environments, fixtureLedger, type DataFixture } from '@shared/schema';
import { privilegedDb } from '../../platform/db';
import { ADVISORY_KEYS, withAdvisoryLock } from '../../platform/advisory-lock';
import { createTestOrganization, createTestUser } from '../../tests/factories';
import { runDataFixtures } from './fixture-runner';
import { runFixtureTeardowns } from './fixture-teardown';
import {
  createRunLedger,
  retryLedgerRow,
  startFixtureTeardownSweep,
  sweepStaleTeardowns,
} from './fixture-ledger';

vi.mock('../../platform/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));

// The environment's variables come from the secrets store; here they are the test database's address.
const mocked = vi.hoisted(() => ({ url: '' }));
vi.mock('../variables', () => ({
  environmentAllowsDataSetup: vi.fn(async () => true),
  resolveVariables: vi.fn(async () => ({ 'db.url': mocked.url })),
}));

/**
 * The ledger's write path, the manual retry and the sweep, on the application's own database
 * (the ledger) and a real Postgres for the fixtures (PGlite behind a socket).
 */

const vet = async () => ({ host: '127.0.0.1' });

const customer = (over: Partial<DataFixture> = {}): DataFixture => ({
  id: 'fx-customer',
  name: 'Customer Ann',
  alias: 'customer',
  connection: null,
  params: [{ name: 'email', type: 'string', value: 'ann@shop.test' }],
  check: 'SELECT id, email FROM customers WHERE email = {{params.email}}',
  apply: 'INSERT INTO customers (email) VALUES ({{params.email}})',
  teardown: 'DELETE FROM customers WHERE email = {{params.email}}',
  outputs: ['id'],
  timeoutMs: 10_000,
  ...over,
});

describe('the fixture ledger', () => {
  let db: PGlite;
  let server: PGLiteSocketServer;
  let url: string;
  let organizationId: number;
  let environmentId: number;
  let runCounter = 0;

  beforeAll(async () => {
    db = new PGlite();
    const port = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
    await server.start();
    url = `postgres://qa:secret@127.0.0.1:${port}/postgres?sslmode=disable`;
    mocked.url = url;
    organizationId = await createTestOrganization('Ledger org');
    const userId = await createTestUser(organizationId);
    const [env] = await privilegedDb
      .insert(environments)
      .values({ name: 'ledger-env', userId, organizationId, dataSetup: true })
      .returning();
    environmentId = env.id;
  }, 60_000);

  afterAll(async () => {
    await server?.stop();
    await db?.close();
  });

  beforeEach(async () => {
    await db.exec(`DROP TABLE IF EXISTS customers;
      CREATE TABLE customers (id serial PRIMARY KEY, email text UNIQUE NOT NULL);`);
  });

  const customers = async () =>
    Number(((await db.query('SELECT count(*)::int AS n FROM customers')).rows[0] as { n: number }).n);
  const newRun = () => {
    const runId = `run-ledger-${Date.now()}-${++runCounter}`;
    return { runId, ledger: createRunLedger({ organizationId, runId, testId: null, environmentId }) };
  };
  const rowsOf = (runId: string) =>
    privilegedDb.select().from(fixtureLedger).where(eq(fixtureLedger.runId, runId));
  const apply = async (fixtures: DataFixture[], ledger: ReturnType<typeof createRunLedger>) =>
    runDataFixtures(fixtures, { 'db.url': url }, {
      dataSetup: true,
      vet,
      onApplying: (a) => ledger.reserve(a),
      onApplyAborted: (a) => ledger.abort(a),
      onApplied: (a) => ledger.confirm(a),
    });

  it('writes the row before the apply, confirms it after the commit and settles it as done', async () => {
    const { runId, ledger } = newRun();
    let seenDuringApply: string | undefined;
    const result = await runDataFixtures(
      [customer({ teardown: 'DELETE FROM customers WHERE id = {{fx.customer.id}}' })],
      { 'db.url': url },
      {
        dataSetup: true,
        vet,
        onApplying: async (a) => {
          await ledger.reserve(a);
          seenDuringApply = (await rowsOf(runId))[0]?.status;
        },
        onApplyAborted: (a) => ledger.abort(a),
        onApplied: (a) => ledger.confirm(a),
      },
    );
    expect(seenDuringApply).toBe('applying');
    const [confirmed] = await rowsOf(runId);
    expect(confirmed.status).toBe('pending');
    expect(confirmed.bindings['fx.customer.id']).toBeDefined();

    const td = await runFixtureTeardowns(result.applied, { passed: true }, { 'db.url': url, ...result.variables }, {
      vet,
      ledger,
    });
    expect(td.steps.map((s) => s.status)).toEqual(['done']);
    const [settled] = await rowsOf(runId);
    expect(settled.status).toBe('done');
    expect(settled.attempts).toBe(1);
    expect(settled.settledAt).not.toBeNull();
    expect(await customers()).toBe(0);
  }, 30_000);

  it('leaves no row behind when the apply does not commit', async () => {
    const { runId, ledger } = newRun();
    const result = await apply([customer({ apply: 'INSERT INTO nowhere (x) VALUES (1)' })], ledger);
    expect(result.steps[0].status).toBe('failed');
    expect(await rowsOf(runId)).toEqual([]);
    expect(await customers()).toBe(0);
  }, 30_000);

  it('keeps the row when the teardown is skipped by policy, or fails', async () => {
    const skipped = newRun();
    const first = await apply([customer({ teardown: 'DELETE FROM customers' })], skipped.ledger);
    await runFixtureTeardowns(first.applied.map((a) => ({ ...a, policy: 'never' as const })), { passed: true }, first.variables, {
      vet,
      ledger: skipped.ledger,
    });
    expect((await rowsOf(skipped.runId))[0].status).not.toBe('done');

    await db.exec('DELETE FROM customers');
    const failing = newRun();
    const second = await apply([customer({ teardown: 'DELETE FROM missing_table' })], failing.ledger);
    const td = await runFixtureTeardowns(second.applied, { passed: true }, second.variables, {
      vet,
      ledger: failing.ledger,
    });
    expect(td.steps[0].status).toBe('failed');
    const [row] = await rowsOf(failing.runId);
    expect(row.status).toBe('failed');
    expect(row.detail).toBeTruthy();
    const audits = await privilegedDb.select().from(auditLog).where(eq(auditLog.targetId, row.id));
    expect(audits.some((a) => a.action === 'DATA_FIXTURE_TEARDOWN_FAILED' || /TEARDOWN_FAILED/i.test(String(a.action)))).toBe(true);
  }, 30_000);

  it('retries a pending row to done, and reports a failure without claiming twice', async () => {
    const { runId, ledger } = newRun();
    await apply([customer()], ledger);
    expect(await customers()).toBe(1);
    const [row] = await rowsOf(runId);

    const done = await retryLedgerRow(organizationId, row.id, { userId: 0, vet });
    expect(done.outcome).toBe('done');
    expect(await customers()).toBe(0);
    expect((await rowsOf(runId))[0].status).toBe('done');
    // A settled row is not run again.
    expect(await retryLedgerRow(organizationId, row.id, { userId: 0, vet })).toMatchObject({
      outcome: 'not-claimable',
      status: 'done',
    });

    const broken = newRun();
    await apply([customer({ teardown: 'DELETE FROM missing_table' })], broken.ledger);
    const [failedRow] = await rowsOf(broken.runId);
    const failed = await retryLedgerRow(organizationId, failedRow.id, { userId: 0, vet });
    expect(failed.outcome).toBe('failed');
    expect((await rowsOf(broken.runId))[0].status).toBe('failed');
    expect(await retryLedgerRow(organizationId, 999_999_999, { userId: 0, vet })).toEqual({
      outcome: 'not-found',
    });
  }, 30_000);

  it('does not claim an apply still in flight, but does once it is old', async () => {
    const { runId, ledger } = newRun();
    // Reserve and never confirm: the worker died in the middle of the apply.
    await ledger.reserve({
      id: 'x',
      name: 'Customer Ann',
      alias: 'customer',
      connection: null,
      timeoutMs: 10_000,
      teardown: 'DELETE FROM customers',
      policy: 'always',
      params: [],
      bindings: {},
    });
    const [row] = await rowsOf(runId);
    expect(row.status).toBe('applying');
    expect(await retryLedgerRow(organizationId, row.id, { userId: 0, vet })).toMatchObject({
      outcome: 'not-claimable',
      status: 'applying',
    });
    const later = new Date(Date.now() + 11 * 60_000);
    const result = await retryLedgerRow(organizationId, row.id, { userId: 0, vet, now: later });
    expect(result.outcome).toBe('done');
  }, 30_000);

  describe('the sweep', () => {
    const seed = async (policy: string, status: string, ageMinutes: number) => {
      const [row] = await privilegedDb
        .insert(fixtureLedger)
        .values({
          organizationId,
          runId: `sweep-${Date.now()}-${++runCounter}`,
          environmentId,
          alias: 'customer',
          name: 'Customer Ann',
          policy,
          status,
          entry: {
            name: 'Customer Ann',
            alias: 'customer',
            connection: null,
            timeoutMs: 10_000,
            teardown: 'DELETE FROM customers',
            params: [],
          },
          appliedAt: new Date(Date.now() - ageMinutes * 60_000),
        })
        .returning();
      return row.id;
    };
    const statusOf = async (id: number) =>
      (await privilegedDb.select().from(fixtureLedger).where(eq(fixtureLedger.id, id)))[0].status;

    it('runs stale always rows, keeps the other policies, leaves fresh ones and failed ones', async () => {
      const always = await seed('always', 'pending', 600);
      const staleApplying = await seed('always', 'applying', 600);
      const onSuccess = await seed('onSuccess', 'pending', 600);
      const never = await seed('never', 'pending', 600);
      const fresh = await seed('always', 'pending', 1);
      const failed = await seed('always', 'failed', 600);
      const report = await sweepStaleTeardowns({ vet });
      expect(report.retried).toBeGreaterThanOrEqual(2);
      expect(await statusOf(always)).toBe('done');
      expect(await statusOf(staleApplying)).toBe('done');
      expect(await statusOf(onSuccess)).toBe('kept');
      expect(await statusOf(never)).toBe('kept');
      expect(await statusOf(fresh)).toBe('pending');
      expect(await statusOf(failed)).toBe('failed');
    }, 30_000);

    describe('the timer', () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('does nothing while another instance holds the lock, and sweeps when it is free', async () => {
        const id = await seed('never', 'pending', 600);
        const stop = startFixtureTeardownSweep(60_000);
        try {
          await withAdvisoryLock(ADVISORY_KEYS.fixtureTeardownSweep, async () => {
            await vi.advanceTimersByTimeAsync(3 * 60_000 + 1);
            expect(await statusOf(id)).toBe('pending');
          });
          await vi.advanceTimersByTimeAsync(60_000);
          await vi.waitFor(async () => expect(await statusOf(id)).toBe('kept'), { timeout: 10_000 });
        } finally {
          stop();
        }
      }, 30_000);
    });
  });
});
