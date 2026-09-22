import playwright, { type Browser } from 'playwright';

/**
 * Turning what a plan or a schedule *says* about browsers into something that can be launched.
 *
 * Both the plan wizard (`test_plans.test_machines_config`) and the schedule form
 * (`test_plan_schedules.browsers`) have always collected this, and the runner has always
 * ignored it: `executeTestSequence` read the browser off the *user's* settings, so a schedule
 * that ticked Firefox and WebKit ran twice on whatever engine the schedule's owner happened to
 * have selected in their profile — once, not twice. The configuration was a decoration.
 *
 * The vocabulary is not Playwright's, which is the other half of the problem. The wizard
 * offers "chrome" and "edge", the schedule form adds "safari", and Playwright has three
 * engines and a channel flag. That mapping lives here, in one place, rather than in whichever
 * call site got there first.
 */

export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

export interface BrowserChoice {
  /**
   * The name the configuration used, kept verbatim for the report.
   *
   * A result row that says "edge" when the user asked for Edge is worth more than one that
   * says "chromium" because that is the engine underneath.
   */
  label: string;
  engine: BrowserEngine;
  /** Playwright channel, for the branded builds that are a channel of an engine. */
  channel?: string;
  headless: boolean;
}

/**
 * What each name people can choose actually means to Playwright.
 *
 * `safari` maps to WebKit: Playwright drives the WebKit engine Safari is built on, not
 * Safari itself. That is an approximation, and `browsersForRun` says so out loud rather than
 * letting a report claim a Safari run that never happened.
 */
const ENGINE_BY_NAME: Record<string, { engine: BrowserEngine; channel?: string; approximate?: string }> = {
  chromium: { engine: 'chromium' },
  chrome: { engine: 'chromium', channel: 'chrome' },
  edge: { engine: 'chromium', channel: 'msedge' },
  msedge: { engine: 'chromium', channel: 'msedge' },
  firefox: { engine: 'firefox' },
  webkit: { engine: 'webkit' },
  safari: {
    engine: 'webkit',
    approximate: 'Safari runs on the WebKit engine Playwright bundles, not on Safari itself.',
  },
};

export const DEFAULT_BROWSER_LABEL = 'chromium';

/** One machine row as the plan wizard stores it in `test_machines_config`. */
export interface TestMachineConfig {
  os?: string | null;
  osVersion?: string | null;
  browserName?: string | null;
  browserVersion?: string | null;
  headless?: boolean | null;
}

export interface BrowserMatrix {
  browsers: BrowserChoice[];
  /**
   * What was asked for and could not be honoured exactly.
   *
   * These reach the run's console. A plan that asks for Windows 11 and Chrome 118 gets
   * whatever OS the runner is installed on and whatever Chrome build is on it, and silence
   * about that is how a green report comes to mean less than the person reading it thinks.
   */
  warnings: string[];
}

/**
 * The array a jsonb column holds, whether it comes back parsed or as text.
 *
 * Both happen here: rows written through the API are stringified on the way in (the
 * codebase's convention for these columns) and some readers get the string straight back —
 * `fetchScheduleWithPlanName` has always had to parse them by hand. A matrix that silently
 * ignored a string would be this whole change failing quietly on exactly the schedules it
 * exists for.
 */
function asArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether a stored value names any browser at all — see `asArray` on why it may be text. */
export function hasConfiguredBrowsers(value: unknown): boolean {
  const array = asArray(value);
  return array !== null && array.length > 0;
}

export function resolveBrowser(name: string, headless: boolean): BrowserChoice | null {
  const key = name?.trim().toLowerCase();
  const mapped = key ? ENGINE_BY_NAME[key] : undefined;
  if (!mapped) return null;
  return { label: key, engine: mapped.engine, channel: mapped.channel, headless };
}

export interface BrowserMatrixInput {
  /** `test_plan_executions.browsers` — what the schedule asked for, when a schedule ran this. */
  executionBrowsers?: unknown;
  /** `test_plans.test_machines_config` — what the plan wizard collected. */
  testMachines?: unknown;
  /** The user's own default, used when neither of the above says anything. */
  fallback?: { label: string; headless: boolean };
}

/**
 * The browsers one run should cover, in the order they will be run.
 *
 * Precedence is schedule over plan, because the schedule is the more specific statement:
 * "the nightly run covers Firefox too" is a decision about that schedule, not a correction
 * to the plan. Neither present means one run on the user's default, which is exactly what
 * every existing plan did before this existed.
 */
export function browsersForRun(input: BrowserMatrixInput): BrowserMatrix {
  const warnings: string[] = [];
  const browsers: BrowserChoice[] = [];
  const seen = new Set<string>();
  const scheduledBrowsers = asArray(input.executionBrowsers);
  const machines = asArray(input.testMachines) as TestMachineConfig[] | null;

  const add = (choice: BrowserChoice | null, rawName: string) => {
    if (!choice) {
      warnings.push(`Unknown browser "${rawName}" in this plan's configuration — skipped.`);
      return;
    }
    const key = `${choice.label}:${choice.headless}`;
    if (seen.has(key)) return;
    seen.add(key);
    const approximate = ENGINE_BY_NAME[choice.label]?.approximate;
    if (approximate) warnings.push(approximate);
    browsers.push(choice);
  };

  if (scheduledBrowsers && scheduledBrowsers.length > 0) {
    for (const name of scheduledBrowsers) {
      if (typeof name !== 'string') continue;
      // A schedule says which browsers, never whether to show them: a scheduled run has
      // nobody watching it, so it is headless whatever the plan's machines say.
      add(resolveBrowser(name, true), name);
    }
  } else {
    if (machines && machines.length > 0) {
      for (const machine of machines) {
        const name = typeof machine?.browserName === 'string' ? machine.browserName : '';
        add(resolveBrowser(name, machine?.headless !== false), name || '(empty)');
      }
      warnings.push(...unsupportedMachineFields(machines));
    }
  }

  if (browsers.length === 0) {
    const fallback = input.fallback ?? { label: DEFAULT_BROWSER_LABEL, headless: true };
    const resolved = resolveBrowser(fallback.label, fallback.headless);
    browsers.push(resolved ?? { label: DEFAULT_BROWSER_LABEL, engine: 'chromium', headless: fallback.headless });
  }

  return { browsers, warnings };
}

/**
 * The parts of a machine configuration this runner cannot deliver.
 *
 * It runs tests on the machine it is installed on, so an OS and an OS version are a request
 * it can only note; a browser version is the same, since Playwright ships one build per
 * engine and a channel points at whatever is installed. Saying so is the difference between
 * a limitation and a lie.
 */
export function unsupportedMachineFields(machines: TestMachineConfig[]): string[] {
  const warnings: string[] = [];
  const operatingSystems = new Set(
    machines.map((m) => [m.os, m.osVersion].filter(Boolean).join(' ')).filter(Boolean),
  );
  if (operatingSystems.size > 0) {
    warnings.push(
      `This runner executes on its own host OS: the requested ${[...operatingSystems].join(', ')} ` +
        `${operatingSystems.size === 1 ? 'was' : 'were'} not applied.`,
    );
  }
  const versions = new Set(
    machines
      .map((m) => (m.browserVersion && m.browserVersion.toLowerCase() !== 'latest' ? `${m.browserName} ${m.browserVersion}` : ''))
      .filter(Boolean),
  );
  if (versions.size > 0) {
    warnings.push(
      `Browser versions are whatever this runner has installed: ${[...versions].join(', ')} not applied.`,
    );
  }
  return warnings;
}

/** A label for the run's logs and for the report column. */
export function describeBrowser(choice: BrowserChoice): string {
  const base = choice.channel ? `${choice.label} (${choice.engine}/${choice.channel})` : choice.label;
  return choice.headless ? base : `${base}, headed`;
}

/**
 * Launches one choice.
 *
 * Failure here is reported as itself rather than as a test failure: "Edge is not installed on
 * this runner" is an infrastructure fact, and a report that files it under "the login test
 * failed" sends somebody to read the login test.
 */
export async function launchBrowser(choice: BrowserChoice): Promise<Browser> {
  const engine = playwright[choice.engine];
  if (!engine) throw new Error(`Invalid browser engine: ${choice.engine}`);
  try {
    return await engine.launch({
      headless: choice.headless,
      ...(choice.channel ? { channel: choice.channel } : {}),
    });
  } catch (error: any) {
    const what = choice.channel ? `${choice.label} (channel "${choice.channel}")` : choice.label;
    throw new Error(
      `Could not start ${what} on this runner: ${error?.message ?? error}. ` +
        `Install it, or remove it from the plan's browser configuration.`,
    );
  }
}
