/**
 * The QA test case hub: a git repository of test case definitions, one `definition.json` per case
 * under `TestCasesDefinitions/<module>/<id>/`, kept by the CoE QA manager application.
 *
 * This is what both sides need and nothing more: the client shows a catalog row, the server reads
 * a definition and turns it into a manual test. Nothing here touches a file or the network — the
 * readers are in server/integrations/testcases-hub.ts.
 */
import type { ManualStep } from './manual-tests';

/** Where the hub is read from: a folder the server can see, or an Azure DevOps git repository. */
export const HUB_SOURCE_KINDS = ['folder', 'azure-devops'] as const;
export type HubSourceKind = (typeof HUB_SOURCE_KINDS)[number];

export const HUB_CASE_STATUSES = ['active', 'deprecated'] as const;
export const HUB_PRIORITIES = ['Highest', 'High', 'Medium', 'Low'] as const;

/** Readiness as the hub's manager labels it. */
export const HUB_READINESS_LABELS: Record<number, string> = {
  0: 'Undefined',
  1: 'Not revised',
  2: 'Not referenced',
  3: 'Reference ready',
  4: 'Automation ready',
  5: 'Automated',
};

export const HUB_DEFINITIONS_DIR = 'TestCasesDefinitions';
export const HUB_DEFINITION_FILE = 'definition.json';
export const HUB_MODULES_FILE = 'config/modules.json';

/** The hub's priorities as the library's (`tests.priority`). */
export const HUB_PRIORITY_TO_WFM: Record<string, 'Critical' | 'High' | 'Medium' | 'Low'> = {
  highest: 'Critical',
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  lowest: 'Low',
};

/** At most this many cases in one import call — the same ceiling as a suite bundle import. */
export const HUB_IMPORT_MAX_CASES = 500;

/** A case as the catalog keeps it: the definition's fields that matter here, normalised. */
export interface HubCaseDefinition {
  /** `ARC_TC_00001`: upper case, the number padded to five digits. */
  caseId: string;
  /** The id exactly as the file spells it. */
  rawId: string;
  /** The module the definition belongs to (its folder, unless the file says otherwise). */
  module: string;
  executionModule: string | null;
  status: string;
  priority: string | null;
  readinessLevel: number;
  versionFrom: string | null;
  versionTo: string | null;
  devopsId: string | null;
  sme: string | null;
  featureHighlight: string | null;
  executionGroup: string | null;
  functionalObjective: string;
  precondition: string;
  steps: string;
  expectedOutcome: string;
  refEnvPrecondition: string;
  refEnvSteps: string;
  refEnvExpectedOutcome: string;
  dependsOn: string[];
  forceNotTested: boolean;
  /** `updated_at` of the definition, ISO 8601, when it parses. */
  sourceUpdatedAt: string | null;
}

const ID_PATTERN = /^([A-Za-z0-9]+)_TC_(\d{1,6})$/i;

/**
 * `arc_tc_1` and `ARC_TC_00001` are the same case: the hub has 142 ids in mixed case and a few
 * legacy four-digit ones, and the catalog must not keep two rows for one definition.
 */
export function normaliseHubCaseId(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  const match = ID_PATTERN.exec(trimmed);
  if (!match) return trimmed.toUpperCase();
  return `${match[1].toUpperCase()}_TC_${match[2].padStart(5, '0')}`;
}

function text(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\r\n?/g, '\n').trim();
}

function optionalText(value: unknown): string | null {
  const cleaned = text(value);
  return cleaned === '' ? null : cleaned;
}

function readiness(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) return Math.min(Math.max(value, 0), 5);
  const match = /^\s*([0-5])/.exec(String(value ?? ''));
  return match ? Number(match[1]) : 0;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * One definition.json as the catalog keeps it, or null when the file is not a test case at all
 * (no id, not an object). A definition whose folder name and id disagree keeps the file's id:
 * the folder is where the manager put it, the id is what the testers quote.
 */
export function parseHubDefinition(
  json: unknown,
  folder: { module: string; caseFolder: string },
): HubCaseDefinition | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const raw = json as Record<string, unknown>;
  const rawId = text(raw.id) || text(folder.caseFolder);
  if (rawId === '') return null;
  const dependsOn = Array.isArray(raw.depends_on)
    ? Array.from(
        new Set(
          raw.depends_on
            .map((item) => normaliseHubCaseId(String(item ?? '')))
            .filter((item) => item !== ''),
        ),
      )
    : [];
  const status = text(raw.status).toLowerCase() || 'active';
  const priorityRaw = optionalText(raw.priority);
  const priority = priorityRaw
    ? (HUB_PRIORITIES.find((known) => known.toLowerCase() === priorityRaw.toLowerCase()) ??
      priorityRaw)
    : null;
  return {
    caseId: normaliseHubCaseId(rawId),
    rawId,
    module: text(raw.definition_module) || text(folder.module),
    executionModule: optionalText(raw.execution_module),
    status,
    priority,
    readinessLevel: readiness(raw.readiness_level),
    versionFrom: optionalText(raw.version_from),
    versionTo: optionalText(raw.version_to),
    devopsId: optionalText(raw.devops_id),
    sme: optionalText(raw.sme),
    featureHighlight: optionalText(raw.feature_highlight),
    executionGroup: optionalText(raw.execution_group),
    functionalObjective: text(raw.functional_objective),
    precondition: text(raw.input_data_precondition),
    steps: text(raw.steps),
    expectedOutcome: text(raw.expected_outcome),
    refEnvPrecondition: text(raw.ref_env_precondition),
    refEnvSteps: text(raw.ref_env_steps),
    refEnvExpectedOutcome: text(raw.ref_env_expected_outcome),
    dependsOn,
    forceNotTested: raw.force_not_tested_in_waves === true,
    sourceUpdatedAt: isoDate(raw.updated_at),
  };
}

/**
 * What a re-import compares: the fields that end up in the test or next to it. The server hashes
 * this; the shape is stable so that a definition saved again unchanged is not "changed".
 */
export function hubCaseFingerprint(definition: HubCaseDefinition): string {
  return JSON.stringify([
    definition.caseId,
    definition.module,
    definition.status,
    definition.priority,
    definition.readinessLevel,
    definition.versionFrom,
    definition.versionTo,
    definition.featureHighlight,
    definition.executionGroup,
    definition.functionalObjective,
    definition.precondition,
    definition.steps,
    definition.expectedOutcome,
    definition.refEnvPrecondition,
    definition.refEnvSteps,
    definition.refEnvExpectedOutcome,
    definition.dependsOn,
  ]);
}

/** `1) Navigate…`, `Step 3. The page…`, `2 - Click…`: the number in front of a line, if any. */
const NUMBERED_LINE = /^\s*(?:step\s*)?(\d+)\s*[.)\-:]?\s*(.*)$/i;

interface NumberedLine {
  number: number | null;
  text: string;
}

/**
 * The lines of a steps or expected-outcome field, each with its number when it carries one.
 * A line without a number continues the line before it, as the testers write a step that needs
 * two sentences.
 */
function numberedLines(value: string): NumberedLine[] {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  // Nothing numbered at all: every line is its own entry, as a list written without numbers.
  if (!lines.some((line) => NUMBERED_LINE.test(line)))
    return lines.map((line) => ({ number: null, text: line }));
  const out: NumberedLine[] = [];
  for (const line of lines) {
    const match = NUMBERED_LINE.exec(line);
    if (match && match[2].trim() !== '') {
      out.push({ number: Number(match[1]), text: match[2].trim() });
    } else if (match) {
      // A bare number: the text is on the next line; keep the number for it.
      out.push({ number: Number(match[1]), text: '' });
    } else if (out.length > 0) {
      const last = out[out.length - 1];
      last.text = last.text === '' ? line : `${last.text}\n${line}`;
    } else {
      out.push({ number: null, text: line });
    }
  }
  return out.filter((line) => line.text !== '');
}

export interface HubStepsOptions {
  /** `reference`: the reference-environment variant of the steps, when the case has one. */
  variant?: 'standard' | 'reference';
}

/**
 * The manual steps of a case: the precondition first, then the numbered lines of the steps,
 * each with the expected outcome that names its number. When the outcomes are not numbered but
 * there are as many as the steps, they pair in order; otherwise the whole outcome goes on the
 * last step, as it was written. A case with no steps at all becomes one step of its objective,
 * so that the test can still be saved and run.
 */
export function hubCaseToManualSteps(
  definition: HubCaseDefinition,
  options: HubStepsOptions = {},
): ManualStep[] {
  const reference = options.variant === 'reference' && definition.refEnvSteps !== '';
  const precondition = reference
    ? definition.refEnvPrecondition || definition.precondition
    : definition.precondition;
  const stepsText = reference ? definition.refEnvSteps : definition.steps;
  const expectedText = reference
    ? definition.refEnvExpectedOutcome || definition.expectedOutcome
    : definition.expectedOutcome;
  const out: ManualStep[] = [];
  if (precondition !== '') out.push({ action: `Precondition: ${precondition}`, expected: '' });
  let actions = numberedLines(stepsText);
  if (actions.length === 0) {
    actions = [
      { number: null, text: stepsText || definition.functionalObjective || definition.caseId },
    ];
  }
  const outcomes = numberedLines(expectedText);
  const byNumber = new Map<number, string>();
  for (const outcome of outcomes) {
    if (outcome.number != null && !byNumber.has(outcome.number))
      byNumber.set(outcome.number, outcome.text);
  }
  const pairsByNumber = actions.some(
    (action) => action.number != null && byNumber.has(action.number),
  );
  if (pairsByNumber) {
    const used = new Set<number>();
    for (const action of actions) {
      const expected = action.number != null ? (byNumber.get(action.number) ?? '') : '';
      if (action.number != null && expected !== '') used.add(action.number);
      out.push({ action: action.text, expected });
    }
    // Outcomes that name no step of their own are not lost: they close the last step.
    const leftovers = outcomes
      .filter((outcome) => outcome.number == null || !used.has(outcome.number))
      .map((outcome) => outcome.text);
    if (leftovers.length > 0) {
      const last = out[out.length - 1];
      last.expected = [last.expected, ...leftovers].filter((part) => part !== '').join('\n');
    }
  } else if (outcomes.length === actions.length && outcomes.length > 1) {
    actions.forEach((action, index) =>
      out.push({ action: action.text, expected: outcomes[index].text }),
    );
  } else {
    for (const action of actions) out.push({ action: action.text, expected: '' });
    out[out.length - 1].expected = expectedText;
  }
  return out;
}

export const HUB_TEST_NAME_MAX = 200;

/** `[ARC_TC_00001] Verify that…`: the id first, so that the library sorts and searches by it. */
export function hubTestName(definition: HubCaseDefinition): string {
  const objective =
    definition.functionalObjective.split('\n')[0].trim() ||
    definition.featureHighlight ||
    definition.module;
  const name = `[${definition.caseId}] ${objective}`;
  return name.length <= HUB_TEST_NAME_MAX ? name : `${name.slice(0, HUB_TEST_NAME_MAX - 1)}…`;
}

/** The library's priority for a hub case; the hub's `Highest` is the library's `Critical`. */
export function hubPriorityToWfm(priority: string | null): 'Critical' | 'High' | 'Medium' | 'Low' {
  return HUB_PRIORITY_TO_WFM[(priority ?? '').toLowerCase()] ?? 'Medium';
}
