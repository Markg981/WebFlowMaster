import playwright, { Browser, Page, BrowserContext, ChromiumBrowser, FirefoxBrowser, WebKitBrowser } from 'playwright';
import { v4 as uuidv4 } from 'uuid'; // For generating session IDs
import loggerPromise from './logger';
import type { Logger as WinstonLogger } from 'winston';
import { storage } from './storage'; // To fetch user settings
import type { Test, UserSettings } from '@shared/schema'; // Import Test and UserSettings type

// Default settings if not found or incomplete
const DEFAULT_BROWSER: 'chromium' | 'firefox' | 'webkit' = 'chromium';
const DEFAULT_HEADLESS = true;
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_WAIT_TIME = 1000; // 1 second (could be for navigation or specific waits)

let resolvedLogger: WinstonLogger;
(async () => {
  try {
    resolvedLogger = await loggerPromise;
    if (resolvedLogger && typeof resolvedLogger.info === 'function') {
      resolvedLogger.info("PlaywrightService: Winston logger initialized successfully.");
    } else {
      // This case implies loggerPromise resolved to something unexpected or the instance is malformed
      console.error("PlaywrightService: Logger resolved but is not a valid Winston instance. Falling back to console.");
      resolvedLogger = console as any; // Cast to any to satisfy WinstonLogger type for basic console methods
    }
  } catch (error) {
    console.error("PlaywrightService: Failed to initialize Winston logger. Falling back to console.", error);
    // Fallback to a console-based logger if promise rejects
    resolvedLogger = console as any;
  }
})();

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

// Interface for recorded actions
export interface RecordedAction { // Exporting to be potentially used by routes.ts if strict typing is desired there
  type: 'click' | 'input' | 'select' | 'navigate' | 'keypress' | 'assertion'; // Added keypress, assertion
  selector?: string; // Optional for actions like navigate or generic assertions
  value?: string;
  timestamp: number;
  url?: string; // URL at the time of action
  key?: string; // For keypress events
  targetTag?: string; // HTML tag of the target element (e.g., 'input', 'button')
  targetId?: string; // ID of the target element
  targetClass?: string; // Classes of the target element
  targetText?: string; // Inner text or value of the element, truncated
  assertType?: string; // e.g., 'containsText', 'elementCount'
  assertValue?: string; // e.g., the text to contain, or '==5'
}

interface ActiveSession {
  page: Page;
  browser: Browser;
  context: BrowserContext;
  actions: RecordedAction[];
  userId?: number; // Store the user ID associated with the session
  targetUrl: string; // The initial URL the recording started on
}

const RECORDER_SCRIPT = `
(function() {
  if (window.hasInjectedWebTestRecorderScript) {
    console.log('WebTest Recorder script already injected. Skipping.');
    return;
  }
  window.hasInjectedWebTestRecorderScript = true;
  console.log('Injecting WebTest Recorder Script...');

  function generateSelector(el) {
    try {
      if (!el || !(el instanceof Element)) {
        return null; // Not a valid element
      }

      // 1. ID
      if (el.id) {
        // Check if ID is unique enough. Some frameworks generate dynamic IDs.
        // A simple check: if document.querySelectorAll for this ID returns only this element.
        if (document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
          return '#' + CSS.escape(el.id);
        }
      }

      // 2. Data-testid or data-test
      const testId = el.getAttribute('data-testid');
      if (testId) {
        return \`[data-testid="\${testId}"]\`;
      }
      const testAttr = el.getAttribute('data-test');
      if (testAttr) {
        return \`[data-test="\${testAttr}"]\`;
      }

      // 3. Name attribute (common for form elements)
      const nameAttr = el.getAttribute('name');
      if (nameAttr) {
         // Check if unique enough with tag and name
        const tagName = el.tagName.toLowerCase();
        if (document.querySelectorAll(\`\${tagName}[name="\${nameAttr}"]\`).length === 1) {
           return \`\${tagName}[name="\${nameAttr}"]\`;
        }
      }

      // 4. Tag + Class combination (simplified)
      //    Avoid overly generic tags like div/span without specific classes.
      //    Focus on more interactive tags or those with distinctive classes.
      const tagName = el.tagName.toLowerCase();
      let classSelector = '';
      if (el.classList && el.classList.length > 0) {
        // Filter out common, non-descriptive, or dynamically generated classes if possible
        const significantClasses = Array.from(el.classList)
          .filter(cls => cls && !cls.startsWith('ng-') && !cls.includes(':') && !cls.includes('(') && !cls.includes('active')); // Basic filtering
        if (significantClasses.length > 0) {
          classSelector = '.' + significantClasses.join('.');
        }
      }

      if (classSelector && !['div', 'span', 'p', 'li'].includes(tagName) ) { // Avoid for very generic tags unless classes are very specific
         const combinedSelector = tagName + classSelector;
         if (document.querySelectorAll(combinedSelector).length === 1) {
            return combinedSelector;
         }
      }

      // Fallback: A more robust XPath-like or unique attribute selector would be better here.
      // For this version, we'll keep it simple. If no good selector is found, we might not record the action
      // or use a very basic tagName selector if absolutely necessary (but it's often not unique).
      // A truly robust solution often involves traversing up the DOM tree.
      // console.warn('Could not generate a high-quality unique selector for:', el);

      // Basic path (less ideal, but a fallback)
      let path = '';
      let currentElement = el;
      while (currentElement && currentElement.parentElement && currentElement.tagName.toLowerCase() !== 'body') {
        const tagName = currentElement.tagName.toLowerCase();
        let siblingIndex = 1;
        let sibling = currentElement.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === currentElement.tagName) {
            siblingIndex++;
          }
          sibling = sibling.previousElementSibling;
        }
        const segment = \`\${tagName}:nth-of-type(\${siblingIndex})\`; // nth-of-type is often more stable than nth-child
        path = '>' + segment + path;
        currentElement = currentElement.parentElement;
      }
      return path ? 'body ' + path.substring(1) : tagName; // if path is empty, just return tagName (e.g. for body itself or direct child)

    } catch (e) {
      console.error('Error in generateSelector:', e);
      return null; // Fallback if selector generation itself fails
    }
  }

  function getElementDetails(el) {
    if (!el || !(el instanceof Element)) return {};
    let textContent = el.innerText || el.textContent || '';
    if (el.value) { // For input elements, value might be more relevant than innerText
      textContent = el.value;
    }
    return {
      targetTag: el.tagName.toLowerCase(),
      targetId: el.id,
      targetClass: el.className,
      targetText: textContent.substring(0, 100).trim(), // Get some text, truncate, and trim
    };
  }

  document.addEventListener('click', function(event) {
    try {
      const el = event.target;
      if (!el || !(el instanceof Element) || el.closest('[data-webtest-platform-ignore="true"]')) {
        // Example: Ignore clicks on elements with a specific attribute if we add UI for that
        return;
      }

      // Prevent clicks on the test runner's own UI if it were part of the page
      // if (el.closest('#webtest-runner-ui')) return;

      const selector = generateSelector(el);
      if (!selector) {
        console.warn('No selector generated for click on:', el);
        return;
      }

      const action = {
        type: 'click',
        selector: selector,
        timestamp: Date.now(),
        url: window.location.href,
        ...getElementDetails(el)
      };
      console.log('Recorded click:', action);
      window.sendActionToBackend(action);
    } catch (e) {
      console.error('Error recording click:', e);
    }
  }, true); // Use capture phase to catch events early


  document.addEventListener('change', function(event) { // Handles input, textarea, select
    try {
      const el = event.target;
      if (!el || !(el instanceof Element) || !['input', 'textarea', 'select'].includes(el.tagName.toLowerCase())) {
        return;
      }
      // Ignore hidden inputs or other specific types if needed
      if (el.type === 'hidden' || el.closest('[data-webtest-platform-ignore="true"]')) {
        return;
      }

      const selector = generateSelector(el);
      if (!selector) {
        console.warn('No selector generated for change on:', el);
        return;
      }

      const actionType = el.tagName.toLowerCase() === 'select' ? 'select' : 'input';
      let value = el.value;

      if (el.type === 'checkbox' || el.type === 'radio') {
        value = el.checked ? 'true' : 'false';
      }


      const action = {
        type: actionType,
        selector: selector,
        value: value,
        timestamp: Date.now(),
        url: window.location.href,
        ...getElementDetails(el)
      };
      console.log('Recorded change/input:', action);
      window.sendActionToBackend(action);
    } catch (e) {
      console.error('Error recording change/input:', e);
    }
  }, true); // Use capture phase

  // You could add more listeners here, e.g., for 'keypress' or specific focus/blur events if needed.
  // For 'keypress', you might want to record individual key presses, especially for special keys.
  // For navigations, the backend can infer them by observing URL changes between actions,
  // or you could try to listen for 'popstate' or 'hashchange' and beforeunload.

  console.log('WebTest Recorder Script Injected and Initialized.');
})();
`;


export class PlaywrightService {
  private activeSessions: Map<string, ActiveSession> = new Map();

  // Removing shared browser instance to allow per-execution settings
  // private browser: Browser | null = null;
  // private context: BrowserContext | null = null;

  // initialize and close methods might need to be re-evaluated if a shared browser is ever re-introduced.
  // For now, each major function will manage its own browser lifecycle.

  async loadWebsite(url: string, userId?: number): Promise<{ success: boolean; screenshot?: string; html?: string; error?: string }> {
    if (resolvedLogger && resolvedLogger.info) {
        resolvedLogger.info(`PLAYWRIGHT_SERVICE: loadWebsite called with URL: ${url}, UserID: ${userId}`);
    } else {
        console.log(`PLAYWRIGHT_SERVICE (console): loadWebsite called with URL: ${url}, UserID: ${userId}`);
    }
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
      (resolvedLogger.error || console.error)('Error loading website:', error);
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

  async startRecordingSession(url: string, userId?: number): Promise<{ success: boolean, sessionId?: string, error?: string }> {
    const sessionId = uuidv4();
    let browser: Browser | null = null;
    try {
      // Use user settings for browser configuration if available
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      // Force headless to false for interactive recording sessions
      const effectiveHeadlessMode = false;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      const specificWaitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME;

      (resolvedLogger.info || console.log)(`Starting recording session ${sessionId} for URL: ${url} with browser: ${browserType}, headless: ${effectiveHeadlessMode}`);

      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch({ headless: effectiveHeadlessMode });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 } // Consistent viewport
      });
      const page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(specificWaitTime); // Use specific wait time

      // Bring the page to the front to make it visible to the user
      await page.bringToFront();

      // Expose a function to the page for the client-side recorder script to send actions
      await page.exposeFunction('sendActionToBackend', (action: RecordedAction) => {
        const session = this.activeSessions.get(sessionId);
        if (session) {
          // Backend should always set/override the timestamp for security and consistency
          action.timestamp = Date.now();
          // Ensure URL is also captured from backend perspective if needed, though client sends it
          action.url = action.url || session.page.url(); // Fallback to current page URL if client didn't send

          session.actions.push(action);
          // (resolvedLogger.debug || console.log)(`Action received for session ${sessionId}: ${action.type} on ${action.selector || action.url}`);
        } else {
          // (resolvedLogger.warn || console.warn)(`Action received for non-existent or ended session: ${sessionId}`);
        }
      });

      // Inject the recorder script
      await page.addScriptTag({ content: RECORDER_SCRIPT });

      const sessionData: ActiveSession = {
        browser,
        context,
        page,
        actions: [],
        userId, // Capture userId in sessionData for the 'close' handler
        targetUrl: url,
      };

      // Add listener for page close event
      page.on('close', async () => {
        (resolvedLogger.info || console.log)(`Playwright page closed by user for session ${sessionId}.`);
        // Check if the session is still considered active by the service
        if (this.activeSessions.has(sessionId)) {
          (resolvedLogger.info || console.log)(`Session ${sessionId} is still in activeSessions. Attempting to stop and cleanup.`);
          // Use sessionData.userId from the closure, or fetch from this.activeSessions.get(sessionId)?.userId
          await this.stopRecordingSession(sessionId, sessionData.userId);
        } else {
          (resolvedLogger.info || console.log)(`Session ${sessionId} was already stopped or cleaned up. No further action needed from page.on('close').`);
        }
      });

      // Now, store the session data in the map
      this.activeSessions.set(sessionId, sessionData);

      // Initial action indicating navigation/start
      const initialAction: RecordedAction = {
        type: 'navigate',
        url: page.url(), // Use the page's current URL after navigation
        timestamp: Date.now(),
        value: 'Recording session started'
      };
      // Add initial action directly to sessionData.actions as it's now the source of truth before being set in map
      sessionData.actions.push(initialAction);


      (resolvedLogger.info || console.log)(`Recording session ${sessionId} started for URL: ${url} by user: ${userId || 'anonymous'}`);
      return { success: true, sessionId };

    } catch (error: any) {
      (resolvedLogger.error || console.error)(`Error starting recording session ${sessionId} for URL ${url}:`, error);
      if (browser) {
        await browser.close().catch(err => (resolvedLogger.error || console.error)('Failed to close browser during startRecording error handling:', err));
      }
      // Clean up from activeSessions if partially added before error
      if (this.activeSessions.has(sessionId)) {
          this.activeSessions.delete(sessionId);
      }
      return { success: false, error: error.message || 'Unknown error starting recording session' };
    }
    // Note: Browser is not closed here, it's kept open for the session. It will be closed in stopRecordingSession.
  }

  async stopRecordingSession(sessionId: string, userId?: number): Promise<{ success: boolean, actions?: RecordedAction[], error?: string }> {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      (resolvedLogger.info || console.log)(`Attempted to stop session ${sessionId}, but it was not found in activeSessions. It might have been already stopped (e.g., by page close handler or explicit stop call).`);
      return { success: false, error: "Recording session not found or already stopped." };
    }

    // Optional: Validate userId if the session should be user-specific
    if (userId && session.userId && session.userId !== userId) {
      (resolvedLogger.warn || console.warn)(`User ID mismatch attempting to stop session ${sessionId}. Request by ${userId}, session owned by ${session.userId}`);
      return { success: false, error: "Unauthorized to stop this recording session." };
    }

    try {
      // Add a final action indicating end of recording (optional)
      const finalAction: RecordedAction = {
        type: 'navigate', // or a custom 'recordingEnd' type
        url: session.page.url(),
        timestamp: Date.now(),
        value: 'Recording session stopped'
      };
      session.actions.push(finalAction);

      // Close Playwright resources
      await session.page.close();
      await session.context.close();
      await session.browser.close();

      // Retrieve actions before deleting the session
      const recordedActions = session.actions;
      this.activeSessions.delete(sessionId);

      (resolvedLogger.info || console.log)(`Recording session ${sessionId} stopped. Actions recorded: ${recordedActions.length}`);
      return { success: true, actions: recordedActions };

    } catch (error: any) {
      (resolvedLogger.error || console.error)(`Error stopping recording session ${sessionId}:`, error);
      // Attempt to clean up even if there's an error during close
      this.activeSessions.delete(sessionId);
      return { success: false, error: error.message || 'Unknown error stopping recording session' };
    }
  }

  async getRecordedActions(sessionId: string, userId?: number): Promise<{ success: boolean, actions?: RecordedAction[], error?: string }> {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      return { success: false, error: "Recording session not found or already stopped." };
    }

    // Optional: Validate userId if the session should be user-specific
    if (userId && session.userId && session.userId !== userId) {
      (resolvedLogger.warn || console.warn)(`User ID mismatch attempting to get actions for session ${sessionId}. Request by ${userId}, session owned by ${session.userId}`);
      return { success: false, error: "Unauthorized to access this recording session." };
    }

    // Return a copy of the actions array to prevent external modification if needed,
    // though for polling, direct reference might be fine and more performant.
    // For safety, let's return a copy.
    (resolvedLogger.debug || console.log)(`Retrieved ${session.actions.length} actions for session ${sessionId}`);
    return { success: true, actions: [...session.actions] };
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