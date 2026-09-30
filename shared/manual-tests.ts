/**
 * Manual tests: steps a person performs and judges, run in the same plans as automated ones.
 *
 * A manual test is an ordinary test whose steps are all `manualStep`s — an action to perform and
 * the result to expect — kept in `sequence` like any other step. That is deliberate: versions,
 * publishing, reviews, tags, suites and plans already work on `sequence`, so a manual test gets
 * all of them without a second copy of any.
 *
 * In a run it opens no browser. Its result is recorded as `Pending` until somebody gives the
 * verdict in the run's report; the run's totals then count it like any other result, which is
 * what makes a report of a mixed manual and automated plan true.
 */

export const MANUAL_STEP_ACTION_ID = "manualStep";

export interface ManualStep {
  /** What to do: "Open the order and press Refund". */
  action: string;
  /** What should happen: "The order shows Refunded and the amount is zero". */
  expected: string;
}

/** A step as the sequence stores it. */
export interface ManualSequenceStep {
  id: string;
  action: { id: typeof MANUAL_STEP_ACTION_ID; type: typeof MANUAL_STEP_ACTION_ID; name: string; icon: string; description: string };
  value: string;
  expected: string;
}

export function toSequence(steps: ManualStep[]): ManualSequenceStep[] {
  return steps.map((step, index) => ({
    id: `manual-${index + 1}`,
    action: { id: MANUAL_STEP_ACTION_ID, type: MANUAL_STEP_ACTION_ID, name: "Manual step", icon: "ClipboardCheck", description: "" },
    value: step.action,
    expected: step.expected,
  }));
}

function asArray(sequence: unknown): unknown[] {
  if (Array.isArray(sequence)) return sequence;
  if (typeof sequence === "string") {
    try {
      const parsed = JSON.parse(sequence);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Whether a test is manual: it has steps, and every one of them is a manual step. */
export function isManualSequence(sequence: unknown): boolean {
  const steps = asArray(sequence);
  return steps.length > 0 && steps.every((step) => (step as any)?.action?.id === MANUAL_STEP_ACTION_ID);
}

export function manualStepsOf(sequence: unknown): ManualStep[] {
  return asArray(sequence)
    .filter((step) => (step as any)?.action?.id === MANUAL_STEP_ACTION_ID)
    .map((step: any) => ({ action: String(step.value ?? ""), expected: String(step.expected ?? "") }));
}

/** The verdicts a tester can give, and the result status each one records. */
export const MANUAL_VERDICTS = ["passed", "failed", "blocked"] as const;
export type ManualVerdict = (typeof MANUAL_VERDICTS)[number];

export const VERDICT_STATUS: Record<ManualVerdict, "Passed" | "Failed" | "Skipped"> = {
  passed: "Passed",
  failed: "Failed",
  // Could not be carried out — an environment down, a prerequisite missing. Not a failure of
  // the thing under test, so it does not fail the run; it is counted with the skipped.
  blocked: "Skipped",
};

export const MANUAL_STEP_OUTCOMES = ["passed", "failed", "skipped"] as const;
export type ManualStepOutcome = (typeof MANUAL_STEP_OUTCOMES)[number];

/**
 * What a manual result keeps in `detailedLog`: the steps as they were in the version that ran,
 * and, once given, the verdict with who gave it and how each step went.
 */
export interface ManualResultLog {
  manual: true;
  steps: ManualStep[];
  verdict?: {
    outcome: ManualVerdict;
    notes: string | null;
    stepOutcomes: Array<{ outcome: ManualStepOutcome; note: string | null }>;
    byUserId: number;
    byUsername: string;
    at: string;
  };
}

/** The manual log of a result, or null when the result is not a manual test's. */
export function readManualLog(detailedLog: unknown): ManualResultLog | null {
  if (typeof detailedLog !== "string" || !detailedLog.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(detailedLog);
    return parsed && parsed.manual === true && Array.isArray(parsed.steps) ? (parsed as ManualResultLog) : null;
  } catch {
    return null;
  }
}
