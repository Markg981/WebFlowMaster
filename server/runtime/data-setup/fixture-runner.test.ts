import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'net';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { DataFixture, DataFixtureRef } from '@shared/schema';
import {
  expectedIdentity,
  fixtureConnection,
  fixtureReportSteps,
  runDataFixtures,
  typedValue,
} from './fixture-runner';

/**
 * Data fixtures against a real Postgres (PGlite behind a socket): an empty database gets the
 * data a test needs, a populated one is only read, and nothing is written where it should not be.
 */

const fixture = (over: Partial<DataFixture> = {}): DataFixture => ({
  id: 'fx-customer',
  name: 'Customer Ann',
  alias: 'customer',
  connection: null,
  params: [{ name: 'email', type: 'string', value: 'ann@shop.test' }],
  check: 'SELECT id, email FROM customers WHERE email = {{params.email}}',
  apply: 'INSERT INTO customers (email) VALUES ({{params.email}})',
  outputs: ['id'],
  timeoutMs: 10_000,
  ...over,
});

// The test database is on 127.0.0.1, which the egress policy would refuse: vetting is not under test.
const vet = async () => ({ host: '127.0.0.1' });

describe('helpers', () => {
  it('writes with db.setup.url when set, else db.url; a named connection likewise', () => {
    expect(fixtureConnection(null, { 'db.url': 'a', 'db.setup.url': 'b' })).toEqual({
      url: 'b',
      variable: 'db.setup.url',
    });
    expect(fixtureConnection('crm', { 'db.url': 'a', 'db.crm.url': 'c' })?.variable).toBe(
      'db.crm.url',
    );
    expect(fixtureConnection('crm', { 'db.url': 'a' })).toBeNull();
  });
  it('reads db.expect as DATABASE or DATABASE@SERVER', () => {
    expect(expectedIdentity(null, { 'db.expect': 'shop_qa' })).toEqual({ database: 'shop_qa' });
    expect(expectedIdentity('crm', { 'db.crm.expect': 'crm @ sql01' })).toEqual({
      database: 'crm',
      server: 'sql01',
    });
    expect(expectedIdentity(null, {})).toBeNull();
  });
  it('types parameter values', () => {
    const p = (type: 'int' | 'bool' | 'decimal' | 'date' | 'string') => ({
      name: 'x',
      type,
      value: '',
    });
    expect(typedValue(p('int'), '42')).toBe(42);
    expect(typedValue(p('int'), '4.2')).toHaveProperty('error');
    expect(typedValue(p('bool'), 'Yes')).toBe(true);
    expect(typedValue(p('decimal'), '10.50')).toBe('10.50');
    expect(typedValue(p('date'), 'not a date')).toHaveProperty('error');
    expect(typedValue(p('int'), '')).toHaveProperty('error');
    expect(typedValue(p('string'), '')).toBe('');
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

  it('creates what is missing on an empty database, and hands on its outputs', async () => {
    const result = await runDataFixtures(
      [
        fixture(),
        fixture({
          id: 'fx-order',
          name: 'An open order',
          alias: 'order',
          params: [{ name: 'total', type: 'decimal', value: '42.50' }],
          check: 'SELECT id FROM orders WHERE customer_id = {{fx.customer.id}}',
          apply:
            'INSERT INTO orders (customer_id, total) VALUES ({{fx.customer.id}}, {{params.total}})',
        }),
      ],
      vars,
      { dataSetup: true, vet },
    );
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(['applied', 'applied']);
    expect(result.variables['fx.customer.id']).toBe('1');
    expect(result.variables['fx.order.id']).toBe('1');
    expect(await count('orders')).toBe(1);
    expect(result.steps[0].detail).not.toContain('secret');
  }, 30_000);

  it('only reads when the data is already there', async () => {
    await db.exec(`INSERT INTO customers (email) VALUES ('ann@shop.test')`);
    const result = await runDataFixtures([fixture()], vars, { dataSetup: true, vet });
    expect(result.steps[0].status).toBe('satisfied');
    expect(await count('customers')).toBe(1);
  }, 30_000);

  it('runs twice without creating twice', async () => {
    await runDataFixtures([fixture()], vars, { dataSetup: true, vet });
    const again = await runDataFixtures([fixture()], vars, { dataSetup: true, vet });
    expect(again.steps[0].status).toBe('satisfied');
    expect(await count('customers')).toBe(1);
  }, 30_000);

  it('writes nothing where the environment does not allow data setup', async () => {
    const result = await runDataFixtures([fixture()], vars, { dataSetup: false, vet });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not allow data setup/);
    expect(await count('customers')).toBe(0);
  }, 30_000);

  it('writes nothing when the connection reached another database than expected', async () => {
    const result = await runDataFixtures(
      [fixture()],
      { ...vars, 'db.expect': 'shop_production' },
      { dataSetup: true, vet },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not shop_production/);
    expect(await count('customers')).toBe(0);
  }, 30_000);

  it('writes when the expected database is the one reached', async () => {
    const result = await runDataFixtures(
      [fixture()],
      { ...vars, 'db.expect': 'POSTGRES' },
      { dataSetup: true, vet },
    );
    expect(result.ok).toBe(true);
  }, 30_000);

  it('rolls the whole script back when a statement fails', async () => {
    const result = await runDataFixtures(
      [
        fixture({
          apply:
            'INSERT INTO customers (email) VALUES ({{params.email}})\nGO\nINSERT INTO orders (customer_id) VALUES (999)',
        }),
      ],
      vars,
      { dataSetup: true, vet },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/foreign key/i);
    expect(await count('customers')).toBe(0);
  }, 30_000);

  it('fails a script that does not create what the check looks for', async () => {
    const result = await runDataFixtures(
      [fixture({ apply: "INSERT INTO customers (email) VALUES ('someone@else.test')" })],
      vars,
      { dataSetup: true, vet },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/check still finds nothing/);
  }, 30_000);

  it('resolves a generator once, so check and apply see the same value', async () => {
    const result = await runDataFixtures(
      [
        fixture({
          params: [],
          check: 'SELECT id, email FROM customers WHERE email = {{$randomEmail}}',
          apply: 'INSERT INTO customers (email) VALUES ({{$randomEmail}})',
          outputs: ['email'],
        }),
      ],
      vars,
      { dataSetup: true, vet },
    );
    expect(result.ok, result.reason).toBe(true);
    expect(result.steps[0].status).toBe('applied');
  }, 30_000);

  it('fails without a database, and stops at the first failure', async () => {
    const result = await runDataFixtures(
      [fixture(), fixture({ id: 'b', alias: 'b' })],
      {},
      {
        dataSetup: true,
        vet,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.reason).toMatch(/db\.url/);
  });

  it('reports a step per fixture', async () => {
    const result = await runDataFixtures([fixture()], vars, { dataSetup: true, vet });
    const [step] = fixtureReportSteps(result);
    expect(step).toMatchObject({
      name: 'Data fixture: Customer Ann',
      type: 'fixture',
      status: 'passed',
    });
    expect(step.details).toMatch(/^Created: .*fx\.customer\.id = 1/);
  }, 30_000);

  it('runs library references as the expansion gives them, named with their version', async () => {
    const ref: DataFixtureRef = {
      kind: 'ref',
      id: 'r1',
      alias: 'customer',
      fixtureId: 1,
      version: 'latest',
      params: {},
    };
    const result = await runDataFixtures([ref], vars, {
      dataSetup: true,
      vet,
      expand: async () => [fixture({ source: { fixtureId: 1, key: 'customer', version: 3 } })],
    });
    expect(result.ok).toBe(true);
    expect(fixtureReportSteps(result)[0].name).toBe('Data fixture: Customer Ann (customer v3)');
  }, 30_000);

  it('fails a reference it cannot expand, before touching the database', async () => {
    const ref = {
      kind: 'ref',
      id: 'r1',
      alias: 'c',
      fixtureId: 1,
      version: 1,
      params: {},
    } as const;
    const without = await runDataFixtures([ref], vars, { dataSetup: true, vet });
    expect(without).toMatchObject({ ok: false, failedAt: 'Data fixture library' });
    const refused = await runDataFixtures([ref], vars, {
      dataSetup: true,
      vet,
      expand: async () => {
        throw new Error('the library fixture 1 has no version 1');
      },
    });
    expect(refused.reason).toBe('the library fixture 1 has no version 1');
    expect(await count('customers')).toBe(0);
  });
});
