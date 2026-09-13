import type { Locator, Page } from 'playwright';
import type { PlaywrightReporter } from './playwright-reporter';
import { ADHOC_ACTION_IDS, type AdhocActionId } from '@shared/recording';
import { requestVariables, substituteVariables } from './outbound-http';
import { findUnresolvedVariables } from './variables';

/**
 * The single implementation of "run one step of a test sequence".
 *
 * There used to be two, one inside `executeAdhocSequence` and one inside
 * `executeTestSequence`, and they had drifted: the persisted one had no `navigate` case, so
 * a recorded multi-page test passed in the builder's preview and failed on every replay and
 * every schedule, and it skipped variable substitution, so a recorded `{{secret_…}}`
 * password was typed into the app verbatim. Both were consequences of the duplication rather
 * than separate mistakes, which is why this file exists instead of a patch to each copy.
 *
 * The two callers still differ in what they own — browser lifecycle, screenshots, WebSocket
 * logs, Allure reporting — and keep owning it. Only the step itself is shared.
 *
 * Actions live in a `Record<AdhocActionId, …>` rather than a `switch` on purpose: that makes
 * the compiler, not a reviewer, the thing that notices an action declared in
 * `shared/recording.ts` with no implementation here. The drift this file exists to fix was
 * exactly that, and a `switch` cannot catch it.
 */

export interface StepContext {
  page: Page;
  /**
   * Present only on the persisted path. When set, interactions route through it so a failed
   * selector can be repaired by the AI healing pass; the ad-hoc preview has no reporter and
   * talks to the page directly.
   */
  reporter?: PlaywrightReporter;
  /** Resolved `{{name}}` values. Defaults to the process-level set when omitted. */
  vars?: Record<string, string>;
}

export interface StepOutcome {
  status: 'passed' | 'failed';
  error?: string;
}

/** The step shape both callers pass in — the builder's `TestStep`, structurally. */
export interface ExecutableStep {
  action?: { id?: string; name?: string } | null;
  targetElement?: { selector?: string; frameSelector?: string | null } | null;
  value?: unknown;
}

/**
 * Where a step's selectors resolve: the page, or a chain of iframes within it.
 *
 * The chain is ' >> ' separated and outermost first, as element detection records it.
 */
function frameScope(page: Page, frameSelector?: string | null) {
  if (!frameSelector) return page;
  return frameSelector
    .split(' >> ')
    .filter(Boolean)
    .reduce<any>((scope, step) => scope.frameLocator(step), page);
}

const passed: StepOutcome = { status: 'passed' };
const failed = (error: string): StepOutcome => ({ status: 'failed', error });

/** Marks the message so callers and tests can recognise this specific failure. */
export const UNRESOLVED_VARIABLE_ERROR = 'Unresolved variable(s)';

/** Ceiling for the conditional waits. Long enough for a slow SignalR push, short enough
 * that a genuinely missing element fails the step rather than stalling the run. */
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;

/** Where non-native dropdowns put their options, across the libraries DMO actually uses. */
const OPTION_SELECTOR = '[role="option"], .mat-mdc-option, .mat-option, .ng-option';

/**
 * Substitution deliberately leaves an unknown `{{name}}` in place rather than blanking it.
 * That is right for a URL, where a wrong address is obvious, and wrong for a value typed
 * into the page: a literal `{{secret_password}}` entered into a login form looks like a
 * failed login, and the tester has no way to tell the two apart. Anything sent to the
 * system under test is checked first, and reported by name.
 */
function resolveValue(
  raw: string,
  vars: Record<string, string>,
): { value: string } | { error: string } {
  const missing = findUnresolvedVariables(raw, vars);
  if (missing.length > 0) {
    return {
      error:
        `${UNRESOLVED_VARIABLE_ERROR} ${missing.join(', ')}. ` +
        'Select an environment that defines them, or write the value in full.',
    };
  }
  return { value: substituteVariables(raw, vars) };
}

/** Parses the `assertElementCount` value: `"==5"`, `">=2"`, or a bare `"3"`. */
export function parseAssertionValue(value: string): { operator: string; count: number } | null {
  const match = value.match(/^(==|>=|<=|>|<|!=)?\s*(\d+)$/);
  if (!match) {
    const singleNumberMatch = value.match(/^\s*(\d+)\s*$/);
    if (singleNumberMatch) {
      return { operator: '==', count: parseInt(singleNumberMatch[1], 10) };
    }
    return null;
  }
  return { operator: match[1] || '==', count: parseInt(match[2], 10) };
}

function compareCount(operator: string, actual: number, expected: number): boolean | null {
  switch (operator) {
    case '==': return actual === expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '!=': return actual !== expected;
    default: return null;
  }
}

/** What a handler is given. Everything a step can need, already resolved. */
interface StepRuntime {
  page: Page;
  vars: Record<string, string>;
  /** The step's target selector, if it has one. */
  selector?: string;
  /** The step's raw value, before substitution. */
  raw?: unknown;
  actionName: string;
  /** Routed through the reporter when there is one, so AI healing still applies. */
  click: (selector: string) => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  /**
   * A locator for a selector, inside the step's frame when it has one.
   *
   * Every handler goes through this rather than `page.locator` directly: page.locator does
   * not cross an iframe boundary, so an element inside one was unreachable however correct
   * its selector was.
   */
  locator: (selector: string) => Locator;
  /** Same, for Playwright's role engine, which also needs the frame. */
  byRole: (role: string, name: string) => Locator;
  timeoutMs: number;
}

/** Reads the step's value as a non-empty string, or explains what is missing. */
function requireValue(rt: StepRuntime, action: string): { value: string } | { error: string } {
  if (typeof rt.raw !== 'string' || rt.raw.trim() === '') {
    return { error: `Value missing for ${action} action.` };
  }
  return resolveValue(rt.raw, rt.vars);
}

/** Reads the step's selector, or explains what is missing. */
function requireSelector(rt: StepRuntime, action: string): { selector: string } | { error: string } {
  if (!rt.selector) return { error: `Selector missing for ${action} action.` };
  return { selector: rt.selector };
}

type StepHandler = (rt: StepRuntime) => Promise<StepOutcome>;

const HANDLERS: Record<AdhocActionId, StepHandler> = {
  click: async (rt) => {
    const target = requireSelector(rt, 'click');
    if ('error' in target) throw new Error(target.error);
    await rt.click(target.selector);
    return passed;
  },

  input: async (rt) => {
    const target = requireSelector(rt, 'input');
    if ('error' in target) throw new Error(target.error);
    if (typeof rt.raw !== 'string') throw new Error('Value missing for input action.');
    // A recorded password is stored as a `{{secret_…}}` placeholder, never in clear text,
    // and has to resolve here — on every path, which is the point of the shared executor.
    const typed = resolveValue(rt.raw, rt.vars);
    if ('error' in typed) return failed(typed.error);
    await rt.fill(target.selector, typed.value);
    return passed;
  },

  wait: async (rt) => {
    if (typeof rt.raw !== 'string' || isNaN(parseInt(rt.raw))) {
      throw new Error('Invalid or missing value for wait action.');
    }
    await rt.page.waitForTimeout(parseInt(rt.raw));
    return passed;
  },

  scroll: async (rt) => {
    if (rt.selector) {
      await rt.locator(rt.selector).scrollIntoViewIfNeeded();
    } else {
      await rt.page.evaluate(() => window.scrollBy(0, 200));
    }
    return passed;
  },

  navigate: async (rt) => {
    // Only standalone navigations reach here: ones implied by a click are filtered out
    // while recording (see isRedundantNavigation).
    const destination = typeof rt.raw === 'string' ? rt.raw.trim() : '';
    if (!destination) throw new Error('URL (value) missing for navigate action.');
    const target = resolveValue(destination, rt.vars);
    if ('error' in target) return failed(target.error);
    await rt.page.goto(target.value, { waitUntil: 'domcontentloaded' });
    return passed;
  },

  assert: async (rt) => {
    // "Element is visible" — the assertion the recorder emits when the user picks the
    // visibility check in the in-page assert panel. The persisted copy used to only count
    // nodes, so an element present but hidden passed there and failed in the preview.
    const target = requireSelector(rt, 'visibility assert');
    if ('error' in target) return failed(target.error);
    const isVisible = await rt.locator(target.selector).first().isVisible().catch(() => false);
    return isVisible
      ? passed
      : failed(`Assertion Failed: Element "${target.selector}" is not visible.`);
  },

  assertTextContains: async (rt) => {
    const target = requireSelector(rt, 'assertTextContains');
    if ('error' in target) return failed(target.error);
    const expected = requireValue(rt, 'assertTextContains');
    if ('error' in expected) return failed(expected.error);
    const actualText = await rt.locator(target.selector).textContent();
    if (actualText === null || !actualText.includes(expected.value)) {
      return failed(
        `Assertion Failed: Element "${target.selector}" did not contain text ` +
          `"${expected.value}". Actual: "${actualText === null ? 'null' : actualText}".`,
      );
    }
    return passed;
  },

  assertElementCount: async (rt) => {
    const target = requireSelector(rt, 'assertElementCount');
    if ('error' in target) return failed(target.error);
    if (typeof rt.raw !== 'string' || rt.raw.trim() === '') {
      return failed('Expected count (value) missing or empty for assertElementCount action.');
    }
    const parsed = parseAssertionValue(rt.raw);
    if (!parsed) {
      return failed(
        `Invalid format for assertElementCount value: "${rt.raw}". ` +
          'Expected format like "==5", ">=2", or "3".',
      );
    }
    const actualCount = await rt.locator(target.selector).count();
    const matched = compareCount(parsed.operator, actualCount, parsed.count);
    if (matched === null) {
      return failed(`Unknown operator "${parsed.operator}" for assertElementCount.`);
    }
    if (!matched) {
      return failed(
        `Assertion Failed: Element count for selector "${target.selector}" did not match. ` +
          `Expected ${parsed.operator} ${parsed.count}, Actual: ${actualCount}.`,
      );
    }
    return passed;
  },

  hover: async (rt) => {
    const target = requireSelector(rt, 'hover');
    if ('error' in target) throw new Error(target.error);
    await rt.locator(target.selector).first().hover();
    return passed;
  },

  select: async (rt) => {
    const target = requireSelector(rt, 'select');
    if ('error' in target) return failed(target.error);
    const option = requireValue(rt, 'select');
    if ('error' in option) return failed(option.error);
    await rt.locator(target.selector).first().selectOption(option.value);
    return passed;
  },

  /**
   * Waits for an element to reach a state, rather than for a duration.
   *
   * The only wait that existed was a fixed timer, which on a page that renders after a
   * SignalR push is a guess: too short and the test fails for a reason that has nothing to
   * do with what it checks, too long and every run pays for it.
   */
  waitForElement: async (rt) => {
    const target = requireSelector(rt, 'waitForElement');
    if ('error' in target) return failed(target.error);

    const wanted = typeof rt.raw === 'string' ? rt.raw.trim().toLowerCase() : '';
    const state = wanted === 'hidden' ? 'hidden' : 'visible';

    try {
      await rt.locator(target.selector).first().waitFor({ state, timeout: rt.timeoutMs });
      return passed;
    } catch {
      // Playwright's own timeout message describes the locator machinery, not the intent.
      return failed(
        `Timed out after ${rt.timeoutMs}ms waiting for "${target.selector}" to be ${state}.`,
      );
    }
  },

  /** Waits for an element to contain text — the "did the update arrive yet" wait. */
  waitForText: async (rt) => {
    const target = requireSelector(rt, 'waitForText');
    if ('error' in target) return failed(target.error);
    const expected = requireValue(rt, 'waitForText');
    if ('error' in expected) return failed(expected.error);

    try {
      // `filter({ hasText })` takes the text as data, so it needs no escaping — unlike
      // building a `:has-text("…")` selector string out of whatever the tester typed.
      await rt
        .locator(target.selector)
        .filter({ hasText: expected.value })
        .first()
        .waitFor({ state: 'attached', timeout: rt.timeoutMs });
      return passed;
    } catch {
      const actual = await rt.locator(target.selector).first().textContent().catch(() => null);
      return failed(
        `Timed out after ${rt.timeoutMs}ms waiting for "${target.selector}" to contain ` +
          `"${expected.value}". Last seen: "${actual ?? 'nothing'}".`,
      );
    }
  },

  /** Waits for in-flight requests to settle, for the "saved, now reload the grid" case. */
  waitForNetworkIdle: async (rt) => {
    try {
      await rt.page.waitForLoadState('networkidle', { timeout: rt.timeoutMs });
      return passed;
    } catch {
      // Unlike the screenshot helper, which swallows this: here the wait *is* the step, so
      // a page that never settles is the step's result, not a detail to hide.
      return failed(
        `Timed out after ${rt.timeoutMs}ms waiting for network activity to settle. ` +
          'A page with a persistent connection (long-polling, WebSocket, SignalR) may never ' +
          'go idle — wait for an element or a text instead.',
      );
    }
  },

  /**
   * Picks an option from a dropdown that is not a native `<select>`.
   *
   * `select` calls `page.selectOption`, which only drives real `<select>` elements. Angular
   * Material renders a `mat-select` as a div whose options are mounted in a CDK overlay
   * elsewhere in the document, so the whole interaction is click, wait, click. Matching on
   * `role="option"` first covers mat-select, ng-select and anything else that gets its
   * accessibility right, and the text fallback covers the ones that do not.
   */
  selectByText: async (rt) => {
    const target = requireSelector(rt, 'selectByText');
    if ('error' in target) return failed(target.error);
    const wanted = requireValue(rt, 'selectByText');
    if ('error' in wanted) return failed(wanted.error);

    await rt.click(target.selector);

    // One locator, one timeout. Trying the two strategies in sequence meant an option that
    // genuinely is not there cost two full timeouts before the step failed.
    const option = rt
      .byRole('option', wanted.value)
      // Some overlays mark their options with a class instead of a role.
      .or(rt.locator(OPTION_SELECTOR).filter({ hasText: wanted.value }))
      .first();

    try {
      await option.waitFor({ state: 'visible', timeout: rt.timeoutMs });
      await option.click();
      return passed;
    } catch {
      // Fall through to the report below, which says what was on offer instead.
    }

    // Report what was actually on offer: "option not found" sends the tester back to the
    // browser to find out, and the runner already knows.
    const seen = await rt
      .locator(OPTION_SELECTOR)
      .allTextContents()
      .catch(() => [] as string[]);
    const offered = seen.map((t) => t.trim()).filter(Boolean);

    return failed(
      `Could not find option "${wanted.value}" in the dropdown opened by ` +
        `"${target.selector}". ` +
        (offered.length > 0
          ? `Options seen: ${offered.join(', ')}.`
          : 'No options were visible — the trigger may not have opened.'),
    );
  },
};

/**
 * Actions this executor can run.
 *
 * Derived from the handler map, not from `ADHOC_ACTION_IDS`: an earlier version read the
 * declaration list, which made the coverage test compare the list to itself.
 */
export const HANDLED_ACTION_IDS: ReadonlySet<AdhocActionId> = new Set(
  Object.keys(HANDLERS) as AdhocActionId[],
);

/**
 * Runs one step against the page.
 *
 * Returns a failed outcome for an assertion that did not hold, a wait that timed out, or a
 * step missing a selector or value — normal product outcomes the caller records against the
 * step. Throws for an interaction that could not be carried out at all, which the caller
 * already catches and reports the same way.
 */
export async function executeStep(ctx: StepContext, step: ExecutableStep): Promise<StepOutcome> {
  const { page, reporter } = ctx;
  const actionId = step.action?.id;
  const actionName = step.action?.name || 'Unnamed Action';

  if (!actionId) throw new Error('Step action ID is missing.');

  const handler = HANDLERS[actionId as AdhocActionId];
  if (!handler) throw new Error(`Unsupported action ID: ${actionId}`);

  // Where this step's selectors resolve: the page, or the iframe chain the element was
  // detected in. page.locator does not cross that boundary, so without this an element
  // inside a frame is unreachable however correct its selector is.
  const scope = frameScope(page, step.targetElement?.frameSelector);

  const rt: StepRuntime = {
    page,
    vars: ctx.vars ?? requestVariables(),
    selector: step.targetElement?.selector,
    raw: step.value,
    actionName,
    // The reporter drives the page directly and knows nothing about frames, so a step
    // inside one goes straight to the locator. It loses AI healing for that step, which is
    // the honest trade: healing a selector in the wrong document would be worse.
    click: (sel) =>
      reporter && scope === page
        ? reporter.click(sel, actionName)
        : scope.locator(sel).first().click(),
    fill: (sel, value) =>
      reporter && scope === page
        ? reporter.fill(sel, value, actionName)
        : scope.locator(sel).first().fill(value),
    locator: (sel) => scope.locator(sel),
    byRole: (role, name) => scope.getByRole(role as any, { name, exact: false }),
    timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
  };

  return handler(rt);
}

/** Every action id the engine knows, in declaration order. Re-exported for the client. */
export { ADHOC_ACTION_IDS };
