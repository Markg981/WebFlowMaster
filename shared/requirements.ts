/**
 * Requirements traceability: which tests cover which epic, user story or requirement, and how
 * those tests did the last time they ran.
 *
 * "Is SHOP-142 tested, and does it pass?" is the question a QA lead is asked before a release,
 * and the answer used to be in nobody's data: a test knew its steps and a run its results, and
 * neither knew what they were for. A requirement is typed in or imported from the organization's
 * Jira or Azure DevOps (server/issue-providers.ts); linking tests to it is its coverage.
 *
 * Nothing here is stored: the state of a requirement is worked out from the latest result of each
 * test that covers it, every time it is asked, so it can never disagree with the reports.
 */

export const REQUIREMENT_KINDS = ["epic", "story", "requirement"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/**
 * What a tracker's issue type becomes here. Azure DevOps puts Features between Epics and stories;
 * they are grouping items like epics, and the parent chain keeps the levels apart anyway.
 */
export function kindFromTrackerType(type: string | null | undefined): RequirementKind {
  const name = (type ?? "").trim().toLowerCase();
  if (/^(epic|feature|initiative)$/.test(name)) return "epic";
  if (/story|product backlog item|backlog item/.test(name)) return "story";
  return "requirement";
}

/** How one test did the last time it ran, all browsers of that run together. */
export type TestOutcome = "passed" | "failed" | "pending" | "skipped" | "notRun";

/**
 * One run's result rows for a test (one per browser) as one outcome.
 *
 * Failed wins: a checkout that works on Chrome and not on Safari does not work. A manual test
 * waiting for its verdict is pending, not passed. Skipped only when nothing else happened.
 */
export function outcomeOf(statuses: string[]): TestOutcome {
  if (statuses.length === 0) return "notRun";
  const lower = statuses.map((s) => s.toLowerCase());
  if (lower.some((s) => s === "failed" || s === "error")) return "failed";
  if (lower.some((s) => s === "pending")) return "pending";
  if (lower.some((s) => s === "passed")) return "passed";
  return "skipped";
}

export const COVERAGE_STATES = ["passing", "failing", "notRun", "uncovered"] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

/**
 * A requirement's state from its tests' outcomes.
 *
 * - uncovered: no test covers it — the gap a traceability matrix exists to show;
 * - failing: at least one covering test failed the last time it ran;
 * - passing: every covering test passed the last time it ran;
 * - notRun: none failed, but some have not run, are skipped, or wait for a manual verdict.
 */
export function coverageState(outcomes: TestOutcome[]): CoverageState {
  if (outcomes.length === 0) return "uncovered";
  if (outcomes.includes("failed")) return "failing";
  if (outcomes.every((o) => o === "passed")) return "passing";
  return "notRun";
}

export interface CoverageRun {
  executionId: string;
  planId: string;
  planName: string | null;
  at: string | null;
}

export interface CoverageTest {
  type: "ui" | "api";
  id: number;
  name: string;
  outcome: TestOutcome;
  /** The run the outcome comes from; null when the test never ran (in the chosen plan). */
  lastRun: CoverageRun | null;
}

export interface RequirementCoverage {
  state: CoverageState;
  /** The tests that count: linked directly, and, for an epic, through its stories. */
  tests: CoverageTest[];
  passed: number;
  failed: number;
  /** Not run, skipped, or waiting for a manual verdict. */
  notRun: number;
  /**
   * Linked tests in projects the requester cannot see: counted, never named, and left out of the
   * state, which is worked out from what the requester can check for themselves.
   */
  hidden: number;
}

export interface RequirementNode {
  id: number;
  parentId: number | null;
}

export interface LinkRef {
  requirementId: number;
  type: "ui" | "api";
  testId: number;
}

const testKey = (type: "ui" | "api", id: number) => `${type}:${id}`;

/**
 * Each requirement's coverage, from the links and what is known about each linked test.
 *
 * `visible` holds the tests the requester can see, by `ui:12` / `api:3`, with their outcome; a
 * linked test missing from it is hidden. An epic counts its own tests and every descendant's,
 * each test once; a parent chain that loops (only possible through data written outside this
 * application) is followed once and no further.
 */
export function computeCoverage(
  nodes: RequirementNode[],
  links: LinkRef[],
  visible: Map<string, CoverageTest>,
): Map<number, RequirementCoverage> {
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.parentId == null) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }
  const direct = new Map<number, string[]>();
  for (const link of links) {
    direct.set(link.requirementId, [...(direct.get(link.requirementId) ?? []), testKey(link.type, link.testId)]);
  }

  const result = new Map<number, RequirementCoverage>();
  for (const node of nodes) {
    const keys = new Set<string>();
    const seen = new Set<number>();
    const walk = (id: number) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const key of direct.get(id) ?? []) keys.add(key);
      for (const child of children.get(id) ?? []) walk(child);
    };
    walk(node.id);

    const tests: CoverageTest[] = [];
    let hidden = 0;
    for (const key of Array.from(keys)) {
      const test = visible.get(key);
      if (test) tests.push(test);
      else hidden++;
    }
    tests.sort((a, b) => a.name.localeCompare(b.name));
    const outcomes = tests.map((t) => t.outcome);
    result.set(node.id, {
      state: coverageState(outcomes),
      tests,
      passed: outcomes.filter((o) => o === "passed").length,
      failed: outcomes.filter((o) => o === "failed").length,
      notRun: outcomes.filter((o) => o !== "passed" && o !== "failed").length,
      hidden,
    });
  }
  return result;
}

/** The whole set in numbers, for the tiles above the matrix. */
export function coverageSummary(coverages: RequirementCoverage[]) {
  const count = (state: CoverageState) => coverages.filter((c) => c.state === state).length;
  const total = coverages.length;
  const covered = total - count("uncovered");
  return {
    total,
    passing: count("passing"),
    failing: count("failing"),
    notRun: count("notRun"),
    uncovered: count("uncovered"),
    /** Share of requirements with at least one test, as a whole percentage. */
    coveredPercent: total === 0 ? 0 : Math.round((covered / total) * 100),
  };
}

/** A key a person can type: SHOP-142, 4711, REQ_12. */
export const REQUIREMENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
