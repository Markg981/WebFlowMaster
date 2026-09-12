import type { Page } from 'playwright';
import type { PlaywrightReporter } from './playwright-reporter';
import { ADHOC_ACTION_IDS, type AdhocActionId } from '@shared/recording';
import { requestVariables, substituteVariables } from './outbound-http';

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
 */

/**
 * Actions this executor can run.
 *
 * Asserted against `ADHOC_ACTION_IDS` by the test suite: the builder's palette, the
 * recorder's mapping and this executor have to agree, and previously nothing checked that
 * they did.
 */
export const HANDLED_ACTION_IDS: ReadonlySet<AdhocActionId> = new Set(ADHOC_ACTION_IDS);

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
  targetElement?: { selector?: string } | null;
  value?: unknown;
}

const passed: StepOutcome = { status: 'passed' };
const failed = (error: string): StepOutcome => ({ status: 'failed', error });

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

/**
 * Runs one step against the page.
 *
 * Returns a failed outcome for an assertion that did not hold or a step that is missing a
 * selector or value — normal product outcomes the caller records against the step. Throws
 * for an interaction that could not be carried out at all, which the caller already catches
 * and reports the same way.
 */
export async function executeStep(ctx: StepContext, step: ExecutableStep): Promise<StepOutcome> {
  const { page, reporter } = ctx;
  const actionId = step.action?.id;
  const actionName = step.action?.name || 'Unnamed Action';
  const vars = ctx.vars ?? requestVariables();
  const selector = step.targetElement?.selector;
  const subst = (value: string) => substituteVariables(value, vars);

  // Routed through the reporter when there is one, so AI healing still wraps the two
  // actions it knows how to repair.
  const click = (sel: string) => (reporter ? reporter.click(sel, actionName) : page.click(sel));
  const fill = (sel: string, value: string) =>
    reporter ? reporter.fill(sel, value, actionName) : page.fill(sel, value);

  if (!actionId) throw new Error('Step action ID is missing.');

  switch (actionId as AdhocActionId) {
    case 'click': {
      if (!selector) throw new Error('Selector missing for click action.');
      await click(selector);
      return passed;
    }

    case 'input': {
      if (!selector) throw new Error('Selector missing for input action.');
      if (typeof step.value !== 'string') throw new Error('Value missing for input action.');
      // Substitution applies on every path. A recorded password is stored as a
      // `{{secret_…}}` placeholder, never in clear text, and has to resolve here.
      await fill(selector, subst(step.value));
      return passed;
    }

    case 'wait': {
      if (typeof step.value !== 'string' || isNaN(parseInt(step.value))) {
        throw new Error('Invalid or missing value for wait action.');
      }
      await page.waitForTimeout(parseInt(step.value));
      return passed;
    }

    case 'scroll': {
      if (selector) {
        await page.locator(selector).scrollIntoViewIfNeeded();
      } else {
        await page.evaluate(() => window.scrollBy(0, 200));
      }
      return passed;
    }

    case 'navigate': {
      // Only standalone navigations reach here: ones implied by a click are filtered out
      // while recording (see isRedundantNavigation).
      const destination = typeof step.value === 'string' ? step.value.trim() : '';
      if (!destination) throw new Error('URL (value) missing for navigate action.');
      await page.goto(subst(destination), { waitUntil: 'domcontentloaded' });
      return passed;
    }

    case 'assert': {
      // "Element is visible" — the assertion the recorder emits when the user picks the
      // visibility check in the in-page assert panel. The persisted copy used to only count
      // nodes, so an element present but hidden passed there and failed in the preview.
      if (!selector) return failed('Selector missing for visibility assert action.');
      const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
      return isVisible ? passed : failed(`Assertion Failed: Element "${selector}" is not visible.`);
    }

    case 'assertTextContains': {
      if (!selector) return failed('Selector missing for assertTextContains action.');
      if (typeof step.value !== 'string' || step.value.trim() === '') {
        return failed('Expected text (value) missing or empty for assertTextContains action.');
      }
      const expected = subst(step.value);
      const actualText = await page.locator(selector).textContent();
      if (actualText === null || !actualText.includes(expected)) {
        return failed(
          `Assertion Failed: Element "${selector}" did not contain text "${expected}". ` +
            `Actual: "${actualText === null ? 'null' : actualText}".`,
        );
      }
      return passed;
    }

    case 'assertElementCount': {
      if (!selector) return failed('Selector missing for assertElementCount action.');
      if (typeof step.value !== 'string' || step.value.trim() === '') {
        return failed('Expected count (value) missing or empty for assertElementCount action.');
      }
      const parsed = parseAssertionValue(step.value);
      if (!parsed) {
        return failed(
          `Invalid format for assertElementCount value: "${step.value}". ` +
            'Expected format like "==5", ">=2", or "3".',
        );
      }
      const actualCount = await page.locator(selector).count();
      const matched = compareCount(parsed.operator, actualCount, parsed.count);
      if (matched === null) {
        return failed(`Unknown operator "${parsed.operator}" for assertElementCount.`);
      }
      if (!matched) {
        return failed(
          `Assertion Failed: Element count for selector "${selector}" did not match. ` +
            `Expected ${parsed.operator} ${parsed.count}, Actual: ${actualCount}.`,
        );
      }
      return passed;
    }

    case 'hover': {
      if (!selector) throw new Error('Selector missing for hover action.');
      await page.hover(selector);
      return passed;
    }

    case 'select': {
      if (!selector) return failed('Selector missing for select action.');
      if (typeof step.value !== 'string' || step.value.trim() === '') {
        return failed('Value missing for select action (expected option value).');
      }
      await page.selectOption(selector, subst(step.value));
      return passed;
    }

    default:
      throw new Error(`Unsupported action ID: ${actionId}`);
  }
}
