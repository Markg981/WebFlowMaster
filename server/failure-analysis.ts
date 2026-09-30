import {
  ANALYSIS_CONFIDENCE,
  FAILURE_CATEGORIES,
  type AnalysisConfidence,
  type AnalysisLanguage,
  type FailureAnalysis,
  type FailureCategory,
} from "@shared/failure-analysis";
import type { NetworkSummary } from "@shared/network";

/**
 * The prompt for a failure analysis, and the reading of its answer.
 *
 * Kept apart from the model call (server/ai-automation-service.ts) so that what is sent and what
 * is believed can be tested without a network. What is sent is what the report already shows:
 * the reason, the steps with their errors, the requests that failed. Values that look like
 * secrets never leave — the model does not need a password to see that a login failed.
 */

export interface FailureEvidence {
  testName: string;
  testType: string;
  browser: string | null;
  status: string;
  reason: string | null;
  /** The result's detailed log: for a UI test, its steps as the runner recorded them. */
  detailedLog: string | null;
  network: NetworkSummary | null;
}

export interface EvidenceStep {
  name: string;
  type: string;
  selector: string | null;
  value: string | null;
  status: "passed" | "failed";
  error: string | null;
  healed: boolean;
}

/** Steps before the first failure kept in the prompt: the ones that set it up. */
const STEPS_BEFORE = 8;
const MAX_TEXT = 600;
const MAX_REASON = 2000;
const SECRET_HINT = /pass(word)?|pwd|secret|token|otp|pin\b|cvv|card|iban|api[-_ ]?key|auth/i;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function evidenceSteps(detailedLog: string | null): EvidenceStep[] {
  if (!detailedLog) return [];
  try {
    const parsed = JSON.parse(detailedLog);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((step): step is Record<string, any> => !!step && typeof step === "object")
      .map((step) => ({
        name: String(step.name ?? "Unnamed step"),
        type: String(step.type ?? "unknown"),
        selector: typeof step.selector === "string" && step.selector ? step.selector : null,
        value: step.value === undefined || step.value === null || step.value === "" ? null : String(step.value),
        status: step.status === "failed" ? "failed" : "passed",
        error: step.error ? String(step.error) : null,
        healed: step.healed === true,
      }));
  } catch {
    return [];
  }
}

/** A step's value as the prompt carries it: masked when the step looks like it types a secret. */
export function promptValue(step: EvidenceStep): string | null {
  if (step.value === null) return null;
  if (SECRET_HINT.test(`${step.name} ${step.selector ?? ""} ${step.type}`)) return "[hidden]";
  return clip(step.value, 120);
}

const LANGUAGE_NAMES: Record<AnalysisLanguage, string> = {
  en: "English",
  it: "Italian",
  de: "German",
  fr: "French",
};

export function buildFailurePrompt(evidence: FailureEvidence, language: AnalysisLanguage, withScreenshot: boolean): string {
  const steps = evidenceSteps(evidence.detailedLog);
  const firstFailed = steps.findIndex((step) => step.status === "failed");
  const from = firstFailed === -1 ? Math.max(0, steps.length - STEPS_BEFORE) : Math.max(0, firstFailed - STEPS_BEFORE);
  const to = firstFailed === -1 ? steps.length : firstFailed + 2;
  const stepLines = steps.slice(from, to).map((step, offset) => {
    const parts = [`${from + offset + 1}. [${step.status}] ${step.type} "${clip(step.name, 120)}"`];
    if (step.selector) parts.push(`selector: ${clip(step.selector, 300)}`);
    const value = promptValue(step);
    if (value !== null) parts.push(`value: ${value}`);
    if (step.healed) parts.push("(its selector was healed during the run)");
    if (step.error) parts.push(`error: ${clip(step.error, MAX_TEXT)}`);
    return parts.join(" | ");
  });

  const network = evidence.network;
  const requestLines = network
    ? [
        `${network.requests} requests, ${network.failed} failed.`,
        ...network.failures.slice(0, 10).map((r) => `FAILED ${r.method} ${clip(r.url, 200)} → ${r.status} ${r.statusText}`),
        ...network.slowest.slice(0, 3).map((r) => `SLOW ${r.method} ${clip(r.url, 200)} ${r.timeMs} ms`),
      ]
    : ["No network recording was kept for this test."];

  return [
    "You are analysing why an automated end-to-end test failed. Answer with JSON only, no prose around it:",
    "{",
    `  "category": one of ${FAILURE_CATEGORIES.map((c) => `"${c}"`).join(", ")},`,
    '  "confidence": "high" | "medium" | "low",',
    '  "summary": one sentence saying what went wrong,',
    '  "explanation": two to four sentences pointing at the evidence below,',
    '  "suggestion": what the tester should do next,',
    '  "failedStep": the number of the step to blame, or null,',
    '  "proposedSelector": a more robust CSS or Playwright selector for that step, only when category is "locator", else null',
    "}",
    "Categories: locator = the element exists but the test finds it the wrong way; application = the application misbehaved",
    "(error page, HTTP 5xx, wrong content); timing = the test did not wait long enough; test-data = the data used is no longer",
    "valid; environment = network, DNS, certificates or a dependency down. Use unknown rather than guessing.",
    `Write summary, explanation and suggestion in ${LANGUAGE_NAMES[language]}.`,
    withScreenshot ? "The attached image is the page when the test failed." : "No screenshot is available.",
    "",
    `Test: ${clip(evidence.testName, 200)} (${evidence.testType}${evidence.browser ? `, ${evidence.browser}` : ""})`,
    `Result: ${evidence.status}`,
    `Reason reported by the runner: ${evidence.reason ? clip(evidence.reason, MAX_REASON) : "(none)"}`,
    "",
    stepLines.length ? `Steps (${steps.length} in all, numbered from 1):` : "No step log was kept.",
    ...stepLines,
    "",
    "Network:",
    ...requestLines,
  ].join("\n");
}

type ModelAnswer = Pick<
  FailureAnalysis,
  "category" | "confidence" | "summary" | "explanation" | "suggestion" | "failedStep" | "proposedSelector"
>;

/** The model's answer, read into the analysis shape; null when it is not one. */
export function parseFailureAnswer(text: string | null, stepCount: number): ModelAnswer | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let raw: any;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const field = (value: unknown, max: number) => (typeof value === "string" ? clip(value.trim(), max) : "");
  const summary = field(raw.summary, 400);
  if (!summary) return null;
  const category: FailureCategory = FAILURE_CATEGORIES.includes(raw.category) ? raw.category : "unknown";
  const confidence: AnalysisConfidence = ANALYSIS_CONFIDENCE.includes(raw.confidence) ? raw.confidence : "low";
  const step = Number(raw.failedStep);
  const failedStep = Number.isInteger(step) && step >= 1 && step <= stepCount ? step : null;
  const selector = field(raw.proposedSelector, 300);

  return {
    category,
    confidence,
    summary,
    explanation: field(raw.explanation, 2000),
    suggestion: field(raw.suggestion, 1000),
    failedStep,
    // A selector is a fix for a locator, and nothing else: offered anywhere else it would be a guess.
    proposedSelector: category === "locator" && selector ? selector : null,
  };
}
