/**
 * Browser grids: where a plan's browsers can come from when the runners do not have the OS, the
 * browser or the version it asks for (server/browser-grids.ts).
 *
 * - BrowserStack and LambdaTest run Playwright on their machines: Windows and macOS, branded
 *   Chrome and Edge, older versions. The plan's OS, OS version and browser version are honoured.
 * - A Playwright server of one's own (`npx playwright run-server`, Browserless, Moon…) is reached
 *   at its address; it runs the browsers it has, like a runner, so OS and versions are not.
 *
 * - Local Appium is an Appium server next to a local agent (shared/agents.ts): emulators,
 *   simulators and phones on a desk. It runs apps, not browsers, and is reached through the agent,
 *   so the server needs no way into that network — only the agent's pool and Appium's address as
 *   the agent's machine sees it.
 *
 * Sauce Labs is not here: it runs Playwright only through its own CLI, not as a browser a runner
 * can connect to.
 */

export const BROWSER_GRID_PROVIDERS = ["browserstack", "lambdatest", "playwright_server", "local_appium"] as const;
export type BrowserGridProvider = (typeof BROWSER_GRID_PROVIDERS)[number];

export const BROWSER_GRID_LABELS: Record<BrowserGridProvider, string> = {
  browserstack: "BrowserStack",
  lambdatest: "LambdaTest",
  playwright_server: "Playwright server",
  local_appium: "Local Appium (agent)",
};

/** Whether the provider chooses OS and browser version, or runs what it has. */
export const HONOURS_MACHINE: Record<BrowserGridProvider, boolean> = {
  browserstack: true,
  lambdatest: true,
  playwright_server: false,
  local_appium: false,
};

/** Whether a plan's browsers can run there; a local Appium runs only mobile app tests. */
export const RUNS_BROWSERS: Record<BrowserGridProvider, boolean> = {
  browserstack: true,
  lambdatest: true,
  playwright_server: true,
  local_appium: false,
};

/** Where Appium listens when it is started with no options, on the agent's machine. */
export const LOCAL_APPIUM_DEFAULT_URL = "http://127.0.0.1:4723";

/** What each provider needs to be saved. */
export const GRID_FIELDS: Record<
  BrowserGridProvider,
  { username: boolean; endpoint: boolean; key: "required" | "optional" | "none"; agentPool: boolean; endpointRequired: boolean }
> = {
  browserstack: { username: true, endpoint: false, key: "required", agentPool: false, endpointRequired: false },
  lambdatest: { username: true, endpoint: false, key: "required", agentPool: false, endpointRequired: false },
  playwright_server: { username: false, endpoint: true, key: "optional", agentPool: false, endpointRequired: true },
  // The address defaults to LOCAL_APPIUM_DEFAULT_URL; Appium started with no options needs no key.
  local_appium: { username: false, endpoint: true, key: "none", agentPool: true, endpointRequired: false },
};

/** Why an address is not one this provider can use; null when it is. */
export function endpointProblem(provider: BrowserGridProvider, endpoint: string): string | null {
  if (provider === "playwright_server" && !/^wss?:\/\//i.test(endpoint)) return "The address of a Playwright server starts with ws:// or wss://";
  if (provider === "local_appium" && !/^https?:\/\/[^\s]+$/i.test(endpoint)) return "Appium's address starts with http:// or https://, as the agent's machine reaches it (http://127.0.0.1:4723).";
  return null;
}

/** The operating systems offered for a machine on a grid that chooses them. */
export const GRID_OPERATING_SYSTEMS = ["Windows", "macOS"] as const;
