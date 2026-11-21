/**
 * Data fixtures: taking back what a run made (release 4 of the data fixtures design).
 *
 * A fixture's `apply` leaves data in the application's database. When the fixture has a
 * `teardown`, the run undoes it after the test, whatever became of the test, so the database does
 * not fill with what tests created:
 *
 *   - In the reverse of the order `apply` ran, so what was made last is removed first.
 *   - Only the fixtures whose `apply` ran in this run (FixtureRunResult.applied). Data a fixture's
 *     `check` found already there is somebody else's and is left alone.
 *   - On the connection the setup used, with the same identity guard: the data goes away from the
 *     database it was written to, and never from another one.
 *   - By the policy: `always`, `onSuccess` (kept for a person to look at when the test failed) or
 *     `never`.
 *
 * It never changes the test's verdict and never throws: a teardown that fails is a line in the
 * report, a warning in the run log and a row in the ledger, and the teardowns after it still run.
 */

import { bindSql, splitBatches, type BoundSql } from '@shared/sql-template';
import {
  DATABASE_TIMEOUT_MS,
  databaseKind,
  redactMessage,
  redactUrl,
  vetDatabaseTarget,
  type DatabaseKind,
  type DatabaseTarget,
} from '../database-step';
import {
  expectedIdentity,
  fixtureConnection,
  typedValue,
  type AppliedFixture,
} from './fixture-runner';
import { openSqlSession, type SqlSession, type SqlSessionFactory } from './sql-session';

/** `kept`: not run, by policy. */
export type TeardownStatus = 'done' | 'failed' | 'kept';

export interface TeardownStep {
  id: string;
  name: string;
  alias: string;
  status: TeardownStatus;
  detail: string;
  durationMs: number;
  source?: string;
}

export interface TeardownResult {
  steps: TeardownStep[];
}

/** What the run needs of the ledger: to be told how each teardown ended. Failing to is not an error. */
export interface TeardownLedger {
  settle(applied: AppliedFixture, status: TeardownStatus, detail: string): Promise<void>;
}

export interface TeardownOptions {
  /** Stands in for the real drivers in tests. */
  openSession?: SqlSessionFactory;
  /** Stands in for the egress check in tests. */
  vet?: (kind: DatabaseKind, url: string) => Promise<DatabaseTarget>;
  ledger?: TeardownLedger;
  /** Called after each one, so a long list shows in the run log as it goes. */
  onStep?: (step: TeardownStep) => void;
}

/** Whether the policy asks for the teardown, given how the test ended. */
export function policyRunsTeardown(
  policy: AppliedFixture['policy'],
  testPassed: boolean,
): { run: boolean; why?: string } {
  if (policy === 'never')
    return { run: false, why: 'the fixture asks to keep its data (teardown policy: never)' };
  if (policy === 'onSuccess' && !testPassed)
    return {
      run: false,
      why: 'the test did not pass, and the fixture keeps its data then (teardown policy: onSuccess)',
    };
  return { run: true };
}

/**
 * Runs one teardown: its batches in one transaction, on a session of its own. Throws on failure;
 * the caller turns that into a step.
 */
export async function runOneTeardown(
  applied: AppliedFixture,
  vars: Record<string, string>,
  options: Pick<TeardownOptions, 'openSession' | 'vet'>,
  verified: Set<string>,
): Promise<string> {
  const scope = { ...vars, ...applied.bindings };
  const connection = fixtureConnection(applied.connection, scope);
  if (!connection) {
    const base = applied.connection ? `db.${applied.connection}` : 'db';
    throw new Error(
      `no database: the environment has no ${base}.url secret (or ${base}.setup.url)`,
    );
  }
  const kind = databaseKind(connection.url);
  if (!kind) throw new Error(`${connection.variable} is not a database address`);

  const resolveError: { value: string | null } = { value: null };
  const resolve = (name: string): unknown => {
    const param = /^params\.(\w+)$/.exec(name);
    if (param) {
      const frozen = applied.params.find((p) => p.name === param[1]);
      if (!frozen) return undefined;
      const typed = typedValue(
        { name: frozen.name, type: frozen.type, value: frozen.value },
        frozen.value,
      );
      if (typeof typed === 'object' && typed !== null && 'error' in typed) {
        resolveError.value ??= (typed as { error: string }).error;
        return null;
      }
      return typed;
    }
    return name in scope ? scope[name] : undefined;
  };
  const batches: BoundSql[] = [];
  for (const batch of splitBatches(applied.teardown)) {
    const bound = bindSql(kind, batch, resolve);
    if ('problems' in bound) throw new Error(bound.problems[0]);
    if ('missing' in bound)
      throw new Error(
        `the teardown uses ${bound.missing.map((n) => `{{${n}}}`).join(', ')}, which ${bound.missing.length === 1 ? 'has' : 'have'} no value`,
      );
    if (resolveError.value) throw new Error(resolveError.value);
    batches.push(bound);
  }

  const timeoutMs = applied.timeoutMs ?? DATABASE_TIMEOUT_MS;
  const open = options.openSession ?? openSqlSession;
  const vet = options.vet ?? ((k, url) => vetDatabaseTarget(k, url));
  let session: SqlSession | null = null;
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = async () => {
      const target = await vet(kind, connection.url);
      const s = await open(kind, connection.url, timeoutMs, target);
      session = s;
      const expected = expectedIdentity(applied.connection, scope);
      if (expected && !verified.has(connection.variable)) {
        const actual = await s.identity();
        const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
        if (
          !same(actual.database, expected.database) ||
          (expected.server !== undefined && !same(actual.server, expected.server))
        )
          throw new Error(
            `the connection reached ${actual.database}${actual.server ? `@${actual.server}` : ''}, not ${expected.database}${expected.server ? `@${expected.server}` : ''} as the environment expects; nothing was removed`,
          );
        verified.add(connection.variable);
      }
      await s.begin();
      try {
        for (const batch of batches) await s.query(batch);
        await s.commit();
      } catch (error) {
        await s.rollback().catch(() => undefined);
        throw error;
      }
    };
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no answer within ${Math.round(timeoutMs / 1000)}s`)),
          timeoutMs + 1000,
        );
        timer.unref?.();
      }),
    ]);
    return `removed from ${redactUrl(connection.url).replace(/\?.*$/, '')}`;
  } catch (error) {
    throw new Error(
      redactMessage(error instanceof Error ? error.message : String(error), connection.url),
    );
  } finally {
    clearTimeout(timer);
    await (session as SqlSession | null)?.close().catch(() => undefined);
  }
}

/**
 * Tears down what the run applied, last first. `vars` are the run's variables (the environment's
 * database addresses among them), as the fixtures ran with.
 */
export async function runFixtureTeardowns(
  applied: readonly AppliedFixture[],
  outcome: { passed: boolean },
  vars: Record<string, string>,
  options: TeardownOptions = {},
): Promise<TeardownResult> {
  const steps: TeardownStep[] = [];
  const verified = new Set<string>();
  for (const item of [...applied].reverse()) {
    const started = Date.now();
    let status: TeardownStatus;
    let detail: string;
    const decision = policyRunsTeardown(item.policy, outcome.passed);
    if (!decision.run) {
      status = 'kept';
      detail = decision.why ?? 'kept';
    } else {
      try {
        detail = await runOneTeardown(item, vars, options, verified);
        status = 'done';
      } catch (error) {
        status = 'failed';
        detail = error instanceof Error ? error.message : String(error);
      }
    }
    const step: TeardownStep = {
      id: item.id,
      name: item.name,
      alias: item.alias,
      status,
      detail,
      durationMs: Date.now() - started,
      ...(item.source ? { source: item.source } : {}),
    };
    steps.push(step);
    try {
      await options.ledger?.settle(item, status, detail);
    } catch {
      // The ledger is a safety net: not being able to write to it must not stop the others.
    }
    try {
      options.onStep?.(step);
    } catch {
      // A listener that throws does not stop the teardowns either.
    }
  }
  return { steps };
}

/** One line of the test's steps for each teardown, after the cleanup's. Never fails the test. */
export function teardownReportSteps(result: TeardownResult): Array<{
  name: string;
  type: 'cleanup';
  status: 'passed' | 'failed';
  details: string;
  error?: string;
}> {
  return result.steps.map((s) => ({
    name: `Data fixture teardown: ${s.name}${s.source ? ` (${s.source})` : ''}`,
    type: 'cleanup',
    status: s.status === 'failed' ? 'failed' : 'passed',
    details: `${s.status === 'done' ? 'Removed' : s.status === 'kept' ? 'Kept' : 'Failed'}: ${s.detail} (${s.durationMs} ms)`,
    ...(s.status === 'failed' ? { error: s.detail } : {}),
  }));
}
