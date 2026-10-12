import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { localDir } from './local-dir.mjs';

/**
 * A volume test of the tables that grow with every run: execution_logs, report_test_case_results
 * and test_plan_executions. The load test (scripts/wfm-load.ts) measures a busy installation for
 * minutes, on whatever data it has; this one asks what a year of runs does to the queries people
 * wait on — the log console of a run, its results, the run history, the dashboard, a test's
 * history — and to the retention sweep.
 *
 *   npx tsx scripts/wfm-volume.ts --database-url postgres://…/wfm_volume [options]
 *
 * It writes generated data, millions of rows with the defaults, so it runs only against a
 * database of its own: migrated (npm run db:migrate), and holding no organization but the ones it
 * creates (named wfm-volume-N). It refuses anything else.
 *
 * Three phases:
 *   1. Generate --months of runs, month by month, server side (generate_series), for --orgs
 *      organizations sharing --runs-per-day; each run has --results-per-run results and
 *      --logs-per-run log lines. Runs older than ARTIFACT_RETENTION_DAYS (90) are marked as purged,
 *      as the sweep would have left them. Skipped with --measure-only.
 *   2. Measure: each query is run --repeat times with EXPLAIN (ANALYZE, BUFFERS) as app_user under
 *      the first organization's RLS, as the application runs it; the median is kept, with every
 *      sequential scan of a big table the plan contains.
 *   3. Probe what row retention would cost without partitions: one month of the first
 *      organization's runs deleted (with their results and logs, by cascade) inside a transaction
 *      that is rolled back. Skipped with --no-delete-probe.
 *
 * Exit codes: 0 within the thresholds, 1 a threshold was breached, 2 the test could not be run.
 */

export const EXIT_OK = 0;
export const EXIT_BREACHED = 1;
export const EXIT_TOOL_ERROR = 2;

/** The tables this is about. A sequential scan of one of them is a finding; of the others, not. */
export const BIG_TABLES = ['execution_logs', 'report_test_case_results', 'test_plan_executions'];
const ORG_PREFIX = 'wfm-volume-';
const RETENTION_DAYS = 90;

export interface VolumeOptions {
  databaseUrl: string;
  months: number;
  runsPerDay: number;
  orgs: number;
  plans: number;
  tests: number;
  resultsPerRun: number;
  logsPerRun: number;
  repeat: number;
  maxMs: number;
  seqScanRows: number;
  measureOnly: boolean;
  reset: boolean;
  deleteProbe: boolean;
  jsonPath?: string;
}

const DEFAULTS: Omit<VolumeOptions, 'databaseUrl'> = {
  months: 12,
  runsPerDay: 300,
  orgs: 3,
  plans: 20,
  tests: 200,
  resultsPerRun: 20,
  logsPerRun: 40,
  repeat: 5,
  maxMs: 250,
  seqScanRows: 50_000,
  measureOnly: false,
  reset: false,
  deleteProbe: true,
};

export function parseArgs(argv: string[]): VolumeOptions | { error: string } {
  const options: Partial<VolumeOptions> = { ...DEFAULTS };
  const numbers: Record<string, keyof VolumeOptions> = {
    '--months': 'months',
    '--runs-per-day': 'runsPerDay',
    '--orgs': 'orgs',
    '--plans': 'plans',
    '--tests': 'tests',
    '--results-per-run': 'resultsPerRun',
    '--logs-per-run': 'logsPerRun',
    '--repeat': 'repeat',
    '--max-ms': 'maxMs',
    '--seq-scan-rows': 'seqScanRows',
  };
  const switches: Record<string, [keyof VolumeOptions, boolean]> = {
    '--measure-only': ['measureOnly', true],
    '--reset': ['reset', true],
    '--no-delete-probe': ['deleteProbe', false],
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag in switches) {
      const [field, on] = switches[flag];
      (options as Record<string, unknown>)[field] = on;
      continue;
    }
    if (flag === '--database-url') options.databaseUrl = value;
    else if (flag === '--json') options.jsonPath = value;
    else if (flag in numbers) {
      const n = Number(value);
      if (!value || value.trim() === '' || !Number.isFinite(n) || n < 0)
        return { error: `${flag} takes a number, not "${value ?? ''}".` };
      (options as Record<string, unknown>)[numbers[flag]] = n;
    } else return { error: `Unknown option ${flag}.` };
    i++;
  }
  // Deliberately not DATABASE_URL: that names the installation's own database.
  if (!options.databaseUrl)
    return { error: 'Name the scratch database: --database-url postgres://… (never production).' };
  for (const field of [
    'months',
    'runsPerDay',
    'orgs',
    'plans',
    'tests',
    'resultsPerRun',
    'logsPerRun',
    'repeat',
  ] as const) {
    if (!Number.isSafeInteger(options[field]) || options[field]! < 1)
      return { error: `${field} must be a positive integer.` };
  }
  if (options.months! > 60) return { error: '--months is at most 60.' };
  if (options.measureOnly && options.reset)
    return { error: '--reset regenerates the data; --measure-only keeps it. Pick one.' };
  return options as VolumeOptions;
}

/** Calendar months ending today, oldest first; the last one is the current month so far. */
export function monthWindows(now: Date, months: number): Array<{ from: string; to: string }> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const windows: Array<{ from: string; to: string }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    windows.push({ from: day(from), to: day(next < tomorrow ? next : tomorrow) });
  }
  return windows;
}

/** Runs each organization gets a day: the installation's rate, shared out and rounded up. */
export function runsPerOrgPerDay(options: Pick<VolumeOptions, 'runsPerDay' | 'orgs'>): number {
  return Math.ceil(options.runsPerDay / options.orgs);
}

export function expectedRows(
  options: Pick<VolumeOptions, 'runsPerDay' | 'orgs' | 'resultsPerRun' | 'logsPerRun'>,
  days: number,
) {
  const runs = runsPerOrgPerDay(options) * options.orgs * days;
  return { runs, results: runs * options.resultsPerRun, logs: runs * options.logsPerRun };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One node of EXPLAIN (FORMAT JSON) output, as far as this reads it. */
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}

export interface SeqScan {
  relation: string;
  /** Rows the scan read: returned plus discarded by its filter, over every loop. */
  rowsRead: number;
}

export interface PlanSummary {
  executionMs: number;
  planningMs: number;
  seqScans: SeqScan[];
  indexes: string[];
}

export function summarizePlan(explain: unknown): PlanSummary {
  const root = (Array.isArray(explain) ? explain[0] : explain) as {
    Plan: PlanNode;
    'Execution Time'?: number;
    'Planning Time'?: number;
  };
  const seqScans: SeqScan[] = [];
  const indexes = new Set<string>();
  const walk = (node: PlanNode) => {
    const loops = node['Actual Loops'] ?? 1;
    if (node['Node Type'] === 'Seq Scan' && node['Relation Name'])
      seqScans.push({
        relation: node['Relation Name'],
        rowsRead: ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) * loops,
      });
    if (node['Index Name']) indexes.add(node['Index Name']);
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(root.Plan);
  return {
    executionMs: root['Execution Time'] ?? 0,
    planningMs: root['Planning Time'] ?? 0,
    seqScans,
    indexes: [...indexes].sort(),
  };
}

export interface Measurement {
  name: string;
  medianMs: number;
  runsMs: number[];
  seqScans: SeqScan[];
  indexes: string[];
}

export function evaluate(
  measurements: Measurement[],
  thresholds: Pick<VolumeOptions, 'maxMs' | 'seqScanRows'>,
): string[] {
  const breaches: string[] = [];
  for (const m of measurements) {
    if (m.medianMs > thresholds.maxMs)
      breaches.push(`${m.name}: median ${m.medianMs.toFixed(1)} ms > ${thresholds.maxMs} ms`);
    for (const scan of m.seqScans)
      if (BIG_TABLES.includes(scan.relation) && scan.rowsRead > thresholds.seqScanRows)
        breaches.push(
          `${m.name}: sequential scan of ${scan.relation} read ${scan.rowsRead} rows (limit ${thresholds.seqScanRows})`,
        );
  }
  return breaches;
}

export interface TableSize {
  table: string;
  rows: number;
  tableBytes: number;
  indexBytes: number;
}

export interface DeleteProbe {
  month: string;
  runs: number;
  ms: number;
}

export interface VolumeReport {
  startedAt: string;
  options: Omit<VolumeOptions, 'databaseUrl'>;
  postgres: string;
  generatedMs: number | null;
  sizes: TableSize[];
  measurements: Measurement[];
  deleteProbe: DeleteProbe | null;
  breaches: string[];
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

export function renderMarkdown(report: VolumeReport): string {
  const lines = [
    `# Volume test — ${report.startedAt}`,
    '',
    `${report.postgres}; ${report.options.months} months, ${report.options.runsPerDay} runs a day over ${report.options.orgs} organizations, ${report.options.resultsPerRun} results and ${report.options.logsPerRun} log lines a run.`,
    '',
    '| Table | Rows | Table | Indexes |',
    '| --- | ---: | ---: | ---: |',
    ...report.sizes.map(
      (s) =>
        `| ${s.table} | ${s.rows.toLocaleString('en')} | ${mb(s.tableBytes)} | ${mb(s.indexBytes)} |`,
    ),
    '',
    '| Query | Median ms | Sequential scans | Indexes |',
    '| --- | ---: | --- | --- |',
    ...report.measurements.map(
      (m) =>
        `| ${m.name} | ${m.medianMs.toFixed(1)} | ${
          m.seqScans.map((s) => `${s.relation} (${s.rowsRead.toLocaleString('en')})`).join(', ') ||
          '—'
        } | ${m.indexes.join(', ') || '—'} |`,
    ),
    '',
  ];
  if (report.deleteProbe)
    lines.push(
      `Deleting one month (${report.deleteProbe.month}, ${report.deleteProbe.runs.toLocaleString('en')} runs with their results and logs) took ${(report.deleteProbe.ms / 1000).toFixed(1)} s (rolled back).`,
      '',
    );
  lines.push(
    report.breaches.length
      ? `Breaches:\n${report.breaches.map((b) => `- ${b}`).join('\n')}`
      : 'Within the thresholds.',
  );
  return lines.join('\n');
}

// ─── The database side ───────────────────────────────────────────────────────

interface Org {
  id: number;
  planIds: string[];
  testIds: number[];
}

async function volumeOrgs(client: pg.Client): Promise<number[]> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM organizations WHERE name LIKE $1 ORDER BY id`,
    [`${ORG_PREFIX}%`],
  );
  return rows.map((r) => r.id);
}

async function bindOrg(client: pg.Client, org: number) {
  await client.query(`SELECT set_config('app.current_org', $1, false)`, [String(org)]);
}

async function refuseForeignData(client: pg.Client) {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM organizations WHERE name NOT LIKE $1`,
    [`${ORG_PREFIX}%`],
  );
  if (Number(rows[0].n) > 0)
    throw new Error(
      `This database holds ${rows[0].n} organization(s) this test did not create. It writes millions of rows: point it at an empty, migrated database of its own.`,
    );
}

async function removeVolumeData(client: pg.Client) {
  // By owner as well as by organization: a run stopped half way can leave either without the other.
  // Results and logs go with their runs, by cascade.
  const owners = `SELECT id FROM users WHERE username LIKE $1`;
  const orgs = `SELECT id FROM organizations WHERE name LIKE $1`;
  for (const statement of [
    `DELETE FROM test_plan_executions WHERE organization_id IN (${orgs})
       OR test_plan_id IN (SELECT id FROM test_plans WHERE user_id IN (${owners}))`,
    `DELETE FROM test_plans WHERE organization_id IN (${orgs}) OR user_id IN (${owners})`,
    `DELETE FROM tests WHERE organization_id IN (${orgs}) OR user_id IN (${owners})`,
    `DELETE FROM users WHERE username LIKE $1`,
    `DELETE FROM organizations WHERE name LIKE $1`,
  ])
    await client.query(statement, [`${ORG_PREFIX}%`]);
}

async function createOrg(client: pg.Client, n: number, options: VolumeOptions): Promise<Org> {
  const {
    rows: [{ id }],
  } = await client.query<{ id: number }>(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [`${ORG_PREFIX}${n}`],
  );
  await bindOrg(client, id);
  const {
    rows: [{ id: userId }],
  } = await client.query<{ id: number }>(
    `INSERT INTO users (username, password, organization_id) VALUES ($1, 'not-a-hash', $2) RETURNING id`,
    [`${ORG_PREFIX}${n}-owner`, id],
  );
  const tests = await client.query<{ id: number }>(
    `INSERT INTO tests (user_id, organization_id, name, url, sequence, elements, status)
     SELECT $1, $2, 'Volume test ' || g, 'https://example.test/' || g, '[]', '[]', 'active'
     FROM generate_series(1, $3) g RETURNING id`,
    [userId, id, options.tests],
  );
  const plans = await client.query<{ id: string }>(
    `INSERT INTO test_plans (id, user_id, organization_id, name)
     SELECT 'vol-' || $2::int || '-plan-' || g, $1, $2::int, 'Volume plan ' || g
     FROM generate_series(1, $3) g RETURNING id`,
    [userId, id, options.plans],
  );
  return { id, planIds: plans.rows.map((r) => r.id), testIds: tests.rows.map((r) => r.id) };
}

/** One organization's runs, results and logs for one month, all generated by the server. */
async function generateMonth(
  client: pg.Client,
  org: Org,
  window: { from: string; to: string },
  options: VolumeOptions,
) {
  await bindOrg(client, org.id);
  await client.query(
    `INSERT INTO test_plan_executions (id, test_plan_id, organization_id, status, queued_at, started_at,
       completed_at, triggered_by, total_tests, passed_tests, failed_tests, skipped_tests,
       execution_duration_ms, artifacts_purged_at)
     SELECT id, plan, $2::int, status, ts, ts + interval '5 seconds', ts + interval '5 seconds' + dur, trig,
       $6, CASE WHEN status = 'completed' THEN $6 ELSE $6 - 2 END,
       CASE WHEN status = 'completed' THEN 0 ELSE 2 END, 0, extract(epoch FROM dur)::int * 1000,
       CASE WHEN ts + dur < now() - make_interval(days => $7) THEN ts + dur + make_interval(days => $7) END
     FROM (
       SELECT 'vol-' || $2::int || '-' || to_char(day, 'YYYYMMDD') || '-' || r AS id,
         ($1::text[])[1 + r % array_length($1::text[], 1)] AS plan,
         day + make_interval(secs => r * 86400.0 / $5) AS ts,
         make_interval(secs => 30 + floor(random() * 600)) AS dur,
         CASE WHEN random() < 0.8 THEN 'completed' WHEN random() < 0.85 THEN 'failed'
              WHEN random() < 0.6 THEN 'error' ELSE 'cancelled' END AS status,
         CASE WHEN r % 3 = 0 THEN 'schedule' WHEN r % 3 = 1 THEN 'api' ELSE 'manual' END AS trig
       FROM generate_series($3::timestamp, $4::timestamp - interval '1 day', interval '1 day') day,
         generate_series(0, $5 - 1) r
     ) runs`,
    [
      org.planIds,
      org.id,
      window.from,
      window.to,
      runsPerOrgPerDay(options),
      options.resultsPerRun,
      RETENTION_DAYS,
    ],
  );
  await client.query(
    `INSERT INTO report_test_case_results (id, test_plan_execution_id, organization_id, ui_test_id,
       test_type, test_name, browser, status, reason_for_failure, detailed_log, started_at, completed_at,
       duration_ms)
     SELECT e.id || '-r' || i, e.id, e.organization_id, t.id, 'ui', 'Volume test ' || t.id, 'chromium',
       CASE WHEN e.status <> 'completed' AND i <= 2 THEN 'failed' ELSE 'passed' END,
       CASE WHEN e.status <> 'completed' AND i <= 2 THEN 'Timeout waiting for #submit' END,
       repeat(md5(e.id || i), 16),
       e.started_at + make_interval(secs => i * 10), e.started_at + make_interval(secs => i * 10 + 8),
       8000
     FROM test_plan_executions e CROSS JOIN generate_series(1, $5) i
       CROSS JOIN LATERAL (SELECT ($4::int[])[1 + ((hashtext(e.id)::bigint & 2147483647) + i)
                                  % array_length($4::int[], 1)] AS id) t
     WHERE e.organization_id = $1 AND e.queued_at >= $2::timestamp AND e.queued_at < $3::timestamp`,
    [org.id, window.from, window.to, org.testIds, options.resultsPerRun],
  );
  await client.query(
    `INSERT INTO execution_logs (test_plan_execution_id, organization_id, timestamp, level, source,
       message, metadata, correlation_id)
     SELECT e.id, e.organization_id, e.started_at + make_interval(secs => i * 5), lvl,
       CASE WHEN lvl = 'warn' AND i % 2 = 0 THEN 'system' ELSE 'playwright' END,
       'Step ' || i || ': ' || md5(e.id || i) || md5(i || e.id),
       CASE WHEN lvl = 'step' THEN jsonb_build_object('step', i, 'durationMs', 120 + i) END,
       e.id
     FROM test_plan_executions e CROSS JOIN generate_series(1, $4) i
       CROSS JOIN LATERAL (SELECT CASE WHEN i % 20 = 0 THEN 'warn' WHEN i % 33 = 0 THEN 'error'
                                       WHEN i % 2 = 0 THEN 'step' ELSE 'info' END AS lvl) l
     WHERE e.organization_id = $1 AND e.queued_at >= $2::timestamp AND e.queued_at < $3::timestamp`,
    [org.id, window.from, window.to, options.logsPerRun],
  );
}

interface Probe {
  name: string;
  sql: string;
  params: unknown[];
  /** Without app_user and RLS, as a background job runs it. */
  privileged?: boolean;
}

/**
 * The queries measured, written as the application sends them. Each names where it comes from:
 * when that query changes, this one should too.
 */
function probes(ctx: {
  recentRun: string;
  oldRun: string;
  planId: string;
  testId: number;
  since: string;
  retentionCutoff: string;
}): Probe[] {
  const history = (where: string) =>
    `SELECT e.*, p.name AS test_plan_name, s.schedule_name FROM test_plan_executions e
     LEFT JOIN test_plans p ON e.test_plan_id = p.id
     LEFT JOIN test_plan_schedules s ON e.schedule_id = s.id
     ${where} ORDER BY coalesce(e.started_at, e.queued_at) DESC LIMIT 10 OFFSET $OFFSET`;
  const visiblePlan = `NOT EXISTS (SELECT 1 FROM test_plan_selected_tests s WHERE s.test_plan_id = p.id AND (
      (s.test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tests t WHERE t.id = s.test_id)) OR
      (s.api_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api_tests t WHERE t.id = s.api_test_id)) OR
      (s.mobile_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = s.mobile_test_id))))`;
  const visibleRun = `NOT EXISTS (SELECT 1 FROM report_test_case_results r WHERE r.test_plan_execution_id = e.id AND (
      (r.ui_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tests t WHERE t.id = r.ui_test_id)) OR
      (r.api_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api_tests t WHERE t.id = r.api_test_id)) OR
      (r.mobile_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_tests t WHERE t.id = r.mobile_test_id)) OR
      (r.ui_test_id IS NULL AND r.api_test_id IS NULL AND r.mobile_test_id IS NULL AND NOT app_principal_sees_everything())))`;
  const dashboard = `FROM test_plan_executions e INNER JOIN test_plans p ON e.test_plan_id = p.id
     WHERE ${visiblePlan} AND ${visibleRun} AND coalesce(e.started_at, e.queued_at) >= $1`;
  return [
    {
      // server/routes/test-plans.routes.ts, GET /api/test-plan-executions/:id/logs
      name: 'logs: console of a recent run',
      sql: `SELECT * FROM execution_logs WHERE test_plan_execution_id = $1 ORDER BY timestamp ASC`,
      params: [ctx.recentRun],
    },
    {
      name: 'logs: console of a run 11 months old',
      sql: `SELECT * FROM execution_logs WHERE test_plan_execution_id = $1 ORDER BY timestamp ASC`,
      params: [ctx.oldRun],
    },
    {
      // server/routes/test-plans.routes.ts, the report's system warnings
      name: 'logs: system warnings of a run',
      sql: `SELECT message FROM execution_logs WHERE test_plan_execution_id = $1 AND level = 'warn'
            AND source = 'system' ORDER BY timestamp ASC`,
      params: [ctx.recentRun],
    },
    {
      // server/routes/test-plans.routes.ts, a run's report
      name: 'results: one run',
      sql: `SELECT * FROM report_test_case_results WHERE test_plan_execution_id = $1
            ORDER BY status DESC, test_name ASC`,
      params: [ctx.recentRun],
    },
    {
      // server/routes/test-plans.routes.ts, GET /api/test-plan-executions
      name: 'runs: history, first page',
      sql: history('').replace('$OFFSET', '0'),
      params: [],
    },
    {
      name: 'runs: history, page 50',
      sql: history('').replace('$OFFSET', '490'),
      params: [],
    },
    {
      name: 'runs: history of one plan',
      sql: history('WHERE e.test_plan_id = $1').replace('$OFFSET', '0'),
      params: [ctx.planId],
    },
    {
      // server/analytics.ts getDashboardMetrics, totals of the last 30 days
      name: 'dashboard: 30-day totals',
      sql: `SELECT count(*), count(*) FILTER (WHERE e.status = 'completed'),
              count(*) FILTER (WHERE e.status IN ('failed', 'error')),
              coalesce(avg(e.execution_duration_ms), 0) ${dashboard}`,
      params: [ctx.since],
    },
    {
      name: 'dashboard: recent runs',
      sql: `SELECT e.id, p.name, e.status, e.started_at, e.queued_at, e.execution_duration_ms ${dashboard}
            ORDER BY coalesce(e.started_at, e.queued_at) DESC LIMIT 5`,
      params: [ctx.since],
    },
    {
      // server/test-quarantine.ts, a quarantined test's results since it was quarantined
      name: 'results: one test, last 30 days',
      sql: `SELECT status, started_at FROM report_test_case_results
            WHERE ui_test_id = $1 AND started_at >= $2 ORDER BY started_at ASC`,
      params: [ctx.testId, ctx.since],
    },
    {
      // server/artifact-retention.ts purgeExpiredArtifacts, across every organization
      name: 'retention: expired runs',
      sql: `SELECT id, organization_id, test_plan_id FROM test_plan_executions
            WHERE artifacts_purged_at IS NULL
              AND status IN ('completed', 'failed', 'error', 'cancelled', 'timed_out')
              AND completed_at < $1
            ORDER BY completed_at ASC LIMIT 500`,
      params: [ctx.retentionCutoff],
      privileged: true,
    },
  ];
}

async function measure(
  client: pg.Client,
  org: number,
  probe: Probe,
  repeat: number,
): Promise<Measurement> {
  const runsMs: number[] = [];
  let last: PlanSummary | null = null;
  // One unmeasured run first, so the medians compare warm caches with warm caches.
  for (let i = 0; i <= repeat; i++) {
    await client.query('BEGIN');
    try {
      if (!probe.privileged) {
        await client.query('SET LOCAL ROLE app_user');
        await client.query(`SELECT set_config('app.current_org', $1, true)`, [String(org)]);
      }
      const { rows } = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${probe.sql}`,
        probe.params,
      );
      last = summarizePlan(rows[0]['QUERY PLAN']);
      if (i > 0) runsMs.push(last.executionMs);
    } finally {
      await client.query('ROLLBACK');
    }
  }
  return {
    name: probe.name,
    medianMs: median(runsMs),
    runsMs,
    seqScans: last!.seqScans,
    indexes: last!.indexes,
  };
}

async function tableSizes(client: pg.Client): Promise<TableSize[]> {
  const { rows } = await client.query<{
    table: string;
    rows: string;
    table_bytes: string;
    index_bytes: string;
  }>(
    `SELECT c.relname AS table, c.reltuples::bigint AS rows,
       pg_table_size(c.oid) AS table_bytes, pg_indexes_size(c.oid) AS index_bytes
     FROM pg_class c WHERE c.relname = ANY($1) AND c.relkind = 'r' ORDER BY c.relname`,
    [BIG_TABLES],
  );
  return rows.map((r) => ({
    table: r.table,
    rows: Number(r.rows),
    tableBytes: Number(r.table_bytes),
    indexBytes: Number(r.index_bytes),
  }));
}

async function probeMonthDelete(
  client: pg.Client,
  org: number,
  window: { from: string; to: string },
): Promise<DeleteProbe> {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [String(org)]);
    const started = performance.now();
    const result = await client.query(
      `DELETE FROM test_plan_executions WHERE organization_id = $1
         AND queued_at >= $2::timestamp AND queued_at < $3::timestamp`,
      [org, window.from, window.to],
    );
    return {
      month: window.from.slice(0, 7),
      runs: result.rowCount ?? 0,
      ms: performance.now() - started,
    };
  } finally {
    await client.query('ROLLBACK');
  }
}

export async function run(options: VolumeOptions, log = console.log): Promise<VolumeReport> {
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    await client.query('SET statement_timeout = 0');
    await refuseForeignData(client);
    const startedAt = new Date();
    const windows = monthWindows(startedAt, options.months);
    let generatedMs: number | null = null;
    let orgIds = await volumeOrgs(client);

    if (!options.measureOnly) {
      if (orgIds.length > 0 && !options.reset)
        throw new Error(
          'Generated data is already here: --measure-only to measure it again, --reset to start over.',
        );
      const t0 = performance.now();
      if (options.reset) {
        log('Removing the previous data…');
        await removeVolumeData(client);
      }
      const orgs: Org[] = [];
      for (let n = 1; n <= options.orgs; n++) orgs.push(await createOrg(client, n, options));
      for (const window of windows) {
        const m0 = performance.now();
        for (const org of orgs) await generateMonth(client, org, window, options);
        log(
          `  ${window.from.slice(0, 7)} generated in ${((performance.now() - m0) / 1000).toFixed(1)} s`,
        );
      }
      log('ANALYZE…');
      await client.query('ANALYZE');
      generatedMs = performance.now() - t0;
      orgIds = orgs.map((o) => o.id);
    } else if (orgIds.length === 0)
      throw new Error('No generated data to measure: run without --measure-only first.');

    const org = orgIds[0];
    await bindOrg(client, org);
    const pick = async <T>(sql: string, params: unknown[]): Promise<T> => {
      const { rows } = await client.query(sql, params);
      if (!rows[0]) throw new Error(`Nothing found for: ${sql}`);
      return Object.values(rows[0])[0] as T;
    };
    const recentRun = await pick<string>(
      `SELECT id FROM test_plan_executions WHERE organization_id = $1 ORDER BY queued_at DESC LIMIT 1`,
      [org],
    );
    const oldRun = await pick<string>(
      `SELECT id FROM test_plan_executions WHERE organization_id = $1 AND queued_at < $2::timestamp
       ORDER BY queued_at DESC LIMIT 1`,
      [org, windows[Math.max(0, windows.length - 11)].to],
    );
    const planId = await pick<string>(
      `SELECT id FROM test_plans WHERE organization_id = $1 ORDER BY id LIMIT 1`,
      [org],
    );
    const testId = await pick<number>(
      `SELECT id FROM tests WHERE organization_id = $1 ORDER BY id LIMIT 1`,
      [org],
    );
    const since = new Date(startedAt);
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 29);
    const cutoff = new Date(startedAt.getTime() - RETENTION_DAYS * 86_400_000);

    const measurements: Measurement[] = [];
    for (const probe of probes({
      recentRun,
      oldRun,
      planId,
      testId,
      since: since.toISOString(),
      retentionCutoff: cutoff.toISOString(),
    })) {
      const m = await measure(client, org, probe, options.repeat);
      log(`  ${m.name}: ${m.medianMs.toFixed(1)} ms`);
      measurements.push(m);
    }

    const deleteProbe = options.deleteProbe
      ? await probeMonthDelete(client, org, windows[0])
      : null;
    const { rows: version } = await client.query<{ v: string }>(
      `SELECT current_setting('server_version') AS v`,
    );
    const { databaseUrl: _url, ...shown } = options;
    return {
      startedAt: startedAt.toISOString(),
      options: shown,
      postgres: `PostgreSQL ${version[0].v}`,
      generatedMs,
      sizes: await tableSizes(client),
      measurements,
      deleteProbe,
      breaches: evaluate(measurements, options),
    };
  } finally {
    await client.end();
  }
}

export async function main(argv: string[], log = console.log): Promise<number> {
  const options = parseArgs(argv);
  if ('error' in options) {
    log(options.error);
    return EXIT_TOOL_ERROR;
  }
  let report: VolumeReport;
  try {
    report = await run(options, log);
  } catch (error) {
    log(`The volume test could not run: ${error instanceof Error ? error.message : error}`);
    return EXIT_TOOL_ERROR;
  }
  const jsonPath =
    options.jsonPath ?? localDir('volume', `${report.startedAt.replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  log('');
  log(renderMarkdown(report));
  log('');
  log(`Report: ${jsonPath}`);
  return report.breaches.length ? EXIT_BREACHED : EXIT_OK;
}

if (process.argv[1] && /wfm-volume(\.m?[tj]s)?$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
