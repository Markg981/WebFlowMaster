/**
 * QA hub waves: the QA team's test sessions and the results they recorded, as the hub keeps them
 * (CoE-QA-TestCasesHub/Waves/<wave_id>/), and what WFM makes of them.
 *
 * A wave is `wave.json` (schema 2.0: the release, the type, the dates and one entry per case
 * with its module, tester and stage) and one `results_<Module>.json` per module
 * (`qa_wave_results_v1`: the status, build, bug and notes of each case, with every attempt).
 *
 * The parsers are tolerant on purpose: archived waves were written by older desktop app
 * versions, and a field that is missing or of an unexpected type becomes null rather than
 * losing the whole wave. A file that is not a wave at all parses to null.
 */
import { normaliseHubCaseId } from './testcases-hub';

export const HUB_WAVES_DIR = 'Waves';
export const HUB_WAVE_FILE = 'wave.json';
export const HUB_WAVE_RESULTS_SCHEMA = 'qa_wave_results_v1';
const RESULTS_FILE = /^results_.+\.json$/i;

/** Whether a file name inside a wave folder is one of its results files. */
export function isWaveResultsFile(name: string): boolean {
  return RESULTS_FILE.test(name);
}

/** The results file the desktop app writes for a module: spaces become underscores. */
export function waveResultsFileName(module: string): string {
  return `results_${module.trim().replace(/\s+/g, '_')}.json`;
}

/** The statuses the desktop app records. Anything else is read as `pending`. */
export const HUB_RESULT_STATUSES = [
  'passed',
  'failed',
  'on_hold',
  'not_tested',
  'pending',
] as const;
export type HubResultStatus = (typeof HUB_RESULT_STATUSES)[number];

export const HUB_WAVE_STAGES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

export interface HubStageMetrics {
  newFeature: boolean;
  codeChanges: boolean;
  failedInLast: boolean;
  failedInPrevious: boolean;
}

export interface HubWaveEntry {
  caseId: string;
  rawCaseId: string;
  module: string | null;
  definitionModule: string | null;
  tester: string | null;
  stage: string | null;
  stageMetrics: HubStageMetrics;
}

export interface HubWorkbookLink {
  url: string;
  label: string | null;
}

export interface HubWaveDefinition {
  waveId: string;
  name: string;
  description: string | null;
  release: string | null;
  majorRelease: string | null;
  waveType: string | null;
  status: string | null;
  startDate: string | null;
  targetDate: string | null;
  modules: string[];
  workbookLinks: HubWorkbookLink[];
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  entries: HubWaveEntry[];
}

export interface HubWaveAttempt {
  number: number;
  status: HubResultStatus;
  tester: string | null;
  executionDate: string | null;
  buildNumber: string | null;
  bugReference: string | null;
  bugPriority: string | null;
  notes: string | null;
}

export interface HubWaveResult {
  caseId: string;
  rawCaseId: string;
  status: HubResultStatus;
  tester: string | null;
  executionDate: string | null;
  buildNumber: string | null;
  bugReference: string | null;
  bugPriority: string | null;
  notes: string | null;
  attempts: HubWaveAttempt[];
}

export interface HubWaveResultsFile {
  waveId: string | null;
  module: string | null;
  results: HubWaveResult[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = String(value).replace(/\r\n?/g, '\n').trim();
  return cleaned === '' ? null : cleaned;
}

function isoTimestamp(value: unknown): string | null {
  const raw = optionalText(value);
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** `Passed`, `on hold`, `Not-Tested` → the status the app means. Unknown values are `pending`. */
export function normaliseResultStatus(value: unknown): HubResultStatus {
  const raw = (optionalText(value) ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  return (HUB_RESULT_STATUSES as readonly string[]).includes(raw)
    ? (raw as HubResultStatus)
    : 'pending';
}

function stage(value: unknown): string | null {
  const raw = optionalText(value);
  return raw ? raw.toUpperCase() : null;
}

/** The wave.json of a wave folder, or null when the file is not a wave. */
export function parseHubWave(json: unknown, folderName?: string): HubWaveDefinition | null {
  if (!isObject(json)) return null;
  const waveId = optionalText(json.wave_id) ?? optionalText(folderName);
  if (!waveId) return null;
  const entries: HubWaveEntry[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(json.tc_entries) ? json.tc_entries : []) {
    if (!isObject(entry)) continue;
    const rawCaseId = optionalText(entry.tc_id);
    if (!rawCaseId) continue;
    const caseId = normaliseHubCaseId(rawCaseId);
    // A case is planned once per wave; a repeated entry is the same case.
    if (seen.has(caseId)) continue;
    seen.add(caseId);
    entries.push({
      caseId,
      rawCaseId,
      module: optionalText(entry.module),
      definitionModule: optionalText(entry.definition_module),
      tester: optionalText(entry.tester),
      stage: stage(entry.stage),
      stageMetrics: {
        newFeature: entry.stage_metric_new_feature === true,
        codeChanges: entry.stage_metric_code_changes === true,
        failedInLast: entry.stage_metric_failed_in_last === true,
        failedInPrevious: entry.stage_metric_failed_in_previous === true,
      },
    });
  }
  const workbookLinks: HubWorkbookLink[] = [];
  for (const link of Array.isArray(json.workbook_links) ? json.workbook_links : []) {
    const url = isObject(link) ? optionalText(link.url) : optionalText(link);
    if (url) workbookLinks.push({ url, label: isObject(link) ? optionalText(link.label) : null });
  }
  return {
    waveId,
    name: optionalText(json.name) ?? waveId,
    description: optionalText(json.description),
    release: optionalText(json.release),
    majorRelease: optionalText(json.major_release),
    waveType: optionalText(json.wave_type),
    status: optionalText(json.status)?.toLowerCase() ?? null,
    startDate: optionalText(json.start_date),
    targetDate: optionalText(json.target_date),
    modules: (Array.isArray(json.modules) ? json.modules : [])
      .map(optionalText)
      .filter((m): m is string => m !== null),
    workbookLinks,
    createdBy: optionalText(json.created_by),
    createdAt: isoTimestamp(json.created_at),
    updatedAt: isoTimestamp(json.updated_at),
    entries,
  };
}

function parseAttempt(value: unknown, index: number): HubWaveAttempt | null {
  if (!isObject(value)) return null;
  const number = Number(value.execution_number);
  return {
    number: Number.isInteger(number) && number > 0 ? number : index + 1,
    status: normaliseResultStatus(value.execution_status),
    tester: optionalText(value.tester),
    executionDate: optionalText(value.execution_date),
    buildNumber: optionalText(value.build_number),
    bugReference: optionalText(value.bug_reference),
    bugPriority: optionalText(value.bug_priority),
    notes: optionalText(value.notes),
  };
}

/** One results_<Module>.json, or null when the file holds no results list. */
export function parseHubWaveResults(json: unknown): HubWaveResultsFile | null {
  if (!isObject(json) || !Array.isArray(json.results)) return null;
  const results: HubWaveResult[] = [];
  for (const row of json.results) {
    if (!isObject(row)) continue;
    const rawCaseId = optionalText(row.tc_id);
    if (!rawCaseId) continue;
    const attempts = (Array.isArray(row.executions) ? row.executions : [])
      .map(parseAttempt)
      .filter((a): a is HubWaveAttempt => a !== null)
      .sort((a, b) => a.number - b.number);
    results.push({
      caseId: normaliseHubCaseId(rawCaseId),
      rawCaseId,
      status: normaliseResultStatus(row.execution_status),
      tester: optionalText(row.tester),
      executionDate: optionalText(row.execution_date),
      buildNumber: optionalText(row.build_number),
      bugReference: optionalText(row.bug_reference),
      bugPriority: optionalText(row.bug_priority),
      notes: optionalText(row.notes),
      attempts,
    });
  }
  return { waveId: optionalText(json.wave_id), module: optionalText(json.module), results };
}

/** What a hub result becomes in a WFM run. */
export interface WfmOutcome {
  status: 'Passed' | 'Failed' | 'Skipped' | 'Pending';
  /** The manual verdict it stands for, or null when nobody judged the case. */
  verdict: 'passed' | 'failed' | 'blocked' | null;
  /** Why a skipped result was not run, as the report shows it. */
  reason: string | null;
}

/**
 * The status mapping. `on_hold` is a case that could not be carried out — exactly what WFM's
 * `blocked` verdict means, counted with the skipped so it does not fail the run. `not_tested` is
 * a case left out of the session on purpose: skipped, with no verdict. `pending` stays pending,
 * so an open wave can be finished in WFM.
 */
export function hubResultToWfm(status: HubResultStatus): WfmOutcome {
  switch (status) {
    case 'passed':
      return { status: 'Passed', verdict: 'passed', reason: null };
    case 'failed':
      return { status: 'Failed', verdict: 'failed', reason: null };
    case 'on_hold':
      return { status: 'Skipped', verdict: 'blocked', reason: 'Blocked' };
    case 'not_tested':
      return { status: 'Skipped', verdict: null, reason: 'Not tested' };
    default:
      return { status: 'Pending', verdict: null, reason: null };
  }
}

/** A WFM result status, back as the desktop app records it (for the export). */
export function wfmStatusToHub(status: string, verdict?: string | null): HubResultStatus {
  if (verdict === 'blocked') return 'on_hold';
  switch (status) {
    case 'Passed':
      return 'passed';
    case 'Failed':
    case 'Error':
      return 'failed';
    case 'Skipped':
      return 'not_tested';
    default:
      return 'pending';
  }
}

/** Counts by status, the numbers every wave view is made of. */
export type HubStatusCounts = Record<HubResultStatus, number>;

export function emptyStatusCounts(): HubStatusCounts {
  return { passed: 0, failed: 0, on_hold: 0, not_tested: 0, pending: 0 };
}

/**
 * Executed and passed as the QA team reports them: executed is everything that got a verdict
 * (passed, failed, on hold), the pass rate is passed over executed.
 */
export function waveRates(counts: HubStatusCounts): {
  total: number;
  executed: number;
  executedPct: number;
  passRatePct: number;
} {
  const total = HUB_RESULT_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const executed = counts.passed + counts.failed + counts.on_hold;
  const pct = (part: number, whole: number) =>
    whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
  return {
    total,
    executed,
    executedPct: pct(executed, total),
    passRatePct: pct(counts.passed, executed),
  };
}

/** The import options a person chooses (the wave import job's params). */
export interface HubWaveImportParams {
  /** The waves' row ids, as the waves list gives them. */
  waveIds: number[];
  projectId: number | null;
  variant: 'standard' | 'reference';
}

/** The filters of a new session made from a wave. */
export interface HubWaveSessionFilters {
  modules?: string[];
  stages?: string[];
  statuses?: HubResultStatus[];
  testers?: string[];
}

export const HUB_WAVE_IMPORT_MAX_WAVES = 25;
/** Cases imported per transaction during a wave import: small enough to keep each one short. */
export const HUB_WAVE_IMPORT_CHUNK = 200;
