/**
 * Data fixtures: the data a test needs in the application's database, made sure of before the
 * test runs (shared/schema/authoring.ts, DataFixtureSchema).
 *
 * A test written against a database someone filled by hand fails on an empty one, and not
 * because of anything the application does. A fixture states what the test needs as a query
 * that finds it (`check`) and a script that creates it (`apply`), and the runner reconciles the
 * two, in order, for each fixture:
 *
 *   1. Ask `check`. A row: the data is there, nothing is written ("satisfied").
 *   2. No row, and the environment does not allow data setup: fail, saying so. A database is
 *      never written to because a test happened to point at it.
 *   3. The identity guard: when the environment names the database it expects (db.expect),
 *      the connection must have reached that one, or nothing is written.
 *   4. In one transaction: take a lock named after the fixture and its values, ask `check`
 *      again (a parallel lane may have just created the data), run `apply`, commit. Any error
 *      rolls the whole script back.
 *   5. Ask `check` once more. A script that ran without creating what `check` looks for fails
 *      the fixture ("apply did not establish it"), rather than letting the test start from a
 *      state nobody intended.
 *   6. The columns named in `outputs`, from the row `check` found, become
 *      {{fx.<alias>.<column>}} for the fixtures after this one and for the test.
 *
 * Fail-fast, like the API preconditions next to which it runs (server/runtime/precondition-runner.ts):
 * a test whose data could not be made sure of is blocked, not run into a misleading failure.
 */

import { createHash } from 'node:crypto';
import type { DataFixture, DataFixtureParam } from '@shared/schema';
import { bindSql, splitBatches, type BoundSql } from '@shared/sql-template';
import {
  DATABASE_TIMEOUT_MS,
  cellText,
  databaseKind,
  redactMessage,
  redactUrl,
  vetDatabaseTarget,
  type DatabaseKind,
  type DatabaseResult,
  type DatabaseTarget,
} from '../database-step';
import { generate } from '../generators';
import { substituteVariables } from '../../platform/outbound-http';
import { openSqlSession, type SqlSession, type SqlSessionFactory } from './sql-session';

export type FixtureStatus = 'satisfied' | 'applied' | 'failed';

export interface FixtureStep {
  id: string;
  name: string;
  alias: string;
  status: FixtureStatus;
  /** What was found or done, or why it failed. Never a password. */
  detail: string;
  durationMs: number;
  /** {{fx.<alias>.<column>}} values this fixture set. */
  outputs: Record<string, string>;
}

export interface FixtureRunResult {
  ok: boolean;
  steps: FixtureStep[];
  /** Every output of every fixture that ran, as variables. */
  variables: Record<string, string>;
  failedAt?: string;
  reason?: string;
}

export interface FixtureRunOptions {
  /** Whether the environment allows writing what a fixture finds missing. */
  dataSetup: boolean;
  /** Stands in for the real drivers in tests. */
  openSession?: SqlSessionFactory;
  /** Stands in for the egress check in tests. */
  vet?: (kind: DatabaseKind, url: string) => Promise<DatabaseTarget>;
  signal?: AbortSignal;
}

/** The address a fixture writes with: db[.<name>].setup.url when set, else db[.<name>].url. */
export function fixtureConnection(
  connection: string | null | undefined,
  vars: Record<string, string>,
): { url: string; variable: string } | null {
  const base = connection ? `db.${connection}` : 'db';
  for (const variable of [`${base}.setup.url`, `${base}.url`]) {
    const url = vars[variable]?.trim();
    if (url) return { url, variable };
  }
  return null;
}

/** The database a connection must reach before anything is written: db[.<name>].expect. */
export function expectedIdentity(
  connection: string | null | undefined,
  vars: Record<string, string>,
): { database: string; server?: string } | null {
  const raw = vars[connection ? `db.${connection}.expect` : 'db.expect']?.trim();
  if (!raw) return null;
  const [database, server] = raw.split('@').map((part) => part.trim());
  return { database, ...(server ? { server } : {}) };
}

/** A parameter's value as the driver should receive it, or why it cannot be one. */
export function typedValue(param: DataFixtureParam, text: string): unknown | { error: string } {
  const value = text.trim();
  if (param.type === 'string') return text;
  if (value === '') return { error: `the parameter "${param.name}" has no value` };
  switch (param.type) {
    case 'int':
      return /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))
        ? Number(value)
        : { error: `"${value}" is not a whole number (parameter "${param.name}")` };
    case 'decimal':
      // Kept as text: a JavaScript number would round what the column stores exactly.
      return /^-?\d+(\.\d+)?$/.test(value)
        ? value
        : { error: `"${value}" is not a number (parameter "${param.name}")` };
    case 'bool':
      if (/^(true|1|yes)$/i.test(value)) return true;
      if (/^(false|0|no)$/i.test(value)) return false;
      return { error: `"${value}" is not true or false (parameter "${param.name}")` };
    case 'date':
      return Number.isNaN(Date.parse(value))
        ? { error: `"${value}" is not a date (parameter "${param.name}")` }
        : value;
  }
}

const isError = (value: unknown): value is { error: string } =>
  typeof value === 'object' && value !== null && 'error' in value;

class FixtureError extends Error {}

/** The output column of a row, by its exact name or, failing that, without case. */
function column(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name];
  const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : row[key];
}

/**
 * Runs a test's data fixtures in order against the databases its environment names.
 * `vars` are the run's variables: the environment's secrets (db.url and friends), the run's own
 * ({{run.tag}}) and the test's data. Fixture outputs are added as each fixture finishes.
 */
export async function runDataFixtures(
  fixtures: DataFixture[] | null | undefined,
  vars: Record<string, string>,
  options: FixtureRunOptions,
): Promise<FixtureRunResult> {
  const list = fixtures ?? [];
  const steps: FixtureStep[] = [];
  const variables: Record<string, string> = {};
  const open = options.openSession ?? openSqlSession;
  const vet = options.vet ?? ((kind, url) => vetDatabaseTarget(kind, url));
  // A connection's identity is asked once per run of the fixtures, not once per fixture.
  const verified = new Set<string>();

  for (const fixture of list) {
    const started = Date.now();
    const scope = { ...vars, ...variables };
    const step = (status: FixtureStatus, detail: string, outputs: Record<string, string> = {}) =>
      steps.push({
        id: fixture.id,
        name: fixture.name,
        alias: fixture.alias,
        status,
        detail,
        durationMs: Date.now() - started,
        outputs,
      });
    const fail = (reason: string): FixtureRunResult => {
      step('failed', reason);
      return { ok: false, steps, variables, failedAt: fixture.name, reason };
    };
    if (options.signal?.aborted) return fail('the run was stopped before this fixture');

    const connection = fixtureConnection(fixture.connection, scope);
    if (!connection) {
      const base = fixture.connection ? `db.${fixture.connection}` : 'db';
      return fail(
        `no database: the environment has no ${base}.url secret (or ${base}.setup.url to write with another user)`,
      );
    }
    const kind = databaseKind(connection.url);
    if (!kind)
      return fail(
        `${connection.variable} is not a database address: it starts with postgres://, mysql:// or sqlserver://`,
      );

    // The values, once per fixture: the same {{$uuid}} must mean the same row in check and apply.
    const values = new Map<string, unknown>();
    let resolveError: string | null = null;
    const resolve = (name: string): unknown => {
      if (values.has(name)) return values.get(name);
      let value: unknown;
      const param = /^params\.(\w+)$/.exec(name);
      const generator = /^\$(\w+)(?:\((.*)\))?$/.exec(name);
      if (param) {
        const declared = fixture.params.find((p) => p.name === param[1]);
        if (!declared) return undefined;
        const text = substituteVariables(declared.value, scope);
        const left = /\{\{\s*([^}]+?)\s*\}\}/.exec(text);
        if (left) {
          resolveError ??= `the parameter "${declared.name}" uses {{${left[1]}}}, which has no value`;
          return null;
        }
        const typed = typedValue(declared, text);
        if (isError(typed)) {
          resolveError ??= typed.error;
          return null;
        }
        value = typed;
      } else if (generator) {
        const made = generate(generator[1], generator[2], scope);
        if (made === null) return undefined;
        value = made;
      } else if (name in scope) {
        value = scope[name];
      } else {
        return undefined;
      }
      values.set(name, value);
      return value;
    };
    const bind = (script: string): BoundSql[] => {
      const batches: BoundSql[] = [];
      for (const batch of splitBatches(script)) {
        const bound = bindSql(kind, batch, resolve);
        if ('problems' in bound) throw new FixtureError(bound.problems[0]);
        if ('missing' in bound)
          throw new FixtureError(
            `the script uses ${bound.missing.map((n) => `{{${n}}}`).join(', ')}, which ${bound.missing.length === 1 ? 'has' : 'have'} no value`,
          );
        if (resolveError) throw new FixtureError(resolveError);
        batches.push(bound);
      }
      return batches;
    };

    const timeoutMs = fixture.timeoutMs ?? DATABASE_TIMEOUT_MS;
    let session: SqlSession | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      const checkBatches = bind(fixture.check);
      const applyBatches = bind(fixture.apply);
      const lockKey = `${fixture.id}:${createHash('sha256')
        .update(JSON.stringify([...values.entries()]))
        .digest('hex')}`;

      const work = async (): Promise<{ status: FixtureStatus; row: Record<string, unknown> }> => {
        const target = await vet(kind, connection.url);
        session = await open(kind, connection.url, timeoutMs, target);
        const s = session;
        const ask = async (): Promise<Record<string, unknown> | null> => {
          let last: DatabaseResult | null = null;
          for (const batch of checkBatches) last = await s.query(batch);
          return last && last.rows.length > 0 ? last.rows[0] : null;
        };

        const found = await ask();
        if (found) return { status: 'satisfied', row: found };
        if (!options.dataSetup)
          throw new FixtureError(
            'the data is missing, and this environment does not allow data setup (turn it on in the environment, or run on one that allows it)',
          );

        const expected = expectedIdentity(fixture.connection, scope);
        if (expected && !verified.has(connection.variable)) {
          const actual = await s.identity();
          const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
          if (
            !same(actual.database, expected.database) ||
            (expected.server !== undefined && !same(actual.server, expected.server))
          )
            throw new FixtureError(
              `the connection reached ${actual.database}${actual.server ? `@${actual.server}` : ''}, not ${expected.database}${expected.server ? `@${expected.server}` : ''} as the environment expects; nothing was written`,
            );
          verified.add(connection.variable);
        }

        await s.begin();
        try {
          await s.lock(lockKey, timeoutMs);
          // A parallel lane may have created it while this one waited for the lock.
          const meanwhile = await ask();
          if (meanwhile) {
            await s.commit();
            return { status: 'satisfied', row: meanwhile };
          }
          for (const batch of applyBatches) await s.query(batch);
          await s.commit();
        } catch (error) {
          await s.rollback();
          throw error;
        }
        const created = await ask();
        if (!created)
          throw new FixtureError(
            'the apply script ran, but the check still finds nothing: it does not create what the check looks for (the script was committed; look at what it wrote)',
          );
        return { status: 'applied', row: created };
      };

      const outcome = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new FixtureError(`no answer within ${Math.round(timeoutMs / 1000)}s`)),
            timeoutMs + 1000,
          );
          timer.unref?.();
        }),
      ]);

      const outputs: Record<string, string> = {};
      for (const name of fixture.outputs) {
        const value = column(outcome.row, name);
        if (value === undefined)
          return fail(
            `the check returns no column "${name}", which the fixture names as an output (it returns ${Object.keys(outcome.row).join(', ') || 'no columns'})`,
          );
        outputs[name] = cellText(value);
        variables[`fx.${fixture.alias}.${name}`] = outputs[name];
      }
      const where = redactUrl(connection.url).replace(/\?.*$/, '');
      step(
        outcome.status,
        outcome.status === 'satisfied'
          ? `already in ${where}`
          : `created in ${where}, and found by the check afterwards`,
        outputs,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(redactMessage(message, connection.url));
    } finally {
      clearTimeout(timer);
      await (session as SqlSession | null)?.close();
    }
  }
  return { ok: true, steps, variables };
}

/** One line of the test's steps in a report for each fixture: what was found, created or not. */
export function fixtureReportSteps(result: FixtureRunResult): Array<{
  name: string;
  type: 'fixture';
  status: 'passed' | 'failed';
  details: string;
  error?: string;
}> {
  return result.steps.map((s) => {
    const outputs = Object.entries(s.outputs)
      .map(([k, v]) => `fx.${s.alias}.${k} = ${v}`)
      .join(', ');
    return {
      name: `Data fixture: ${s.name}`,
      type: 'fixture',
      status: s.status === 'failed' ? 'failed' : 'passed',
      details: `${s.status === 'satisfied' ? 'Already there' : s.status === 'applied' ? 'Created' : 'Failed'}: ${s.detail}${outputs ? `. ${outputs}` : ''} (${s.durationMs} ms)`,
      ...(s.status === 'failed' ? { error: s.detail } : {}),
    };
  });
}
