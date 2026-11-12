/**
 * Run comparison: one frozen plan run on two environments and compared step by step
 * (docs/superpowers/specs/2026-11-12-run-comparison-design.md).
 *
 * The shared contract: what a comparison is called, the verdicts it reaches, what a checkpoint
 * step captures, the difference the engine reports and the policy it applies. Server and client
 * read the same words from here.
 */
import { z } from 'zod';

export const COMPARISON_STATUSES = [
  'queued',
  'running',
  'comparing',
  'completed',
  'error',
  'cancelled',
] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

/** Statuses a comparison does not leave. */
export const TERMINAL_COMPARISON_STATUSES: readonly ComparisonStatus[] = [
  'completed',
  'error',
  'cancelled',
];

export function isTerminalComparisonStatus(status: string): boolean {
  return (TERMINAL_COMPARISON_STATUSES as readonly string[]).includes(status);
}

export const COMPARISON_MODES = ['sequential', 'parallel'] as const;
export type ComparisonMode = (typeof COMPARISON_MODES)[number];

export const COMPARISON_ROLES = ['baseline', 'candidate'] as const;
export type ComparisonRole = (typeof COMPARISON_ROLES)[number];

/** The overall verdict, in order of precedence: the first that applies wins. */
export const COMPARISON_VERDICTS = [
  'regressions',
  'inconclusive',
  'parity_with_accepted',
  'parity',
] as const;
export type ComparisonVerdict = (typeof COMPARISON_VERDICTS)[number];

export const COMPARISON_RESULT_VERDICTS = [
  'identical',
  'equivalent',
  'different',
  'outcome_mismatch',
  'both_failed',
  'not_comparable',
] as const;
export type ComparisonResultVerdict = (typeof COMPARISON_RESULT_VERDICTS)[number];

export const COMPARISON_REVIEW_STATUSES = ['open', 'accepted', 'defect'] as const;
export type ComparisonReviewStatus = (typeof COMPARISON_REVIEW_STATUSES)[number];

export const CHECKPOINT_KINDS = ['text', 'table', 'chart', 'network'] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export const DIFFERENCE_KINDS = [
  'outcome',
  'text',
  'table',
  'chart',
  'network',
  'visual',
  'performance',
] as const;
export type DifferenceKind = (typeof DIFFERENCE_KINDS)[number];

/** The most a single checkpoint keeps, as canonical JSON; beyond it the data is cut and marked. */
export const MAX_CHECKPOINT_BYTES = 64 * 1024;
/** The most checkpoint data one test keeps across all its steps. */
export const MAX_CHECKPOINT_BYTES_PER_TEST = 1024 * 1024;
/** The most rows a table checkpoint reads. */
export const MAX_TABLE_ROWS = 500;
/** The most requests a network checkpoint keeps. */
export const MAX_NETWORK_ENTRIES = 500;
/** The most texts a text checkpoint keeps when its target matches many elements. */
export const MAX_TEXT_MATCHES = 200;
/** The most differences kept on one test's result; the rest are counted, not stored. */
export const MAX_DIFFERENCES_PER_TEST = 200;

/** What a checkpoint step captured, stored on the step result. */
export interface CheckpointCapture {
  /** Unique within the test, chosen by the author: the same name pairs the two sides. */
  name: string;
  kind: CheckpointKind;
  /** Normalised and bounded by MAX_CHECKPOINT_BYTES. For text: `{ texts: string[] }`. */
  data: unknown;
  /** sha-256 of the canonical JSON of `data`. */
  hash: string;
  truncated?: boolean;
}

/** The data of a text checkpoint: the inner text of every element the target matched. */
export interface TextCheckpointData {
  texts: string[];
}

/** The data of a table checkpoint: the cell texts of every row, header rows included. */
export interface TableCheckpointData {
  rows: string[][];
}

/**
 * The data of a chart checkpoint, the one shape every adapter returns
 * (server/web/checkpoints/chart-adapters.ts). `x` is a category or a number; `y` a number or null.
 */
export interface ChartCheckpointData {
  series: { name: string; type: string; points: [string | number, number | null][] }[];
  axes: { name: string; min: number | null; max: number | null }[];
  lines: { axis: string; value: number; label: string }[];
}

/**
 * One finished request of a network checkpoint. Bodies are never kept, only their sha-256. The
 * response hash is taken for fetch and XHR answers; the engine compares it only when the policy's
 * `network.compareResponseHash` asks, so the choice can be made after both runs.
 */
export interface NetworkCheckpointEntry {
  method: string;
  path: string;
  /** Sorted `key=value` pairs of the query string. */
  query: string[];
  requestBodyHash: string | null;
  status: number;
  responseBodyHash?: string;
}

/** The data of a network checkpoint: the requests since the previous one that match, sorted. */
export interface NetworkCheckpointData {
  entries: NetworkCheckpointEntry[];
}

export interface ComparisonDifference {
  /** The test's own step id; null for a difference of the whole test. */
  stepId: string | null;
  /** The step's position in the result, -1 for the whole test. */
  stepIndex: number;
  checkpoint: string | null;
  kind: DifferenceKind;
  /** Where inside the data, for example `texts[3]` or `series[1].points[14][1]`. */
  path: string;
  baseline: unknown;
  candidate: unknown;
  severity: 'blocking' | 'informative';
  /** Set when a recorded known difference covers this one. */
  knownDifferenceId?: string;
}

const ReplaceRuleSchema = z.object({
  pattern: z.string().min(1).max(500),
  with: z.string().max(500).default(''),
});

/** Tolerances and switches the engine applies. Every field has a default. */
export const ComparisonPolicySchema = z.object({
  text: z
    .object({
      collapseWhitespace: z.boolean().default(true),
      ignoreCase: z.boolean().default(false),
      replace: z.array(ReplaceRuleSchema).max(50).default([]),
    })
    .prefault({}),
  numeric: z
    .object({
      absTolerance: z.number().min(0).default(0),
      relTolerance: z.number().min(0).max(1).default(0),
    })
    .prefault({}),
  network: z
    .object({
      include: z.array(z.string().min(1).max(500)).max(50).default(['**/api/**']),
      ignoreQueryParams: z.array(z.string().min(1).max(200)).max(50).default([]),
      compareResponseHash: z.boolean().default(false),
    })
    .prefault({}),
  visual: z
    .object({
      mode: z.enum(['off', 'informative', 'blocking']).default('informative'),
      threshold: z.number().min(0).max(1).default(0.01),
    })
    .prefault({}),
  performance: z
    .object({
      mode: z.enum(['off', 'informative', 'blocking']).default('informative'),
      maxSlowdownPct: z.number().min(0).max(10_000).default(20),
    })
    .prefault({}),
});
export type ComparisonPolicy = z.infer<typeof ComparisonPolicySchema>;

/** The policy with every default filled in; an unreadable stored policy reads as the default. */
export function comparisonPolicyOf(value: unknown): ComparisonPolicy {
  const parsed = ComparisonPolicySchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : ComparisonPolicySchema.parse({});
}

/** What a request to start a comparison carries. */
export const CreateComparisonSchema = z
  .object({
    baselineEnvironmentId: z.number().int().positive(),
    candidateEnvironmentId: z.number().int().positive(),
    mode: z.enum(COMPARISON_MODES).default('sequential'),
    name: z.string().trim().max(200).optional(),
    policy: ComparisonPolicySchema.optional(),
  })
  .refine((body) => body.baselineEnvironmentId !== body.candidateEnvironmentId, {
    message: 'The two environments must differ.',
    path: ['candidateEnvironmentId'],
  });
export type CreateComparisonInput = z.infer<typeof CreateComparisonSchema>;

export type VerdictCounts = Record<ComparisonResultVerdict, number>;

/** Counts kept on the comparison when it completes. */
export interface ComparisonSummary {
  total: number;
  byVerdict: VerdictCounts;
  /** Parity by module: the module name, or '' for tests that have none. */
  byModule: Array<{ module: string; total: number; byVerdict: VerdictCounts }>;
  /** Differences that were found but not stored because a test had too many. */
  droppedDifferences: number;
}

export function emptyVerdictCounts(): VerdictCounts {
  return Object.fromEntries(COMPARISON_RESULT_VERDICTS.map((v) => [v, 0])) as VerdictCounts;
}

/** What a run says about the comparison it belongs to, kept in its snapshot. */
export interface ExecutionComparisonRef {
  id: string;
  role: ComparisonRole;
}

export const ExecutionComparisonRefSchema = z.object({
  id: z.string().min(1),
  role: z.enum(COMPARISON_ROLES),
});
