/**
 * Browser grids: where a plan's browsers can come from when the runners do not have the OS, the
 * browser or the version it asks for (server/browser-grids.ts).
 *
 * - BrowserStack and LambdaTest run Playwright on their machines: Windows and macOS, branded
 *   Chrome and Edge, older versions. The plan's OS, OS version and browser version are honoured.
 * - A Playwright server of one's own (`npx playwright run-server`, Browserless, Moon…) is reached
 *   at its address; it runs the browsers it has, like a runner, so OS and versions are not.
 *
 * Sauce Labs is not here: it runs Playwright only through its own CLI, not as a browser a runner
 * can connect to.
 */

export const BROWSER_GRID_PROVIDERS = ["browserstack", "lambdatest", "playwright_server"] as const;
export type BrowserGridProvider = (typeof BROWSER_GRID_PROVIDERS)[number];

export const BROWSER_GRID_LABELS: Record<BrowserGridProvider, string> = {
  browserstack: "BrowserStack",
  lambdatest: "LambdaTest",
  playwright_server: "Playwright server",
};

/** Whether the provider chooses OS and browser version, or runs what it has. */
export const HONOURS_MACHINE: Record<BrowserGridProvider, boolean> = {
  browserstack: true,
  lambdatest: true,
  playwright_server: false,
};

/** What each provider needs to be saved. */
export const GRID_FIELDS: Record<BrowserGridProvider, { username: boolean; endpoint: boolean; key: "required" | "optional" }> = {
  browserstack: { username: true, endpoint: false, key: "required" },
  lambdatest: { username: true, endpoint: false, key: "required" },
  playwright_server: { username: false, endpoint: true, key: "optional" },
};

/** The operating systems offered for a machine on a grid that chooses them. */
export const GRID_OPERATING_SYSTEMS = ["Windows", "macOS"] as const;
