/**
 * TestRail, Xray and Zephyr Scale: where QA teams keep their test cases and sign releases off.
 *
 * The results of automated runs had to be copied there by hand, case by case, after every run.
 * A connection names the tool and the account; each test says which case it is there; a plan that
 * names a connection publishes each finished run to it, as the tool understands a run:
 *
 *   TestRail      a test run in the project (and suite), with a result per case;
 *   Xray          a Test Execution issue, with a result per Test issue (Cloud or Server/Data Center);
 *   Zephyr Scale  a test cycle, with a test execution per test case.
 *
 * Kept free of anything server-only, so the settings page and the server agree on what each tool
 * needs and on what a result becomes there.
 */

export const TEST_MANAGEMENT_PROVIDERS = ["testrail", "xray_cloud", "xray_server", "zephyr_scale"] as const;
export type TestManagementProvider = (typeof TEST_MANAGEMENT_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<TestManagementProvider, string> = {
  testrail: "TestRail",
  xray_cloud: "Xray Cloud",
  xray_server: "Xray Server / Data Center",
  zephyr_scale: "Zephyr Scale Cloud",
};

/** What each tool needs besides a name and a token, and the address it usually lives at. */
export const PROVIDER_FIELDS: Record<
  TestManagementProvider,
  { username: "required" | "optional" | "none"; defaultBaseUrl: string | null; suite: boolean; testPlan: boolean; projectIsNumber: boolean }
> = {
  // user + API key; project and suite are numbers.
  testrail: { username: "required", defaultBaseUrl: null, suite: true, testPlan: false, projectIsNumber: true },
  // client id + client secret, at Xray's own address (or its EU/US/AU ones).
  xray_cloud: { username: "required", defaultBaseUrl: "https://xray.cloud.getxray.app", suite: false, testPlan: true, projectIsNumber: false },
  // The Jira address; a personal access token, or a user and password.
  xray_server: { username: "optional", defaultBaseUrl: null, suite: false, testPlan: true, projectIsNumber: false },
  // An API token, at SmartBear's address (or the EU one).
  zephyr_scale: { username: "none", defaultBaseUrl: "https://api.zephyrscale.smartbear.com/v2", suite: false, testPlan: false, projectIsNumber: false },
};

/**
 * A case key as each tool writes it: C123 (or 123) in TestRail, SHOP-45 in Xray, SHOP-T12 in Zephyr.
 * Normalised, so "c123" and "123" are both TestRail's C123.
 */
export function normaliseCaseKey(provider: TestManagementProvider, raw: string): string | null {
  const key = raw.trim().toUpperCase();
  if (provider === "testrail") {
    const match = /^C?(\d{1,10})$/.exec(key);
    return match ? `C${match[1]}` : null;
  }
  if (provider === "zephyr_scale") return /^[A-Z][A-Z0-9_]{0,19}-T\d{1,10}$/.test(key) ? key : null;
  return /^[A-Z][A-Z0-9_]{0,19}-\d{1,10}$/.test(key) ? key : null;
}

/**
 * The case key written in a test's name, for a test with no link of its own: "[C123] Login",
 * "Checkout [SHOP-T12]". A convention many teams already follow; the first bracket that holds a
 * key of this tool wins.
 */
export function caseKeyFromName(provider: TestManagementProvider, name: string): string | null {
  for (const match of Array.from(name.matchAll(/\[([^\]]{1,40})\]/g))) {
    const key = normaliseCaseKey(provider, match[1]);
    if (key) return key;
  }
  return null;
}

/** One test's outcome in a run, all its browsers together (shared/requirements.ts decides it). */
export type PublishedOutcome = "passed" | "failed" | "pending" | "skipped" | "notRun";

/** TestRail's default statuses. Untested cannot be posted: a case left untested is simply not sent. */
export const TESTRAIL_STATUS: Record<PublishedOutcome, number | null> = {
  passed: 1,
  failed: 5,
  // Could not be carried out: a manual test judged blocked, an automated one skipped.
  skipped: 2,
  pending: null,
  notRun: null,
};

/** Xray's statuses, which Cloud and Server spell differently. */
export function xrayStatus(outcome: PublishedOutcome, provider: "xray_cloud" | "xray_server"): string {
  const cloud = provider === "xray_cloud";
  switch (outcome) {
    case "passed":
      return cloud ? "PASSED" : "PASS";
    case "failed":
      return cloud ? "FAILED" : "FAIL";
    case "skipped":
      return "ABORTED";
    default:
      return "TODO";
  }
}

/** Zephyr Scale's default test execution statuses, by name; a project may rename them. */
export const ZEPHYR_STATUS: Record<PublishedOutcome, string> = {
  passed: "Pass",
  failed: "Fail",
  skipped: "Blocked",
  pending: "Not Executed",
  notRun: "Not Executed",
};
