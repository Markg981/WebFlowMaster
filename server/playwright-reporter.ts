import { Page } from 'playwright';
import { reportingService } from './reporting-service';
import { aiService } from './ai-automation-service';
import { recordHealedSelector } from './step-elements';

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
  public lastActionRca: string | undefined;

  constructor(private page: Page) {}

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
      const recorded = await recordHealedSelector(this.currentElementId, healedSelector).catch(() => false);
      if (recorded) return;
      // Fall through: an element that could not be written is no reason to lose the repair.
    }
    if (this.currentTestId !== undefined && this.currentStepIndex !== undefined) {
      await aiService.updateSelectorInDb(this.currentTestId, this.currentStepIndex, healedSelector);
    }
  }
  
  resetStepState() {
      this.lastActionHealed = false;
      this.lastActionRca = undefined;
  }

  async goto(url: string, name?: string): Promise<void> {
    await reportingService.step(name || `Navigate to ${url}`, async () => {
      try {
        await this.page.goto(url);
      } catch (e: any) {
        await this.handleFailure(e, "Navigation Failed");
        throw e;
      }
    });
  }

  async click(selector: string, name?: string): Promise<void> {
    await reportingService.step(name || `Click on ${selector}`, async () => {
      try {
        await this.highlight(selector);
        await this.page.click(selector);
      } catch (e: any) {
        // Attempt Self-Healing
        const healedSelector = await this.attemptHeal(selector, e.message);
        if (healedSelector) {
           try {
               await reportingService.step(`[Self-Healing] Retrying with ${healedSelector}`, async () => {
                   await this.highlight(healedSelector);
                   await this.page.click(healedSelector);
               });
                // If success, update DB and set state
                await this.persistHealedSelector(healedSelector);
                this.lastActionHealed = true;
                return; // Success
           } catch (retryError) {
               // Fall through to failure
           }
        }
        await this.handleFailure(e, "Click Failed");
        throw e;
      }
    });
  }

  async fill(selector: string, value: string, name?: string): Promise<void> {
    await reportingService.step(name || `Fill ${selector} with "${value}"`, async () => {
      try {
        await this.highlight(selector);
        await this.page.fill(selector, value);
      } catch (e: any) {
         const healedSelector = await this.attemptHeal(selector, e.message);
         if (healedSelector) {
            try {
                await reportingService.step(`[Self-Healing] Retrying with ${healedSelector}`, async () => {
                    await this.highlight(healedSelector);
                    await this.page.fill(healedSelector, value);
                });
                await this.persistHealedSelector(healedSelector);
                this.lastActionHealed = true;
                return;
            } catch { /* retry failed; fall through to failure handling */ }
         }
        await this.handleFailure(e, "Fill Failed");
        throw e;
      }
    });
  }

  async selectOption(selector: string, value: string, name?: string): Promise<void> {
    await reportingService.step(name || `Select "${value}" in ${selector}`, async () => {
       try {
         await this.highlight(selector);
         await this.page.selectOption(selector, value);
       } catch (e: any) {
         const healedSelector = await this.attemptHeal(selector, e.message);
         if (healedSelector) {
            try {
                await reportingService.step(`[Self-Healing] Retrying with ${healedSelector}`, async () => {
                    await this.highlight(healedSelector);
                    await this.page.selectOption(healedSelector, value);
                });
                await this.persistHealedSelector(healedSelector);
                this.lastActionHealed = true;
                return;
            } catch { /* retry failed; fall through to failure handling */ }
         }
         await this.handleFailure(e, "Select Failed");
         throw e;
       }
    });
  }

  async screenshot(name: string): Promise<void> {
    await reportingService.step(`Screenshot: ${name}`, async () => {
      await this.captureScreenshot(name);
    });
  }

  private async attemptHeal(originalSelector: string, error: string): Promise<string | null> {
      try {
          const pageContent = await this.page.content();
          return await aiService.healSelector(originalSelector, pageContent, error);
      } catch (e) {
          console.error("Healing failed to run", e);
          return null;
      }
  }

  private async handleFailure(error: any, context: string) {
      await this.captureScreenshot(`${context} - Error`);
      
      // RCA
      try {
          // Collecting simple logs (mocking network for now as getting CDP logs is complex here without setup)
          // In real implementation, we'd attach a network listener at setup.
          const analysis = await aiService.analyzeFailure(
              error.message, 
              error.stack || "No stack", 
              ["(Network logs not implemented in this wrapper yet)"]
          );
          
          await reportingService.step(`[AI Analysis] Root Cause`, async () => {
               // We would ideally attach this as a text file or description
               console.log("AI RCA:", analysis);
          });
      } catch (e) {
          console.error("RCA Failed", e);
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

  private async captureScreenshot(name: string) {
    try {
        const buffer = await this.page.screenshot();
        await reportingService.attachScreenshot(name, buffer);
    } catch (e) { console.error("Snapshot failed"); }
  }
  
  getPage(): Page {
    return this.page;
  }
}
