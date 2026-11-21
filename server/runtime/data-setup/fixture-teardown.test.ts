import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'net';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { DataFixture } from '@shared/schema';
import { runDataFixtures, type AppliedFixture } from './fixture-runner';
import {
  policyRunsTeardown,
  runFixtureTeardowns,
  teardownReportSteps,
  type TeardownStatus,
} from './fixture-teardown';
import { openSqlSession } from './sql-session';

/**
 * Data fixture teardown against a real Postgres (PGlite behind a socket): what a run applied is
 * taken back last first, only what the run applied, by policy, and a failure never reaches the verdict.
 */

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
const order = (over: Partial<DataFixture> = {}): DataFixture => ({
  id: 'fx-order',
  name: 'An open order',
  alias: 'order',
  connection: null,
  params: [{ name: 'total', type: 'decimal', value: '42.50' }],
  check: 'SELECT id FROM orders WHERE customer_id = {{fx.customer.id}}',
  apply: 'INSERT INTO orders (customer_id, total) VALUES ({{fx.customer.id}}, {{params.total}})',
  teardown: 'DELETE FROM orders WHERE customer_id = {{fx.customer.id}}',
  outputs: ['id'],
  timeoutMs: 10_000,
  ...over,
});

// The test database is on 127.0.0.1, which the egress policy would refuse: vetting is not under test.
const vet = async () => ({ host: '127.0.0.1' });

describe('policyRunsTeardown', () => {
  it('always runs, onSuccess only after a pass, never does not run', () => {
    expect(policyRunsTeardown('always', false).run).toBe(true);
    expect(policyRunsTeardown('always', true).run).toBe(true);
    expect(policyRunsTeardown('onSuccess', true).run).toBe(true);
    expect(policyRunsTeardown('onSuccess', false).run).toBe(false);
    expect(policyRunsTeardown('never', true).run).toBe(false);
    expect(policyRunsTeardown('never', false).why).toMatch(/never/);
  });
});

describe('against a real Postgres', () => {
  let db: PGlite;
  let server: PGLiteSocketServer;
  let url: string;
  let vars: Record<string, string>;

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
  }, 60_000);

  afterAll(async () => {
    await server?.stop();
    await db?.close();
  });

  beforeEach(async () => {
    await db.exec(`DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS customers;
      CREATE TABLE customers (id serial PRIMARY KEY, email text UNIQUE NOT NULL);
      CREATE TABLE orders (id serial PRIMARY KEY, customer_id int NOT NULL REFERENCES customers(id), total numeric(10,2));`);
    vars = { 'db.url': url };
  });

  const count = async (table: string) =>
    Number(
      ((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0] as { n: number }).n,
    );

  const applyAll = async (fixtures: DataFixture[]) => {
    const result = await runDataFixtures(fixtures, vars, { dataSetup: true, vet });
    return { result, run: { ...vars, ...result.variables } };
  };

  it('takes the data back last first (the order references the customer)', async () => {
    const { result, run } = await applyAll([customer(), order()]);
    expect(result.applied.map((a) => a.alias)).toEqual(['customer', 'order']);
    expect(await count('orders')).toBe(1);
    const order_: string[] = [];
    const td = await runFixtureTeardowns(result.applied, { passed: true }, run, {
      vet,
      onStep: (s) => order_.push(s.alias),
    });
    // The foreign key would refuse removing the customer first: the order is proof of the sequence.
    expect(order_).toEqual(['order', 'customer']);
    expect(td.steps.map((s) => s.status)).toEqual(['done', 'done']);
    expect(await count('orders')).toBe(0);
    expect(await count('customers')).toBe(0);
  }, 30_000);

  it('only tears down what this run applied, not what was already there', async () => {
    await db.exec(`INSERT INTO customers (email) VALUES ('ann@shop.test')`);
    const { result, run } = await applyAll([customer(), order()]);
    expect(result.steps.map((s) => s.status)).toEqual(['satisfied', 'applied']);
    expect(result.applied.map((a) => a.alias)).toEqual(['order']);
    await runFixtureTeardowns(result.applied, { passed: true }, run, { vet });
    expect(await count('orders')).toBe(0);
    expect(await count('customers')).toBe(1);
  }, 30_000);

  it('leaves a fixture without a teardown out of the list', async () => {
    const { result } = await applyAll([customer({ teardown: null })]);
    expect(result.steps[0].status).toBe('applied');
    expect(result.applied).toEqual([]);
  }, 30_000);

  it('reports each applied fixture to onApplied right after its apply', async () => {
    const seen: string[] = [];
    await runDataFixtures([customer(), order()], vars, {
      dataSetup: true,
      vet,
      onApplied: async (a: AppliedFixture) => {
        seen.push(`${a.alias}:${await count('customers')}`);
      },
    });
    expect(seen).toEqual(['customer:1', 'order:1']);
  }, 30_000);

  it('does not run in preview and does not apply where setup is not allowed', async () => {
    const result = await runDataFixtures([customer()], vars, { dataSetup: false, vet });
    expect(result.applied).toEqual([]);
  }, 30_000);

  it('follows the policy: never keeps, onSuccess keeps only after a failure', async () => {
    for (const [policy, passed, removed] of [
      ['never', true, false],
      ['onSuccess', false, false],
      ['onSuccess', true, true],
      ['always', false, true],
    ] as const) {
      await db.exec('DELETE FROM customers');
      const { result, run } = await applyAll([customer({ teardownPolicy: policy })]);
      const td = await runFixtureTeardowns(result.applied, { passed }, run, { vet });
      expect(td.steps[0].status).toBe(removed ? 'done' : 'kept');
      expect(await count('customers')).toBe(removed ? 0 : 1);
    }
  }, 30_000);

  it('a failing teardown is a step, the others still run, and nothing throws', async () => {
    const { result, run } = await applyAll([
      customer(),
      order({ teardown: 'DELETE FROM no_such_table' }),
    ]);
    const settled: Array<[string, TeardownStatus]> = [];
    const td = await runFixtureTeardowns(result.applied, { passed: true }, run, {
      vet,
      ledger: {
        settle: async (a, status) => {
          settled.push([a.alias, status]);
        },
      },
    });
    // The order's teardown failed; the customer's ran after it. The foreign key then refuses the
    // customer too, which is a second failure, not a stop.
    expect(td.steps.map((s) => s.alias)).toEqual(['order', 'customer']);
    expect(td.steps[0].status).toBe('failed');
    expect(td.steps[0].detail).toMatch(/no_such_table/);
    expect(td.steps[0].detail).not.toContain('secret');
    expect(settled.map(([a]) => a)).toEqual(['order', 'customer']);
    const report = teardownReportSteps(td);
    expect(report[0]).toMatchObject({ type: 'cleanup', status: 'failed' });
    expect(report[0].name).toMatch(/Data fixture teardown: An open order/);
  }, 30_000);

  it('survives a ledger and a listener that throw', async () => {
    const { result, run } = await applyAll([customer()]);
    const td = await runFixtureTeardowns(result.applied, { passed: true }, run, {
      vet,
      ledger: {
        settle: async () => {
          throw new Error('ledger down');
        },
      },
      onStep: () => {
        throw new Error('listener down');
      },
    });
    expect(td.steps[0].status).toBe('done');
    expect(await count('customers')).toBe(0);
  }, 30_000);

  it('tears down each comparison side on its own connection, with its own values', async () => {
    const other = new PGlite();
    const port = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const otherServer = new PGLiteSocketServer({ db: other, port, host: '127.0.0.1' });
    await otherServer.start();
    try {
      await other.exec(
        `CREATE TABLE customers (id serial PRIMARY KEY, email text UNIQUE NOT NULL);`,
      );
      const otherUrl = `postgres://qa:secret@127.0.0.1:${port}/postgres?sslmode=disable`;
      const a = await applyAll([customer()]);
      const bVars = { 'db.url': otherUrl };
      const b = await runDataFixtures([customer()], bVars, { dataSetup: true, vet });
      expect(await count('customers')).toBe(1);
      expect(
        Number(
          ((await other.query('SELECT count(*)::int AS n FROM customers')).rows[0] as { n: number })
            .n,
        ),
      ).toBe(1);
      // Side B first: only B's database loses its row.
      await runFixtureTeardowns(b.applied, { passed: true }, { ...bVars, ...b.variables }, { vet });
      expect(await count('customers')).toBe(1);
      await runFixtureTeardowns(a.result.applied, { passed: true }, a.run, { vet });
      expect(await count('customers')).toBe(0);
    } finally {
      await otherServer.stop();
      await other.close();
    }
  }, 30_000);

  it('uses the injected session factory (the agent path) and not the server driver', async () => {
    const { result, run } = await applyAll([customer()]);
    const opened: string[] = [];
    const td = await runFixtureTeardowns(result.applied, { passed: true }, run, {
      vet,
      openSession: async (kind, u, timeoutMs, target) => {
        opened.push(kind);
        return openSqlSession(kind, u, timeoutMs, target);
      },
    });
    expect(opened).toEqual(['postgres']);
    expect(td.steps[0].status).toBe('done');
  }, 30_000);

  it('freezes only what the teardown references and never a secret', async () => {
    const { result } = await applyAll([customer()]);
    const frozen = JSON.stringify(result.applied[0]);
    expect(frozen).not.toContain('secret');
    expect(result.applied[0].params.map((p) => p.name)).toEqual(['email']);
    expect(result.applied[0].policy).toBe('always');
  }, 30_000);

  it('says what is wrong when the environment has no database any more', async () => {
    const { result } = await applyAll([customer()]);
    const td = await runFixtureTeardowns(result.applied, { passed: true }, {}, { vet });
    expect(td.steps[0].status).toBe('failed');
    expect(td.steps[0].detail).toMatch(/no database/);
  }, 30_000);
});
