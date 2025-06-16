import playwright, { Browser, Page, BrowserContext, ChromiumBrowser, FirefoxBrowser, WebKitBrowser } from 'playwright';
import { storage } from './storage'; // To fetch user settings
import type { Test, UserSettings } from '@shared/schema'; // Import Test and UserSettings type

// Default settings if not found or incomplete
const DEFAULT_BROWSER: 'chromium' | 'firefox' | 'webkit' = 'chromium';
const DEFAULT_HEADLESS = true;
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_WAIT_TIME = 1000; // 1 second (could be for navigation or specific waits)

// Define interfaces for TestStep and StepResult based on the requirements
interface TestAction {
  id: string;
  type: string;
  name: string;
  icon: string;
  description: string;
}

// Helper function to parse assertElementCount value
function parseAssertionValue(value: string): { operator: string; count: number } | null {
  const match = value.match(/^(==|>=|<=|>|<|!=)?\s*(\d+)$/);
  if (!match) {
    // Try to parse just a number, defaulting to '=='
    const singleNumberMatch = value.match(/^\s*(\d+)\s*$/);
    if (singleNumberMatch) {
      return { operator: '==', count: parseInt(singleNumberMatch[1], 10) };
    }
    return null;
  }
  const operator = match[1] || '=='; // Default to '==' if only number is present
  const count = parseInt(match[2], 10);
  return { operator, count };
}

export interface DetectedElement { // Exporting if it's used elsewhere, or keep private
  id: string;
  type: string;
  selector: string;
  text: string;
  tag: string;
  attributes: Record<string, string>;
  boundingBox?: { // Optional as per original description
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface TestStep {
  id: string;
  action: TestAction;
  targetElement?: DetectedElement;
  value?: string;
}

interface StepResult {
  name: string;
  type: string;
  selector?: string;
  value?: string;
  status: 'passed' | 'failed';
  screenshot?: string;
  error?: string;
  details: string;
}

// Interface for the ad-hoc sequence payload
interface AdhocSequencePayload {
  url: string;
  sequence: TestStep[];
  elements: DetectedElement[]; // Currently for context, not actively used in loop logic by default
  name?: string;
}


export class PlaywrightService {
  // Removing shared browser instance to allow per-execution settings
  // private browser: Browser | null = null;
  // private context: BrowserContext | null = null;

  // initialize and close methods might need to be re-evaluated if a shared browser is ever re-introduced.
  // For now, each major function will manage its own browser lifecycle.

  async loadWebsite(url: string, userId?: number): Promise<{ success: boolean; screenshot?: string; html?: string; error?: string }> {
    let browser: Browser | null = null;
    try {
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;

      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch({ headless: headlessMode });
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'; // Standardized UA
      const context = await browser.newContext({ userAgent });
      const page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);
      
      await page.setViewportSize({ width: 1280, height: 720 });
      // Removed page.setUserAgent, as it's set on context
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        // timeout is already set by setDefaultTimeout
      });

      await page.waitForTimeout(userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME); // Use specific wait time here

      const html = await page.content();
      const screenshotBuffer = await page.screenshot({
        type: 'png',
        fullPage: false
      });

      await page.close();
      await context.close();

      return {
        success: true,
        screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
        html
      };
    } catch (error) {
      console.error('Error loading website:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async executeAdhocSequence(payload: AdhocSequencePayload, userId: number): Promise<{ success: boolean; steps?: StepResult[]; error?: string; duration?: number; detectedElements?: DetectedElement[] }> {
    const startTime = Date.now();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    const stepResults: StepResult[] = [];
    let overallSuccess = true;
    const testName = payload.name || "Ad-hoc Test"; // Use provided name or a default

    try {
      // User settings are still relevant for browser configuration
      const userSettings = await storage.getUserSettings(userId);
      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;

      console.log(`Executing ad-hoc test "${testName}" for user ${userId} with browser: ${browserType}, headless: ${headlessMode}, timeout: ${pageTimeout}`);

      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch({ headless: headlessMode });
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      context = await browser.newContext({ userAgent });
      page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);
      await page.setViewportSize({ width: 1280, height: 720 });

      if (payload.url) {
        try {
          await page.goto(payload.url, { waitUntil: 'domcontentloaded' });
          const screenshotBuffer = await page.screenshot({ type: 'png' });
          const screenshot = screenshotBuffer.toString('base64');
          stepResults.push({
            name: 'Load Page',
            type: 'navigation',
            status: 'passed',
            screenshot: `data:image/png;base64,${screenshot}`,
            details: `Successfully navigated to ${payload.url}`,
          });
        } catch (e: any) {
          overallSuccess = false;
          const errorScreenshotBuffer = await page?.screenshot({ type: 'png' }).catch(() => null);
          const errorScreenshot = errorScreenshotBuffer?.toString('base64');
          stepResults.push({
            name: 'Load Page',
            type: 'navigation',
            status: 'failed',
            error: e.message,
            screenshot: errorScreenshot ? `data:image/png;base64,${errorScreenshot}` : undefined,
            details: `Failed to navigate to ${payload.url}`,
          });
          const duration = Date.now() - startTime;
          // Element detection even on navigation failure, if page exists
          let finalDetectedElementsNavFail: DetectedElement[] = [];
          if (page) {
            try {
              finalDetectedElementsNavFail = await page.evaluate(() => {
                const interactiveSelectors = [
                  'input:not([type="hidden"])', 'button', 'a[href]', 'select',
                  'textarea', '[onclick]', '[role="button"]', '[tabindex]:not([tabindex="-1"])',
                  'h1, h2, h3, h4, h5, h6', 'img[alt]', 'form',
                  '[data-testid]', '[data-test]'
                ];
                const detectedElementsEval: any[] = [];
                let globalElementCounter = 0;
                interactiveSelectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach((element, index) => {
                        const rect = element.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
                            const tagName = element.tagName.toLowerCase();
                            const text = element.textContent?.trim() || '';
                            const placeholder = element.getAttribute('placeholder') || '';
                            const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`;
                            let uniqueSelector = selector;
                            if (element.id) { uniqueSelector = `#${element.id}`; }
                            else if (element.className && typeof element.className === 'string') {
                              const classes = element.className.split(' ').filter(c => c.length > 0 && !c.includes(':') && !c.includes('(') && !c.includes(')') );
                              if (classes.length > 0) uniqueSelector = `${tagName}.${classes[0]}`;
                            }

                            let elementType = 'element';
                            if (tagName === 'input') elementType = element.getAttribute('type') || 'input';
                            else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button';
                            else if (tagName === 'a') elementType = 'link';
                            else if (tagName.match(/h[1-6]/)) elementType = 'heading';
                            else if (tagName === 'select') elementType = 'select';
                            else if (tagName === 'textarea') elementType = 'textarea';

                            const attributes: Record<string, string> = {};
                            Array.from(element.attributes).forEach(attr => {
                                attributes[attr.name] = attr.value;
                            });

                            detectedElementsEval.push({
                                id: `elem-${tagName}-${globalElementCounter++}`,
                                type: elementType,
                                selector: uniqueSelector,
                                text: displayText.substring(0, 100),
                                tag: tagName,
                                attributes,
                                boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
                            });
                        }
                    });
                });
                return detectedElementsEval.slice(0, 50);
              });
            } catch (detectionError) {
              console.error('Error detecting elements within executeAdhocSequence (navigation fail):', detectionError);
            }
          }
          return { success: false, steps: stepResults, error: e.message, duration, detectedElements: finalDetectedElementsNavFail };
        }
      } else {
        stepResults.push({
          name: 'Initial State',
          type: 'setup',
          status: 'passed',
          details: 'No initial URL provided for ad-hoc sequence.',
        });
      }

      if (overallSuccess && payload.sequence && Array.isArray(payload.sequence)) {
        for (const step of payload.sequence) { // No need to cast if payload.sequence is already TestStep[]
          let stepStatus: 'passed' | 'failed' = 'passed';
          let stepError: string | undefined;
          let stepScreenshot: string | undefined;
          const actionId = step.action?.id; // Changed from actionType to actionId
          const actionName = step.action?.name || 'Unnamed Action';

          try {
            if (!actionId) throw new Error('Step action ID is missing.'); // Changed message
            if (!page) throw new Error('Page is not available.');

            console.log(`Executing ad-hoc step: ${actionName} (ID: ${actionId})`); // Changed log

            switch (actionId) { // Changed from actionType to actionId
              case 'click':
                if (!step.targetElement?.selector) throw new Error('Selector missing for click action.');
                await page.click(step.targetElement.selector);
                break;
              case 'input':
                if (!step.targetElement?.selector) throw new Error('Selector missing for input action.');
                if (typeof step.value !== 'string') throw new Error('Value missing for input action.');
                await page.fill(step.targetElement.selector, step.value);
                break;
              case 'wait':
                if (typeof step.value !== 'string' || isNaN(parseInt(step.value))) throw new Error('Invalid or missing value for wait action.');
                await page.waitForTimeout(parseInt(step.value));
                break;
              case 'scroll':
                if (step.targetElement?.selector) {
                  await page.locator(step.targetElement.selector).scrollIntoViewIfNeeded();
                } else {
                  await page.evaluate(() => window.scrollBy(0, 200));
                }
                break;
              case 'assert': // This is the generic assert, may need specific handling or be deprecated
                console.warn(`Generic 'assert' action encountered. Consider using specific assertions.`);
                // For now, let's assume it needs a target and passes if element exists
                if (!step.targetElement?.selector) {
                  stepStatus = 'failed';
                  stepError = 'Selector missing for generic assert action.';
                } else {
                  const elementToAssert = await page.locator(step.targetElement.selector).count();
                  if (elementToAssert === 0) {
                    stepStatus = 'failed';
                    stepError = `Assertion Failed: Element "${step.targetElement.selector}" not found.`;
                  }
                }
                break;
              case 'assertTextContains':
                if (!step.targetElement?.selector) {
                  stepStatus = 'failed';
                  stepError = "Selector missing for assertTextContains action.";
                  break;
                }
                if (typeof step.value !== 'string' || step.value.trim() === '') {
                  stepStatus = 'failed';
                  stepError = "Expected text (value) missing or empty for assertTextContains action.";
                  break;
                }
                const elementForText = page.locator(step.targetElement.selector);
                const actualText = await elementForText.textContent();
                if (actualText === null || !actualText.includes(step.value)) {
                  stepStatus = 'failed';
                  stepError = `Assertion Failed: Element "${step.targetElement.selector}" did not contain text "${step.value}". Actual: "${actualText === null ? 'null' : actualText}".`;
                }
                break;
              case 'assertElementCount':
                if (!step.targetElement?.selector) {
                  stepStatus = 'failed';
                  stepError = "Selector missing for assertElementCount action.";
                  break;
                }
                if (typeof step.value !== 'string' || step.value.trim() === '') {
                  stepStatus = 'failed';
                  stepError = "Expected count (value) missing or empty for assertElementCount action.";
                  break;
                }
                const parsedAssertion = parseAssertionValue(step.value);
                if (!parsedAssertion) {
                  stepStatus = 'failed';
                  stepError = `Invalid format for assertElementCount value: "${step.value}". Expected format like "==5", ">=2", or "3".`;
                  break;
                }
                const elementsToCount = page.locator(step.targetElement.selector);
                const actualCount = await elementsToCount.count();
                let countMatch = false;
                switch (parsedAssertion.operator) {
                  case '==': countMatch = actualCount === parsedAssertion.count; break;
                  case '>=': countMatch = actualCount >= parsedAssertion.count; break;
                  case '<=': countMatch = actualCount <= parsedAssertion.count; break;
                  case '>': countMatch = actualCount > parsedAssertion.count; break;
                  case '<': countMatch = actualCount < parsedAssertion.count; break;
                  case '!=': countMatch = actualCount !== parsedAssertion.count; break;
                  default: // Should not happen due to parsing
                    stepStatus = 'failed';
                    stepError = `Unknown operator "${parsedAssertion.operator}" for assertElementCount.`;
                    break;
                }
                if (!countMatch && stepStatus === 'passed') { // ensure stepStatus hasn't been set to failed by operator check
                  stepStatus = 'failed';
                  stepError = `Assertion Failed: Element count for selector "${step.targetElement.selector}" did not match. Expected ${parsedAssertion.operator} ${parsedAssertion.count}, Actual: ${actualCount}.`;
                }
                break;
              case 'hover':
                if (!step.targetElement?.selector) throw new Error('Selector missing for hover action.');
                await page.hover(step.targetElement.selector);
                break;
              case 'select': // Basic select by value, if the target is a <select> element
                if (!step.targetElement?.selector) {
                     stepStatus = 'failed';
                     stepError = "Selector missing for select action.";
                     break;
                }
                if (typeof step.value !== 'string' || step.value.trim() === '') {
                    stepStatus = 'failed';
                    stepError = "Value missing for select action (expected option value).";
                    break;
                }
                await page.selectOption(step.targetElement.selector, step.value);
                break;
              default:
                throw new Error(`Unsupported action ID: ${actionId}`); // Changed message
            }

            const screenshotBuffer = await page.screenshot({ type: 'png' });
            stepScreenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;

          } catch (e: any) {
            stepStatus = 'failed';
            stepError = e.message;
            overallSuccess = false; // Ensure overallSuccess is set on failure
            console.error(`Error in ad-hoc step "${actionName}": ${e.message}`);
            if (page) {
              try {
                const errorScreenshotBuffer = await page.screenshot({ type: 'png' });
                stepScreenshot = `data:image/png;base64,${errorScreenshotBuffer.toString('base64')}`;
              } catch (screenError: any) {
                console.error('Failed to take screenshot on error during ad-hoc execution:', screenError.message);
              }
            }
          }
          // If an assertion failed, overallSuccess should be false.
          if (stepStatus === 'failed') {
            overallSuccess = false;
          }

          stepResults.push({
            name: actionName,
            type: actionId || 'unknown', // Changed from actionType
            selector: step.targetElement?.selector,
            value: step.value,
            status: stepStatus,
            screenshot: stepScreenshot,
            error: stepError,
            details: stepStatus === 'passed' ? 'Action executed successfully.' : `Action failed: ${stepError}`,
          });

          if (!overallSuccess) break;
        }
      }

      const duration = Date.now() - startTime;
      console.log(`Ad-hoc test "${testName}" completed. Success: ${overallSuccess}, Duration: ${duration}ms`);

      let finalDetectedElements: DetectedElement[] = [];
      if (page) {
          try {
              finalDetectedElements = await page.evaluate(() => {
                  const interactiveSelectors = [
                    'input:not([type="hidden"])', 'button', 'a[href]', 'select',
                    'textarea', '[onclick]', '[role="button"]', '[tabindex]:not([tabindex="-1"])',
                    'h1, h2, h3, h4, h5, h6', 'img[alt]', 'form',
                    '[data-testid]', '[data-test]'
                  ];
                  const detectedElementsEval: any[] = [];
                  let globalElementCounter = 0;
                  interactiveSelectors.forEach(selector => {
                      document.querySelectorAll(selector).forEach((element, index) => {
                          const rect = element.getBoundingClientRect();
                          if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
                              const tagName = element.tagName.toLowerCase();
                              const text = element.textContent?.trim() || '';
                              const placeholder = element.getAttribute('placeholder') || '';
                              const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`;
                              let uniqueSelector = selector;
                              if (element.id) { uniqueSelector = `#${element.id}`; }
                              else if (element.className && typeof element.className === 'string') {
                                const classes = element.className.split(' ').filter(c => c.length > 0 && !c.includes(':') && !c.includes('(') && !c.includes(')') );
                                if (classes.length > 0) uniqueSelector = `${tagName}.${classes[0]}`;
                              }

                              let elementType = 'element';
                              if (tagName === 'input') elementType = element.getAttribute('type') || 'input';
                              else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button';
                              else if (tagName === 'a') elementType = 'link';
                              else if (tagName.match(/h[1-6]/)) elementType = 'heading';
                              else if (tagName === 'select') elementType = 'select';
                              else if (tagName === 'textarea') elementType = 'textarea';

                              const attributes: Record<string, string> = {};
                              Array.from(element.attributes).forEach(attr => {
                                  attributes[attr.name] = attr.value;
                              });

                              detectedElementsEval.push({
                                  id: `elem-${tagName}-${globalElementCounter++}`,
                                  type: elementType,
                                  selector: uniqueSelector,
                                  text: displayText.substring(0, 100),
                                  tag: tagName,
                                  attributes,
                                  boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
                              });
                          }
                      });
                  });
                  return detectedElementsEval.slice(0, 50);
              });
          } catch (detectionError) {
              console.error('Error detecting elements within executeAdhocSequence (try block):', detectionError);
          }
      }
      return { success: overallSuccess, steps: stepResults, duration, detectedElements: finalDetectedElements };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`Critical error executing ad-hoc test "${testName}" for user ${userId}:`, error);
      // Attempt to capture elements even in critical error, if page object exists
      let finalDetectedElementsCriticalError: DetectedElement[] = [];
      if (page) {
        try {
          finalDetectedElementsCriticalError = await page.evaluate(() => {
            const interactiveSelectors = [
              'input:not([type="hidden"])', 'button', 'a[href]', 'select',
              'textarea', '[onclick]', '[role="button"]', '[tabindex]:not([tabindex="-1"])',
              'h1, h2, h3, h4, h5, h6', 'img[alt]', 'form',
              '[data-testid]', '[data-test]'
            ];
            const detectedElementsEval: any[] = [];
            let globalElementCounter = 0;
            interactiveSelectors.forEach(selector => {
                document.querySelectorAll(selector).forEach((element, index) => {
                    const rect = element.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
                        const tagName = element.tagName.toLowerCase();
                        const text = element.textContent?.trim() || '';
                        const placeholder = element.getAttribute('placeholder') || '';
                        const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`;
                        let uniqueSelector = selector;
                        if (element.id) { uniqueSelector = `#${element.id}`; }
                        else if (element.className && typeof element.className === 'string') {
                          const classes = element.className.split(' ').filter(c => c.length > 0 && !c.includes(':') && !c.includes('(') && !c.includes(')') );
                          if (classes.length > 0) uniqueSelector = `${tagName}.${classes[0]}`;
                        }

                        let elementType = 'element';
                        if (tagName === 'input') elementType = element.getAttribute('type') || 'input';
                        else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button';
                        else if (tagName === 'a') elementType = 'link';
                        else if (tagName.match(/h[1-6]/)) elementType = 'heading';
                        else if (tagName === 'select') elementType = 'select';
                        else if (tagName === 'textarea') elementType = 'textarea';

                        const attributes: Record<string, string> = {};
                        Array.from(element.attributes).forEach(attr => {
                            attributes[attr.name] = attr.value;
                        });

                        detectedElementsEval.push({
                            id: `elem-${tagName}-${globalElementCounter++}`,
                            type: elementType,
                            selector: uniqueSelector,
                            text: displayText.substring(0, 100),
                            tag: tagName,
                            attributes,
                            boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
                        });
                    }
                });
            });
            return detectedElementsEval.slice(0, 50);
          });
        } catch (detectionError) {
          console.error('Error detecting elements within executeAdhocSequence (catch block):', detectionError);
        }
      }
      return {
        success: false,
        steps: stepResults,
        error: error.message || 'Unknown critical error during ad-hoc execution',
        duration,
        detectedElements: finalDetectedElementsCriticalError
      };
    } finally {
      // Element detection should happen before page.close()
      if (page) await page.close().catch(e => console.error("Error closing page (adhoc):", e));
      if (context) await context.close().catch(e => console.error("Error closing context (adhoc):", e));
      if (browser) await browser.close().catch(e => console.error("Error closing browser (adhoc):", e));
    }
  }

  async detectElements(url: string, userId?: number): Promise<DetectedElement[]> {
    let browser: Browser | null = null;
    try {
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;

      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch({ headless: headlessMode });
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'; // Standardized UA
      const context = await browser.newContext({ userAgent });
      const page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);

      await page.setViewportSize({ width: 1280, height: 720 });
      // No page.setUserAgent was here, context now has it.
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
      });

      await page.waitForTimeout(userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME);

      const elements = await page.evaluate(() => {
        const interactiveSelectors = [
          'input:not([type="hidden"])',
          'button',
          'a[href]',
          'select',
          'textarea',
          '[onclick]',
          '[role="button"]',
          '[tabindex]:not([tabindex="-1"])',
          'h1, h2, h3, h4, h5, h6',
          'img[alt]',
          'form',
          '[data-testid]',
          '[data-test]'
        ];

        const detectedElements: any[] = [];
        let globalElementCounter = 0; // Initialize global counter
        
        interactiveSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((element, index) => { // 'index' here is local to current 'selector' results
            const rect = element.getBoundingClientRect();
            
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
              const tagName = element.tagName.toLowerCase();
              const text = element.textContent?.trim() || '';
              const placeholder = element.getAttribute('placeholder') || '';
              // Use globalElementCounter in displayText if a truly unique placeholder is needed,
              // but for now, existing logic for displayText is fine.
              const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`;

              let uniqueSelector = selector;
              // Prioritize ID, then a combination of tag and a unique class if available
              if (element.id) {
                uniqueSelector = `#${element.id}`;
              } else if (element.className && typeof element.className === 'string') {
                const classes = element.className.split(' ').filter(c => c.length > 0 && !c.includes(':') && !c.includes('(') && !c.includes(')') ); // Filter out complex/dynamic classes
                if (classes.length > 0) {
                  uniqueSelector = `${tagName}.${classes[0]}`;
                  // To make it more robust, one might try to find a more unique selector,
                  // but this is a reasonable default.
                }
              }
              // Fallback to just tag name if no better selector found, though this is very generic.
              // Or could use a more complex selector generation strategy here.

              let elementType = 'element';
              if (tagName === 'input') elementType = element.getAttribute('type') || 'input';
              else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button';
              else if (tagName === 'a') elementType = 'link';
              else if (tagName.match(/h[1-6]/)) elementType = 'heading';
              else if (tagName === 'select') elementType = 'select';
              else if (tagName === 'textarea') elementType = 'textarea';

              const attributes: Record<string, string> = {};
              Array.from(element.attributes).forEach(attr => {
                attributes[attr.name] = attr.value;
              });

              detectedElements.push({
                id: `elem-${tagName}-${globalElementCounter++}`, // Use global counter for unique ID
                type: elementType,
                selector: uniqueSelector,
                text: displayText.substring(0, 100), // Keep text substring
                tag: tagName,
                attributes,
                boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
              });
            }
          });
        });
        return detectedElements.slice(0, 50);
      });

      await page.close();
      await context.close();
      return elements;
    } catch (error) {
      console.error('Error detecting elements:', error);
      return [];
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async executeTestSequence(test: Test, userId: number): Promise<{ success: boolean; steps?: StepResult[]; error?: string; duration?: number }> {
    const startTime = Date.now();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    const stepResults: StepResult[] = [];
    let overallSuccess = true;

    try {
      const userSettings = await storage.getUserSettings(userId);
      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;

      console.log(`Executing test "${test.name}" for user ${userId} with browser: ${browserType}, headless: ${headlessMode}, timeout: ${pageTimeout}`);

      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch({ headless: headlessMode });
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      context = await browser.newContext({ userAgent });
      page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);
      await page.setViewportSize({ width: 1280, height: 720 });

      if (test.url) {
        try {
          await page.goto(test.url, { waitUntil: 'domcontentloaded' });
          const screenshotBuffer = await page.screenshot({ type: 'png' });
          const screenshot = screenshotBuffer.toString('base64');
          stepResults.push({
            name: 'Load Page',
            type: 'navigation',
            status: 'passed',
            screenshot: `data:image/png;base64,${screenshot}`,
            details: `Successfully navigated to ${test.url}`,
          });
        } catch (e: any) {
          overallSuccess = false;
          const errorScreenshotBuffer = await page?.screenshot({ type: 'png' }).catch(() => null);
          const errorScreenshot = errorScreenshotBuffer?.toString('base64');
          stepResults.push({
            name: 'Load Page',
            type: 'navigation',
            status: 'failed',
            error: e.message,
            screenshot: errorScreenshot ? `data:image/png;base64,${errorScreenshot}` : undefined,
            details: `Failed to navigate to ${test.url}`,
          });
          // Stop execution if navigation fails
          const duration = Date.now() - startTime;
          return { success: false, steps: stepResults, error: e.message, duration };
        }
      } else {
        // No URL provided, add a neutral initial step
        stepResults.push({
          name: 'Initial State',
          type: 'setup',
          status: 'passed',
          details: 'No initial URL provided.',
          // Optionally take a screenshot of the blank page if desired
          // const screenshotBuffer = await page.screenshot({ type: 'png' });
          // screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
        });
      }

      if (overallSuccess && test.sequence && Array.isArray(test.sequence)) {
        for (const step of test.sequence as TestStep[]) {
          let stepStatus: 'passed' | 'failed' = 'passed';
          let stepError: string | undefined;
          let stepScreenshot: string | undefined;
          const actionId = step.action?.id; // Changed from actionType to actionId
          const actionName = step.action?.name || 'Unnamed Action';

          try {
            if (!actionId) { // Changed from actionType
              throw new Error('Step action ID is missing.'); // Changed message
            }
            if (!page) { // Should not happen if navigation succeeded or no URL
                throw new Error('Page is not available.');
            }

            console.log(`Executing step: ${actionName} (ID: ${actionId})`); // Changed log

            switch (actionId) { // Changed from actionType to actionId
              case 'click':
                if (!step.targetElement?.selector) throw new Error('Selector missing for click action.');
                await page.click(step.targetElement.selector);
                break;
              case 'input':
                if (!step.targetElement?.selector) throw new Error('Selector missing for input action.');
                if (typeof step.value !== 'string') throw new Error('Value missing for input action.');
                await page.fill(step.targetElement.selector, step.value);
                break;
              case 'wait':
                if (typeof step.value !== 'string' || isNaN(parseInt(step.value))) throw new Error('Invalid or missing value for wait action.');
                await page.waitForTimeout(parseInt(step.value));
                break;
              case 'scroll':
                if (step.targetElement?.selector) {
                  await page.locator(step.targetElement.selector).scrollIntoViewIfNeeded();
                } else {
                  await page.evaluate(() => window.scrollBy(0, 200)); // Scroll window down by 200px
                }
                break;
              case 'assert': // Generic assert, same logic as adhoc
                console.warn(`Generic 'assert' action encountered in test sequence. Consider using specific assertions.`);
                if (!step.targetElement?.selector) {
                  stepStatus = 'failed';
                  stepError = 'Selector missing for generic assert action.';
                } else {
                  const elementToAssert = await page.locator(step.targetElement.selector).count();
                  if (elementToAssert === 0) {
                    stepStatus = 'failed';
                    stepError = `Assertion Failed: Element "${step.targetElement.selector}" not found.`;
                  }
                }
                break;
              case 'assertTextContains':
                if (!step.targetElement?.selector) {
                  stepStatus = 'failed';
                  stepError = "Selector missing for assertTextContains action.";
                  break;
                }
                if (typeof step.value !== 'string' || step.value.trim() === '') {
                  stepStatus = 'failed';
                  stepError = "Expected text (value) missing or empty for assertTextContains action.";
                  break;
                }
                const elementForText = page.locator(step.targetElement.selector);
                const actualText = await elementForText.textContent();
                if (actualText === null || !actualText.includes(step.value)) {
                  stepStatus = 'failed';
                  stepError = `Assertion Failed: Element "${step.targetElement.selector}" did not contain text "${step.value}". Actual: "${actualText === null ? 'null' : actualText}".`;
                }
                break;
              case 'assertElementCount':
                if (!step.targetElement?.selector) {
                  stepStatus = 'failed';
                  stepError = "Selector missing for assertElementCount action.";
                  break;
                }
                if (typeof step.value !== 'string' || step.value.trim() === '') {
                  stepStatus = 'failed';
                  stepError = "Expected count (value) missing or empty for assertElementCount action.";
                  break;
                }
                const parsedAssertion = parseAssertionValue(step.value);
                if (!parsedAssertion) {
                  stepStatus = 'failed';
                  stepError = `Invalid format for assertElementCount value: "${step.value}". Expected format like "==5", ">=2", or "3".`;
                  break;
                }
                const elementsToCount = page.locator(step.targetElement.selector);
                const actualCount = await elementsToCount.count();
                let countMatch = false;
                switch (parsedAssertion.operator) {
                  case '==': countMatch = actualCount === parsedAssertion.count; break;
                  case '>=': countMatch = actualCount >= parsedAssertion.count; break;
                  case '<=': countMatch = actualCount <= parsedAssertion.count; break;
                  case '>': countMatch = actualCount > parsedAssertion.count; break;
                  case '<': countMatch = actualCount < parsedAssertion.count; break;
                  case '!=': countMatch = actualCount !== parsedAssertion.count; break;
                   default: // Should not happen
                    stepStatus = 'failed';
                    stepError = `Unknown operator "${parsedAssertion.operator}" for assertElementCount.`;
                    break;
                }
                 if (!countMatch && stepStatus === 'passed') {
                  stepStatus = 'failed';
                  stepError = `Assertion Failed: Element count for selector "${step.targetElement.selector}" did not match. Expected ${parsedAssertion.operator} ${parsedAssertion.count}, Actual: ${actualCount}.`;
                }
                break;
              case 'hover':
                if (!step.targetElement?.selector) throw new Error('Selector missing for hover action.');
                await page.hover(step.targetElement.selector);
                break;
              case 'select': // Basic select by value
                 if (!step.targetElement?.selector) {
                     stepStatus = 'failed';
                     stepError = "Selector missing for select action.";
                     break;
                }
                if (typeof step.value !== 'string' || step.value.trim() === '') {
                    stepStatus = 'failed';
                    stepError = "Value missing for select action (expected option value).";
                    break;
                }
                await page.selectOption(step.targetElement.selector, step.value);
                break;
              default:
                throw new Error(`Unsupported action ID: ${actionId}`); // Changed message
            }

            const screenshotBuffer = await page.screenshot({ type: 'png' });
            stepScreenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;

          } catch (e: any) {
            stepStatus = 'failed';
            stepError = e.message;
            overallSuccess = false; // Ensure overallSuccess is set
            console.error(`Error in step "${actionName}": ${e.message}`);
            if (page) {
              try {
                const errorScreenshotBuffer = await page.screenshot({ type: 'png' });
                stepScreenshot = `data:image/png;base64,${errorScreenshotBuffer.toString('base64')}`;
              } catch (screenError: any) {
                console.error('Failed to take screenshot on error:', screenError.message);
              }
            }
          }
          // If an assertion failed, overallSuccess should be false.
          if (stepStatus === 'failed') {
            overallSuccess = false;
          }

          stepResults.push({
            name: actionName,
            type: actionId || 'unknown', // Changed from actionType
            selector: step.targetElement?.selector,
            value: step.value,
            status: stepStatus,
            screenshot: stepScreenshot,
            error: stepError,
            details: stepStatus === 'passed' ? 'Action executed successfully.' : `Action failed: ${stepError}`,
          });

          if (!overallSuccess) {
            break; // Stop sequence on first failure
          }
        }
      }

      const duration = Date.now() - startTime;
      console.log(`Test "${test.name}" completed. Success: ${overallSuccess}, Duration: ${duration}ms`);
      return { success: overallSuccess, steps: stepResults, duration };

    } catch (error: any) { // Catch errors like browser launch failure
      const duration = Date.now() - startTime;
      console.error(`Critical error executing test "${test.name}" for user ${userId}:`, error);
      // Ensure even critical errors have a somewhat consistent return structure
      return {
        success: false,
        steps: stepResults, // Include any steps that might have run before critical failure
        error: error.message || 'Unknown critical error',
        duration
      };
    } finally {
      if (page) await page.close().catch(e => console.error("Error closing page:", e));
      if (context) await context.close().catch(e => console.error("Error closing context:", e));
      if (browser) await browser.close().catch(e => console.error("Error closing browser:", e));
    }
  }

  // Removed shared browser instance, so global close might not be needed or needs rethink
  // async close() {
  // No shared browser or context to close here anymore.
  // }
}

export const playwrightService = new PlaywrightService();

// Cleanup on process exit - this might not be effective for browsers launched per-function
// Consider if this is still needed or how to manage orphaned browser processes if any.
// process.on('SIGINT', () => playwrightService.close());
// process.on('SIGTERM', () => playwrightService.close());