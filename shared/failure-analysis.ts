/**
 * What the AI made of a failed result: its probable cause, in words a tester can act on.
 *
 * Asked for from the report, one result at a time, and kept on the result
 * (report_test_case_results.ai_analysis) so that looking at it again costs nothing. The model is
 * not trusted to say anything outside this shape: server/failure-analysis.ts reads its answer
 * into it and throws away the rest.
 */

/** Where the failure most probably comes from. */
export const FAILURE_CATEGORIES = [
  /** The element is there but the test looks for it the wrong way: selector, frame, timing of a render. */
  "locator",
  /** The application did something wrong: an error page, a 500, a wrong value, a missing feature. */
  "application",
  /** The test did not wait for something that was going to happen. */
  "timing",
  /** The data the test used: an account that no longer exists, a value already taken, an expired code. */
  "test-data",
  /** Around the application: network, DNS, certificates, a service that is down. */
  "environment",
  "unknown",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const ANALYSIS_CONFIDENCE = ["high", "medium", "low"] as const;
export type AnalysisConfidence = (typeof ANALYSIS_CONFIDENCE)[number];

/** Results worth analysing: the ones that did not pass for a reason the runner saw. */
export const ANALYSABLE_STATUSES = ["Failed", "Error"] as const;

/** The languages an analysis can be written in — the interface's own. */
export const ANALYSIS_LANGUAGES = ["en", "it", "de", "fr"] as const;
export type AnalysisLanguage = (typeof ANALYSIS_LANGUAGES)[number];

export interface FailureAnalysis {
  category: FailureCategory;
  confidence: AnalysisConfidence;
  /** One sentence: what went wrong. */
  summary: string;
  /** Why the model thinks so, pointing at the evidence it read. */
  explanation: string;
  /** What to do about it. */
  suggestion: string;
  /** The step it blames, counted from 1, when it blames one. */
  failedStep: number | null;
  /** A better selector for that step, only when the cause is the locator. */
  proposedSelector: string | null;
  /** Whether the screenshot was part of what the model saw. */
  sawScreenshot: boolean;
  language: AnalysisLanguage;
  model: string;
  byUsername: string;
  at: string;
}

export function readFailureAnalysis(value: unknown): FailureAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const analysis = value as FailureAnalysis;
  return FAILURE_CATEGORIES.includes(analysis.category) && typeof analysis.summary === "string" ? analysis : null;
}
