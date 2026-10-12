import { describe, it, expect } from 'vitest';
import {
  evaluate,
  expectedRows,
  median,
  monthWindows,
  parseArgs,
  renderMarkdown,
  summarizePlan,
  type Measurement,
  type VolumeOptions,
} from './wfm-volume';

const URL = 'postgres://localhost/wfm_volume';

describe('reading its options', () => {
  it('takes the defaults with a database named', () => {
    const options = parseArgs(['--database-url', URL]) as VolumeOptions;
    expect(options).toMatchObject({ databaseUrl: URL, months: 12, runsPerDay: 300, orgs: 3 });
    expect(options.deleteProbe).toBe(true);
  });

  it('does not fall back to DATABASE_URL, which names the installation', () => {
    expect(parseArgs([])).toEqual({ error: expect.stringContaining('--database-url') });
  });

  it('reads numbers and switches', () => {
    const options = parseArgs([
      '--database-url',
      URL,
      '--months',
      '3',
      '--measure-only',
      '--no-delete-probe',
      '--max-ms',
      '100',
    ]) as VolumeOptions;
    expect(options).toMatchObject({ months: 3, measureOnly: true, deleteProbe: false, maxMs: 100 });
  });

  it('refuses what it cannot run', () => {
    expect(parseArgs(['--database-url', URL, '--orgs', '0'])).toHaveProperty('error');
    expect(parseArgs(['--database-url', URL, '--months', '1.5'])).toHaveProperty('error');
    expect(parseArgs(['--database-url', URL, '--months', '61'])).toHaveProperty('error');
    expect(parseArgs(['--database-url', URL, '--logs-per-run', 'many'])).toHaveProperty('error');
    expect(parseArgs(['--database-url', URL, '--reset', '--measure-only'])).toHaveProperty('error');
    expect(parseArgs(['--database-url', URL, '--fast'])).toEqual({
      error: 'Unknown option --fast.',
    });
  });
});

describe('the arithmetic', () => {
  it('splits a year into calendar months ending today', () => {
    const windows = monthWindows(new Date('2026-10-12T15:00:00Z'), 12);
    expect(windows).toHaveLength(12);
    expect(windows[0]).toEqual({ from: '2025-11-01', to: '2025-12-01' });
    expect(windows[10]).toEqual({ from: '2026-09-01', to: '2026-10-01' });
    // The current month stops at the end of today: no runs in the future.
    expect(windows[11]).toEqual({ from: '2026-10-01', to: '2026-10-13' });
  });

  it('crosses a year boundary', () => {
    expect(monthWindows(new Date('2026-01-31T00:00:00Z'), 2)).toEqual([
      { from: '2025-12-01', to: '2026-01-01' },
      { from: '2026-01-01', to: '2026-02-01' },
    ]);
  });

  it('counts the rows a run will write, rounding each organization up', () => {
    expect(
      expectedRows({ runsPerDay: 100, orgs: 3, resultsPerRun: 20, logsPerRun: 40 }, 365),
    ).toEqual({ runs: 34 * 3 * 365, results: 34 * 3 * 365 * 20, logs: 34 * 3 * 365 * 40 });
  });

  it('takes the median', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('reading a plan', () => {
  const explain = [
    {
      Plan: {
        'Node Type': 'Nested Loop',
        Plans: [
          {
            'Node Type': 'Seq Scan',
            'Relation Name': 'execution_logs',
            'Actual Rows': 10,
            'Actual Loops': 2,
            'Rows Removed by Filter': 990,
          },
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'test_plans',
            'Index Name': 'test_plans_pkey',
          },
        ],
      },
      'Planning Time': 0.2,
      'Execution Time': 12.5,
    },
  ];

  it('finds the sequential scans, with every row they read, and the indexes', () => {
    expect(summarizePlan(explain)).toEqual({
      executionMs: 12.5,
      planningMs: 0.2,
      seqScans: [{ relation: 'execution_logs', rowsRead: 2000 }],
      indexes: ['test_plans_pkey'],
    });
  });
});

describe('the verdict', () => {
  const measurement = (over: Partial<Measurement>): Measurement => ({
    name: 'q',
    medianMs: 1,
    runsMs: [1],
    seqScans: [],
    indexes: [],
    ...over,
  });
  const thresholds = { maxMs: 100, seqScanRows: 1000 };

  it('passes fast, indexed queries', () => {
    expect(evaluate([measurement({})], thresholds)).toEqual([]);
  });

  it('breaches on a slow median', () => {
    expect(evaluate([measurement({ medianMs: 150 })], thresholds)).toEqual([
      'q: median 150.0 ms > 100 ms',
    ]);
  });

  it('breaches on a large sequential scan of a growing table only', () => {
    const scans = [
      { relation: 'execution_logs', rowsRead: 5000 },
      { relation: 'test_plans', rowsRead: 5000 },
      { relation: 'report_test_case_results', rowsRead: 10 },
    ];
    expect(evaluate([measurement({ seqScans: scans })], thresholds)).toEqual([
      'q: sequential scan of execution_logs read 5000 rows (limit 1000)',
    ]);
  });

  it('renders a report that names the breaches', () => {
    const text = renderMarkdown({
      startedAt: '2026-10-12T00:00:00.000Z',
      options: { ...(parseArgs(['--database-url', URL]) as VolumeOptions) },
      postgres: 'PostgreSQL 16',
      generatedMs: 1,
      sizes: [{ table: 'execution_logs', rows: 1000, tableBytes: 2 ** 20, indexBytes: 0 }],
      measurements: [measurement({ medianMs: 150 })],
      deleteProbe: { month: '2025-11', runs: 3000, ms: 4200 },
      breaches: ['q: median 150.0 ms > 100 ms'],
    });
    expect(text).toContain('| execution_logs | 1,000 | 1 MB | 0 MB |');
    expect(text).toContain('Deleting one month (2025-11, 3,000 runs');
    expect(text).toContain('- q: median 150.0 ms > 100 ms');
  });
});
