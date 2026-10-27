import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { egressPolicyDeps } from '../platform/egress-policy';
import { vetDatabaseTarget, type DatabaseRunner } from './database-step';
import { executeStep, type ExecutableStep } from '../web/step-executor';

/** The queryDatabase step goes through the egress policy before any driver is invoked (audit A-01). */

const step = (value: string): ExecutableStep => ({
  action: { id: 'queryDatabase', name: 'queryDatabase' },
  value,
});
const page = {} as Page;
const original = { ...egressPolicyDeps };

afterEach(() => {
  vi.unstubAllEnvs();
  Object.assign(egressPolicyDeps, original);
});

const run = async (url: string) => {
  const database = vi.fn<DatabaseRunner>(async () => ({ columns: [], rows: [], rowCount: 0 }));
  const vars: Record<string, string> = { 'db.url': url };
  const result = await executeStep(
    { page, vars, database, storeVariable: (k: string, v: string) => (vars[k] = v) } as any,
    step('SELECT 1'),
  );
  return { result, database };
};

describe('queryDatabase and the egress policy', () => {
  it.each([
    'postgres://u:secretpw@10.0.0.5:5432/x',
    'mysql://u:secretpw@192.168.1.9/x',
    'sqlserver://sa:secretpw@169.254.169.254:1433/x',
    'sqlserver://sa:secretpw@10.1.1.1\\SQLEXPRESS/x',
    'postgres://u:secretpw@public.example/x?host=10.0.0.5',
    'postgres://u:secretpw@public.example/x?host=%2Fvar%2Frun%2Fpostgresql',
    'mysql://u:secretpw@public.example/x?socketPath=/var/run/mysqld/mysqld.sock',
    'postgres:///x',
  ])('refuses %s when private targets are denied, without a driver', async (url) => {
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'deny');
    const { result, database } = await run(url);
    expect(JSON.stringify(result)).toMatch(/egress policy/);
    expect(database).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves to a private or metadata address (rebinding)', async () => {
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'deny');
    egressPolicyDeps.lookupAll = async () => [{ address: '10.0.0.7', family: 4 }];
    const first = await run('postgres://u:secretpw@db.example/x');
    expect(first.database).not.toHaveBeenCalled();
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'allow');
    egressPolicyDeps.lookupAll = async () => [{ address: '169.254.169.254', family: 4 }];
    const second = await run('mysql://u:secretpw@db.example/x');
    expect(second.database).not.toHaveBeenCalled();
  });

  it('hands the driver the verified address', async () => {
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'deny');
    egressPolicyDeps.lookupAll = async () => [{ address: '93.184.216.34', family: 4 }];
    const { database } = await run('postgres://u:secretpw@db.example:5433/x');
    expect(database).toHaveBeenCalledOnce();
    expect(database.mock.calls[0][4]).toEqual({
      host: 'db.example',
      port: 5433,
      ip: '93.184.216.34',
    });
  });

  it('keeps private and socket targets working by default', async () => {
    const { database } = await run('postgres://u:secretpw@10.0.0.5:5432/x');
    expect(database).toHaveBeenCalledOnce();
    await expect(
      vetDatabaseTarget('mysql', 'mysql://u:secretpw@h/x?socketPath=/tmp/s.sock'),
    ).resolves.toBeDefined();
  });
});
