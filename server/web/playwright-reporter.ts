import { Page } from 'playwright';
import type { ExecutionAttemptRef } from '@shared/execution-identity';
import type { HealingOrigin, StepHealing } from '@shared/healing';
import { aiService } from '../authoring/ai-automation-service';
import { domForModel, knownFallbacks, recordHealingProposal } from '../authoring/healing-proposals';
import { storableSelector } from '../authoring/selector-healing';
import type { StepProvenance } from '../authoring/step-provenance';
import { gotoWithinPolicy } from '../platform/egress-policy';

/**
 * Drives a page on behalf of a step, with healing of the selector when the step fails.
 *
 * Its name is from a time it also reported: every action was wrapped in a "step" of a reporting
 * service, and a failure attached a screenshot to it. That service was a stub — the step ran its
 * body and the screenshot went nowhere — so the wrapping is gone. Evidence is the runner's
 * (server/web/playwright-service.ts takes the error screenshots) and the Allure report is built from
 * the stored run (server/reporting/allure-export.ts).
 */

/** What the runner knows about the step being driven: which test, and where the step is written. */
export interface HealingContext {
  testId: number;
  /**
   * Where the step is written (server/authoring/step-provenance.ts). Not the runner's position:
   * after a group is expanded the two differ, and a repair keyed by the runner's position landed
   * on whichever step of the test happened to be there (C05).
   */
  provenance: StepProvenance | null;
  /**
   * The repository element this step points at, when it points at one: a repair of a shared
   * element goes to the element, so every test that names it is fixed before it runs.
   */
  elementId: string | null;
  executionId?: string | null;
  userId?: number | null;
  /** The plan run's attempt this step is part of, for the proposal. */
  attempt?: ExecutionAttemptRef | null;
  /** The runner's position, for the proposal's report. */
  stepIndex?: number;
  /** What the recording kept of the element: its known fallbacks come from here. */
  element?: { tag?: unknown; attributes?: unknown } | null;
}

/** How long restoring a highlight may take before it is given up: a dialog can block the page. */
const RESTORE_MS = 1000;

export class PlaywrightReporter {
  private context: HealingContext | null = null;

  // State for AI Reporting
  public lastActionHealed: boolean = false;
  /** The locator this step ran with instead of its own, and the proposal it left. */
  public lastHealing: StepHealing | null = null;

  constructor(private page: Page) {}

  /** Follows the test to another tab, so healing and clicks act where the steps now are. */
  setPage(page: Page) {
    this.page = page;
  }

  setContext(context: HealingContext) {
    this.context = context;
  }

  resetStepState() {
    this.lastActionHealed = false;
    this.lastHealing = null;
  }

  /** The `name` arguments are the step names callers still pass; nothing reads them here now. */
  async goto(url: string, _name?: string): Promise<void> {
    await gotoWithinPolicy(this.page, url);
  }

  async click(selector: string, _name?: string): Promise<void> {
    await this.act(selector, (sel) => this.page.click(sel));
  }

  async fill(selector: string, value: string, _name?: string): Promise<void> {
    await this.act(selector, (sel) => this.page.fill(sel, value));
  }

  async selectOption(selector: string, value: string, _name?: string): Promise<void> {
    await this.act(selector, (sel) => this.page.selectOption(sel, value));
  }

  /**
   * Runs an action on a selector, and once more on a repaired one when it fails.
   *
   * A repaired selector that works marks this action healed, for this run: the step passes and
   * the steps after it, assertions included, run as they would have. The repair is recorded as a
   * proposal (`lastHealing`) and written nowhere; a person approves it into the test, or not. No
   * repair, or one that does not work either, lets the original error through — the step fails
   * with the reason it first failed for, not with the retry's.
   */
  private async act(selector: string, action: (selector: string) => Promise<unknown>) {
    try {
      await this.highlighted(selector, action);
    } catch (e: any) {
      const repair = await this.findRepair(selector, e.message);
      if (!repair) throw e;
      try {
        await this.highlighted(repair.selector, action);
      } catch {
        throw e;
      }
      this.lastActionHealed = true;
      this.lastHealing = await this.propose(repair);
    }
  }

  /**
   * A locator to try instead: the test's own known fallbacks first, then the AI's suggestion when
   * the deployment has AI enabled. Either is used only if it is a valid locator that matches
   * exactly one element now — never on how sure the model says it is.
   */
  private async findRepair(
    failed: string,
    error: string,
  ): Promise<{ selector: string; origin: HealingOrigin } | null> {
    for (const candidate of knownFallbacks(this.context?.element, failed))
      if (await this.matchesOne(candidate)) return { selector: candidate, origin: 'fallback' };
    const suggested = await this.askModel(failed, error);
    if (suggested && suggested !== failed && (await this.matchesOne(suggested)))
      return { selector: suggested, origin: 'ai' };
    return null;
  }

  private async matchesOne(selector: string): Promise<boolean> {
    if (!storableSelector(selector)) return false;
    try {
      return (await this.page.locator(selector).count()) === 1;
    } catch {
      // Not a locator Playwright can parse.
      return false;
    }
  }

  /** Records the repair as a proposal; without a test to belong to (a preview), says nothing. */
  private async propose(repair: {
    selector: string;
    origin: HealingOrigin;
  }): Promise<StepHealing | null> {
    if (!this.context) return null;
    return recordHealingProposal({
      step: {
        testId: this.context.testId,
        provenance: this.context.provenance,
        elementId: this.context.elementId,
      },
      executionId: this.context.executionId ?? null,
      attempt: this.context.attempt ?? null,
      stepIndex: this.context.stepIndex ?? 0,
      selector: repair.selector,
      origin: repair.origin,
    });
  }

  /** The model's suggestion, only when AI is enabled, from the page without its form values. */
  private async askModel(originalSelector: string, error: string): Promise<string | null> {
    if (!aiService.isAvailable()) return null;
    try {
      const pageContent = domForModel(await this.page.content());
      return await aiService.healSelector(originalSelector, pageContent, error);
    } catch (e) {
      console.error('Healing failed to run', e);
      return null;
    }
  }

  /**
   * The action, with its element outlined while it runs and put back as it was afterwards.
   *
   * The outline used to stay: the step's screenshot, its visual comparison and the DOM sent for
   * healing all carried a red border the application never drew. Restored from the element's own
   * `style` attribute, so an inline style it had before survives exactly.
   */
  private async highlighted(selector: string, action: (selector: string) => Promise<unknown>) {
    const restore = await this.highlight(selector);
    try {
      await action(selector);
    } finally {
      await restore();
    }
  }

  private async highlight(selector: string): Promise<() => Promise<void>> {
    const nothing = async () => {};
    try {
      // Not waited for: the action waits for its element, and a highlight is not worth a timeout.
      const handle = await this.page.$(selector);
      if (!handle) return nothing;
      const previous = await handle.evaluate((el) => {
        const style = el.getAttribute('style');
        el.style.border = '2px solid red';
        el.style.backgroundColor = 'rgba(255,0,0,0.1)';
        return style;
      });
      return async () => {
        const restoring = handle
          .evaluate((el, style: string | null) => {
            if (style === null) el.removeAttribute('style');
            else el.setAttribute('style', style);
          }, previous)
          .catch(() => {})
          .finally(() => handle.dispose().catch(() => {}));
        // Gone with a navigation, or behind a dialog: nothing left to restore, or nothing to wait for.
        await Promise.race([
          restoring,
          new Promise((resolve) => setTimeout(resolve, RESTORE_MS).unref()),
        ]);
      };
    } catch {
      // Ignore highlighting errors
      return nothing;
    }
  }

  getPage(): Page {
    return this.page;
  }
}
