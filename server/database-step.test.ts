import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'net';
import type { Page } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import {
  cellText,
  databaseKind,
  parseDatabaseQuery,
  redactMessage,
  redactUrl,
  resultVariables,
  runDatabaseQuery,
  sqlServerConfig,
  type DatabaseRunner,
} from './database-step';
import { executeStep, type ExecutableStep } from './step-executor';

/**
 * The queryDatabase step: a statement against the environment's database, its first row in
 * {{db.value}} and {{db.<column>}}, and assertCondition to check what came back.
 */

const step = (id: string, value: string): ExecutableStep => ({ action: { id, name: id }, value });
/** These steps never touch the page. */
const page = {} as Page;

describe('what the step asks for', () => {
  it('reads a statement, and one for a named connection', () => {
    expect(parseDatabaseQuery(' SELECT 1 ')).toEqual({ connection: null, sql: 'SELECT 1' });
    expect(parseDatabaseQuery('@reporting SELECT count(*)\nFROM t')).toEqual({ connection: 'reporting', sql: 'SELECT count(*)\nFROM t' });
    expect(parseDatabaseQuery('@reporting')).toMatchObject({ error: /not a SQL statement/ });
  });

  it('picks the driver from the scheme, and nothing else', () => {
    expect(databaseKind('postgres://u:p@h/db')).toBe('postgres');
    expect(databaseKind('postgresql://h/db')).toBe('postgres');
    expect(databaseKind('mariadb://h/db')).toBe('mysql');
    expect(databaseKind('sqlserver://h:1433/db')).toBe('sqlserver');
    expect(databaseKind('Server=h;Database=db')).toBeNull();
    expect(databaseKind('http://h')).toBeNull();
  });

  it('never repeats the password', () => {
    expect(redactUrl('postgres://qa:s3cr%40t@db:5432/shop')).toBe('postgres://qa:***@db:5432/shop');
    expect(redactMessage('login failed for qa with s3cr@t', 'postgres://qa:s3cr%40t@db/shop')).toBe('login failed for qa with ***');
  });

  it('reads a SQL Server address, with its instance and TLS flags', () => {
    const config = sqlServerConfig('sqlserver://sa:Pa%24%24@db%5CSQLEXPRESS:1433/Shop?encrypt=false&trustServerCertificate=true', 5000);
    expect(config).toMatchObject({
      server: 'db',
      port: 1433,
      user: 'sa',
      password: 'Pa$$',
      database: 'Shop',
      options: { encrypt: false, trustServerCertificate: true, instanceName: 'SQLEXPRESS' },
    });
    expect(sqlServerConfig('sqlserver://sa:x@db/Shop', 5000).options).toEqual({ encrypt: true, trustServerCertificate: false });
  });

  it('turns cells into the text a step types or compares', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(new Date('2026-09-30T10:00:00Z'))).toBe('2026-09-30T10:00:00.000Z');
    expect(cellText(12n)).toBe('12');
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    const vars = resultVariables({ columns: ['count(*)', 'status'], rows: [{ 'count(*)': 3, status: null }], rowCount: 1 });
    expect(vars).toMatchObject({ 'db.value': '3', 'db.count___': '3', 'db.status': '', 'db.rowCount': '1' });
    expect(JSON.parse(vars['db.json'])).toEqual([{ 'count(*)': 3, status: null }]);
  });
});

describe('against a real Postgres', () => {
  let db: PGlite;
  let server: PGLiteSocketServer;
  let url: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE TABLE orders (id serial PRIMARY KEY, email text, total numeric(10,2), placed_at timestamptz);
      INSERT INTO orders (email, total, placed_at) VALUES ('ann@shop.test', 42.50, '2026-09-30T10:00:00Z'), ('bob@shop.test', 10, NULL);`);
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

  it('reads rows and counts changes', async () => {
    const read = await runDatabaseQuery('postgres', url, "SELECT email, total FROM orders ORDER BY id", 10_000);
    expect(read.columns).toEqual(['email', 'total']);
    expect(read.rows).toEqual([{ email: 'ann@shop.test', total: '42.50' }, { email: 'bob@shop.test', total: '10.00' }]);
    expect(read.rowCount).toBe(2);

    const changed = await runDatabaseQuery('postgres', url, "UPDATE orders SET total = total + 1 WHERE email LIKE '%@shop.test'", 10_000);
    expect(changed).toMatchObject({ columns: [], rowCount: 2 });
  });

  it('checks an order the application wrote, and says what it read', async () => {
    const vars: Record<string, string> = { 'db.url': url, email: 'ann@shop.test' };
    const ctx = { page, vars };
    const read = await executeStep(ctx, step('queryDatabase', "SELECT count(*) AS n, max(placed_at) AS placed FROM orders WHERE email = '{{email}}'"));
    expect(read).toMatchObject({ status: 'passed', detail: '1 row(s); {{db.value}} = "1".' });
    expect(vars['db.n']).toBe('1');
    expect(vars['db.placed']).toBe('2026-09-30T10:00:00.000Z');
    expect(vars['db.rowCount']).toBe('1');

    expect(await executeStep(ctx, step('assertCondition', '{{db.value}} == 1'))).toMatchObject({ status: 'passed', detail: '"{{db.value}} == 1" (1 == 1) holds.' });
    expect(await executeStep(ctx, step('assertCondition', '{{db.n}} > 1'))).toMatchObject({ status: 'failed', error: '"{{db.n}} > 1" (1 > 1) does not hold.' });

    // The next query has other columns: the old ones do not answer for it.
    await executeStep(ctx, step('queryDatabase', 'SELECT email FROM orders WHERE false'));
    expect(vars['db.n']).toBeUndefined();
    expect(vars['db.value']).toBe('');
    expect(vars['db.email']).toBe('');
    expect(vars['db.rowCount']).toBe('0');
  });

  it('fails on a wrong statement with what the database said', async () => {
    const outcome = await executeStep({ page, vars: { 'db.url': url } }, step('queryDatabase', 'SELECT nope FROM orders'));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/^The database answered: .*nope/);
  });
});

describe('the step, whichever database', () => {
  const recorded: Array<{ kind: string; url: string; sql: string; timeoutMs: number }> = [];
  const database: DatabaseRunner = async (kind, url, sql, timeoutMs) => {
    recorded.push({ kind, url, sql, timeoutMs });
    if (sql.includes('boom')) throw new Error('Login failed for user qa with password hunter2');
    return { columns: ['status'], rows: [{ status: 'Paid' }], rowCount: 1 };
  };

  it('uses the named connection and its timeout', async () => {
    const vars: Record<string, string> = { 'db.reporting.url': 'sqlserver://qa:hunter2@db/Reports', 'db.timeout': '5' };
    const outcome = await executeStep({ page, vars, database }, step('queryDatabase', '@reporting SELECT status FROM orders'));
    expect(outcome.status).toBe('passed');
    expect(recorded.at(-1)).toEqual({ kind: 'sqlserver', url: 'sqlserver://qa:hunter2@db/Reports', sql: 'SELECT status FROM orders', timeoutMs: 5000 });
    expect(vars['db.status']).toBe('Paid');
  });

  it('keeps the password out of an error', async () => {
    const outcome = await executeStep({ page, vars: { 'db.url': 'mysql://qa:hunter2@db/shop' }, database }, step('queryDatabase', 'SELECT boom'));
    expect(outcome).toMatchObject({ status: 'failed', error: 'The database answered: Login failed for user qa with password ***' });
  });

  it('says what to configure, and refuses an address it cannot drive', async () => {
    expect(await executeStep({ page, vars: {}, database }, step('queryDatabase', 'SELECT 1'))).toMatchObject({ error: /add db\.url to the environment/ });
    expect(await executeStep({ page, vars: {}, database }, step('queryDatabase', '@crm SELECT 1'))).toMatchObject({ error: /add db\.crm\.url/ });
    expect(await executeStep({ page, vars: { 'db.url': 'oracle://h/x' }, database }, step('queryDatabase', 'SELECT 1'))).toMatchObject({ error: /not a postgres:\/\/, mysql:\/\/ or sqlserver:\/\// });
    expect(await executeStep({ page, vars: { 'db.url': 'postgres://h/x' }, database }, step('queryDatabase', 'SELECT {{missing}}'))).toMatchObject({ error: /Unresolved variable\(s\) missing/ });
  });

  it('does not show a secret an assertion compares', async () => {
    const outcome = await executeStep({ page, vars: { secret_pin: '1234' } }, step('assertCondition', '{{secret_pin}} == 9999'));
    expect(outcome).toMatchObject({ status: 'failed', error: '"{{secret_pin}} == 9999" does not hold.' });
    expect(await executeStep({ page, vars: {} }, step('assertCondition', 'a ~ b'))).toMatchObject({ status: 'failed', error: /is not a comparison/ });
  });
});
