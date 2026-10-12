import { Page } from 'playwright';
import { aiService } from '../authoring/ai-automation-service';
import { recordHealedSelector } from '../authoring/step-elements';

/**
 * Drives a page on behalf of a step, with AI self-healing of the selector when the step fails.
 *
 * Its name is from a time it also reported: every action was wrapped in a "step" of a reporting
 * service, and a failure attached a screenshot to it. That service was a stub — the step ran its
 * body and the screenshot went nowhere — so the wrapping is gone. Evidence is the runner's
 * (server/web/playwright-service.ts takes the error screenshots) and the Allure report is built from
 * the stored run (server/reporting/allure-export.ts).
 */
export class PlaywrightReporter {
  // Context for DB updates
  private currentTestId?: number;
  private currentStepIndex?: number;
  /**
   * The repository element this step points at, when it points at one.
   *
   * Healing a step used to rewrite the selector inside this one test's saved sequence, so the
   * same moved button was repaired separately by every test that touched it — each after
   * failing once. When the step names a shared element, the repair goes there instead, and
   * every test that names it is fixed before it runs.
   */
  private currentElementId?: string | null;

  // State for AI Reporting
  public lastActionHealed: boolean = false;

  constructor(private page: Page) {}

  /** Follows the test to another tab, so healing and clicks act where the steps now are. */
  setPage(page: Page) {
    this.page = page;
  }

  setContext(testId: number, stepIndex: number, elementId?: string | null) {
    this.currentTestId = testId;
    this.currentStepIndex = stepIndex;
    this.currentElementId = elementId ?? null;
  }

  /**
   * Writes a repaired selector where the tests that use it will read it.
   *
   * The repository when the step names one — a single row, read by every test that names it —
   * and this test's own sequence otherwise, which is what healing has always done.
   */
  private async persistHealedSelector(healedSelector: string): Promise<void> {
    if (this.currentElementId) {
      const recorded = await recordHealedSelector(this.currentElementId, healedSelector).catch(
        () => false,
      );
      if (recorded) return;
      // Fall through: an element that could not be written is no reason to lose the repair.
    }
    if (this.currentTestId !== undefined && this.currentStepIndex !== undefined) {
      await aiService.updateSelectorInDb(this.currentTestId, this.currentStepIndex, healedSelector);
    }
  }

  resetStepState() {
    this.lastActionHealed = false;
  }

  /** The `name` arguments are the step names callers still pass; nothing reads them here now. */
  async goto(url: string, _name?: string): Promise<void> {
    await this.page.goto(url);
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
   * Runs an action on a selector, and once more on a healed one when it fails.
   *
   * A repaired selector that works is written where the tests will read it and marks this
   * action healed; one that does not, or none at all, lets the original error through — the
   * step fails with the reason it first failed for, not with the retry's.
   */
  private async act(selector: string, action: (selector: string) => Promise<unknown>) {
    try {
      await this.highlight(selector);
      await action(selector);
    } catch (e: any) {
      const healedSelector = await this.attemptHeal(selector, e.message);
      if (healedSelector) {
        try {
          await this.highlight(healedSelector);
          await action(healedSelector);
          await this.persistHealedSelector(healedSelector);
        } catch {
          throw e;
        }
        this.lastActionHealed = true;
        return;
      }
      throw e;
    }
  }

  private async attemptHeal(originalSelector: string, error: string): Promise<string | null> {
    try {
      const pageContent = await this.page.content();
      return await aiService.healSelector(originalSelector, pageContent, error);
    } catch (e) {
      console.error('Healing failed to run', e);
      return null;
    }
  }

  private async highlight(selector: string) {
    try {
      const locator = this.page.locator(selector).first();
      await locator.evaluate((el: any) => {
        el.style.border = '2px solid red';
        el.style.backgroundColor = 'rgba(255,0,0,0.1)';
      });
    } catch (e) {
      // Ignore highlighting errors
    }
  }

  getPage(): Page {
    return this.page;
  }
}
