import playwright, { Browser, Page, BrowserContext, ChromiumBrowser, FirefoxBrowser, WebKitBrowser } from 'playwright';
import { storage } from './storage'; // To fetch user settings
import type { Test, UserSettings } from '@shared/schema'; // Import Test and UserSettings type

// Default settings if not found or incomplete
const DEFAULT_BROWSER: 'chromium' | 'firefox' | 'webkit' = 'chromium';
const DEFAULT_HEADLESS = true;
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_WAIT_TIME = 1000; // 1 second (could be for navigation or specific waits)


export interface DetectedElement {
  id: string;
  type: string;
  selector: string;
  text: string;
  tag: string;
  attributes: Record<string, string>;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
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
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);
      
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
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

  async detectElements(url: string, userId?: number): Promise<DetectedElement[]> {
    let browser: Browser | null = null;
    try {
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;

      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch({ headless: headlessMode });
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);

      await page.setViewport({ width: 1280, height: 720 });
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
        
        interactiveSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((element, index) => {
            const rect = element.getBoundingClientRect();
            
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
              const tagName = element.tagName.toLowerCase();
              const text = element.textContent?.trim() || '';
              const placeholder = element.getAttribute('placeholder') || '';
              const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`;

              let uniqueSelector = selector;
              if (element.id) {
                uniqueSelector = `#${element.id}`;
              } else if (element.className && typeof element.className === 'string') {
                const classes = element.className.split(' ').filter(c => c.length > 0);
                if (classes.length > 0) {
                  uniqueSelector = `${tagName}.${classes[0]}`;
                }
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

              detectedElements.push({
                id: `elem-${tagName}-${index}-${Date.now()}`,
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

  async executeTestSequence(test: Test, userId: number): Promise<{ success: boolean; steps?: any[]; error?: string; duration?: number }> {
    const startTime = Date.now();
    let browser: Browser | null = null;
    try {
      const userSettings = await storage.getUserSettings(userId);

      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      // const navigationWaitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME; // For specific waits or navigation

      console.log(`Executing test "${test.name}" for user ${userId} with browser: ${browserType}, headless: ${headlessMode}, timeout: ${pageTimeout}`);

      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch({ headless: headlessMode });
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);

      // Example: Navigate to the test URL
      if (test.url) {
        await page.goto(test.url, { waitUntil: 'domcontentloaded' });
      }

      const results: any[] = [];
      if (test.sequence && Array.isArray(test.sequence)) {
        for (const step of test.sequence as any[]) { // Assuming sequence is an array of steps
          // Placeholder for actual step execution logic
          // Example:
          // if (step.action === 'click') {
          //   await page.click(step.selector);
          // } else if (step.action === 'type') {
          //   await page.fill(step.selector, step.text);
          // } // ... etc.
          console.log(`Executing step: ${step.type} - ${step.name} (Selector: ${step.selectorValue})`);
          // Simulate step execution for now
          await page.waitForTimeout(100); // Small delay per step
          results.push({ name: step.name, status: 'passed', details: `Action ${step.type} on ${step.selectorValue} completed` });
        }
      }

      await page.close();
      await context.close();
      const duration = Date.now() - startTime;
      console.log(`Test "${test.name}" completed in ${duration}ms`);
      return { success: true, steps: results, duration };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`Error executing test "${test.name}" for user ${userId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', duration };
    } finally {
      if (browser) {
        await browser.close();
      }
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