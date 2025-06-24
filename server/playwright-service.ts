import playwright, { Browser, Page, BrowserContext, ChromiumBrowser, FirefoxBrowser, WebKitBrowser } from 'playwright';
import { v4 as uuidv4 } from 'uuid'; // For generating session IDs
import loggerPromise from './logger';
import type { Logger as WinstonLogger } from 'winston';
import { storage } from './storage'; // To fetch user settings
import type { Test, UserSettings } from '@shared/schema'; // Import Test and UserSettings type
import fs from 'fs-extra';
import path from 'path';

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
      const fallbackLogger = console; // Use console directly
      fallbackLogger.error("PlaywrightService: Logger resolved but is not a valid Winston instance. Falling back to console.");
      resolvedLogger = fallbackLogger as any; // Cast to any to satisfy WinstonLogger type for basic console methods
    }
  } catch (error: any) {
    const fallbackLogger = console;
    fallbackLogger.error("PlaywrightService: Failed to initialize Winston logger. Falling back to console.", {error: error.message, stack: error.stack });
    // Fallback to a console-based logger if promise rejects
    resolvedLogger = fallbackLogger as any;
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
  pageClosedByEventHandler?: boolean; // Flag to indicate if page was closed by event handler
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
    resolvedLogger.http({ message: "PlaywrightService: loadWebsite called", url, userId });
    let browser: Browser | null = null;
    try {
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      const effectiveWaitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME;
      resolvedLogger.debug({ message: "PS:loadWebsite - Effective settings", browserType, headlessMode, pageTimeout, effectiveWaitTime, userId });

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

      await page.waitForTimeout(effectiveWaitTime);

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
    } catch (error: any) {
      resolvedLogger.error({ message: 'Error loading website', url, userId, error: error.message, stack: error.stack });
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
    resolvedLogger.http({ message: "PlaywrightService: startRecordingSession called", url, userId });
    const sessionId = uuidv4();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    resolvedLogger.debug({ message:"PS:startRecordingSession - Initial state", sessionId, url, userId });

    let browserType: 'chromium' | 'firefox' | 'webkit' = DEFAULT_BROWSER; // Define here for catch block visibility

    try {
      resolvedLogger.debug({ message: "PS:startRecordingSession - Fetching user settings...", sessionId, userId });
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      const userSettingsSummary = userSettings ? { browser: userSettings.playwrightBrowser, timeout: userSettings.playwrightDefaultTimeout, waitTime: userSettings.playwrightWaitTime } : {};
      resolvedLogger.debug({ message: "PS:startRecordingSession - User settings fetched", sessionId, settingsSummary: userSettingsSummary });

      browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const effectiveHeadlessMode = false; // Force headless to false for interactive recording sessions
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      const specificWaitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME;
      resolvedLogger.debug({ message: `PS:startRecordingSession - Effective settings for RECORDING`, browserType, effectiveHeadlessMode, pageTimeout, specificWaitTime, sessionId });

      const browserLaunchOptions = { headless: effectiveHeadlessMode };
      resolvedLogger.debug({ message: `PS:startRecordingSession - Attempting to launch browser`, browserType, options: browserLaunchOptions, sessionId });
      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch(browserLaunchOptions);
      resolvedLogger.debug({ message: `PS:startRecordingSession - Browser launched`, sessionId, connected: browser?.isConnected(), type: browser?.browserType?.().name() });

      const contextOptions = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
      };
      resolvedLogger.debug({ message: `PS:startRecordingSession - Attempting to create new browser context`, options: contextOptions, sessionId });
      context = await browser.newContext(contextOptions);
      resolvedLogger.debug({ message: "PS:startRecordingSession - Browser context created", sessionId });

      resolvedLogger.debug({ message: "PS:startRecordingSession - Attempting to create new page...", sessionId });
      page = await context.newPage();
      resolvedLogger.debug({ message: "PS:startRecordingSession - New page created", sessionId, pageClosed: page?.isClosed() });

      resolvedLogger.debug({ message: `PS:startRecordingSession - Setting default timeout to ${pageTimeout}ms...`, sessionId });
      page.setDefaultTimeout(pageTimeout);

      const gotoOptions = { waitUntil: 'domcontentloaded' as const };
      resolvedLogger.debug({ message: `PS:startRecordingSession - Navigating to URL`, url, options: gotoOptions, sessionId, pageClosed: page?.isClosed() });
      await page.goto(url, gotoOptions);
      resolvedLogger.debug({ message: "PS:startRecordingSession - Navigation complete.", sessionId });

      resolvedLogger.debug({ message: `PS:startRecordingSession - Waiting for timeout: ${specificWaitTime}ms.`, sessionId, pageClosed: page?.isClosed() });
      await page.waitForTimeout(specificWaitTime);

      resolvedLogger.debug({ message: "PS:startRecordingSession - Bringing page to front...", sessionId });
      await page.bringToFront();

      resolvedLogger.debug({ message: "PS:startRecordingSession - Exposing 'sendActionToBackend' function...", sessionId });
      await page.exposeFunction('sendActionToBackend', (action: RecordedAction) => {
        const session = this.activeSessions.get(sessionId);
        if (session) {
          action.timestamp = Date.now();
          action.url = action.url || session.page.url(); // Ensure URL is current
          session.actions.push(action);
          resolvedLogger.verbose({ message: `PS:startRecordingSession - Action received for session`, sessionId, actionType: action.type });
        } else {
          resolvedLogger.warn({ message: `PS:startRecordingSession - Action received for non-existent session`, sessionId, actionType: action.type });
        }
      });

      resolvedLogger.debug({ message: "PS:startRecordingSession - Injecting recorder script...", sessionId });
      await page.addScriptTag({ content: RECORDER_SCRIPT });

      const sessionData: ActiveSession = { browser, context, page, actions: [], userId, targetUrl: url };
      resolvedLogger.debug({ message: "PS:startRecordingSession - SessionData created.", sessionId });

      page.on('close', async () => {
        resolvedLogger.info({ message: `PS:startRecordingSession - page.on('close') triggered for session. Page has been closed externally.`, sessionId });
        const session = this.activeSessions.get(sessionId);
        if (session) {
          session.pageClosedByEventHandler = true;
          resolvedLogger.debug({ message: `PS:startRecordingSession - Session marked as pageClosedByEventHandler.`, sessionId });
        } else {
          resolvedLogger.debug({ message: `PS:startRecordingSession - Session already stopped/cleaned up when page.on('close') triggered (session not found in activeSessions).`, sessionId });
        }
      });
      resolvedLogger.debug({ message: "PS:startRecordingSession - page.on('close') handler set up.", sessionId });

      this.activeSessions.set(sessionId, sessionData);
      resolvedLogger.debug({ message: `PS:startRecordingSession - Session added to activeSessions map.`, sessionId });

      const initialAction: RecordedAction = { type: 'navigate', url: page.url(), timestamp: Date.now(), value: 'Recording session started' };
      sessionData.actions.push(initialAction);
      resolvedLogger.debug({ message: "PS:startRecordingSession - Initial action pushed to sessionData.actions.", sessionId, action: initialAction });

      resolvedLogger.info({ message: `PS:startRecordingSession - Recording session started successfully`, sessionId, url, userId: userId || 'anonymous' });
      return { success: true, sessionId };

    } catch (error: any) {
      let stage = "unknown";
      if (!browser) stage = `browser launch (type: ${browserType})`;
      else if (!context) stage = "browser context creation";
      else if (!page) stage = "page creation";
      else if (page.isClosed()) stage = "page operation on closed page";
      else stage = "page navigation/setup";

      resolvedLogger.error({ message: `PS:startRecordingSession - CRITICAL ERROR during session setup`, sessionId, stage, url, error: error.message, stack: error.stack, browserLaunched: !!browser, browserConnected: browser?.isConnected() });

      if (browser && browser.isConnected()) {
        resolvedLogger.debug({ message: `PS:startRecordingSession - Attempting to close browser in catch block`, sessionId });
        await browser.close().catch(err => resolvedLogger.error({ message: `PS:startRecordingSession - Failed to close browser during error handling`, sessionId, error: err.message, stack: err.stack }));
        resolvedLogger.debug({ message: `PS:startRecordingSession - Browser close attempt in catch block finished`, sessionId });
      } else if (browser) {
        resolvedLogger.debug({ message: `PS:startRecordingSession - Browser exists but is not connected in catch block. No close attempt.`, sessionId });
      } else {
        resolvedLogger.debug({ message: `PS:startRecordingSession - Browser is null in catch block. No close attempt.`, sessionId });
      }

      if (this.activeSessions.has(sessionId)) {
        this.activeSessions.delete(sessionId);
        resolvedLogger.debug({ message: `PS:startRecordingSession - Session removed from activeSessions due to error.`, sessionId });
      }
      return { success: false, error: `Failed during ${stage}: ${error.message}` };
    }
  }

  async stopRecordingSession(sessionId: string, userId?: number): Promise<{ success: boolean, actions?: RecordedAction[], error?: string }> {
    resolvedLogger.http({ message: "PlaywrightService: stopRecordingSession called", sessionId, userId });
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      resolvedLogger.warn({ message: `PS:stopRecordingSession - Session not found or already stopped.`, sessionId, userId });
      return { success: false, error: "Recording session not found or already stopped." };
    }

    if (userId && session.userId && session.userId !== userId) {
      resolvedLogger.warn({ message: `User ID mismatch attempting to stop session`, sessionId, requestUserId: userId, sessionUserId: session.userId });
      return { success: false, error: "Unauthorized to stop this recording session." };
    }

    if (session.pageClosedByEventHandler) {
      resolvedLogger.info({ message: `PS:stopRecordingSession - Session was previously marked as pageClosedByEventHandler. Proceeding to finalize and retrieve actions.`, sessionId });
    }

    try {
      if (session.page && !session.page.isClosed()) {
        const finalAction: RecordedAction = { type: 'navigate', url: session.page.url(), timestamp: Date.now(), value: 'Recording session stopped' };
        session.actions.push(finalAction);
      } else {
        let lastUrl = session.targetUrl;
        if (session.actions.length > 0) {
            const lastRecordedActionWithUrl = session.actions.slice().reverse().find(a => a.url);
            if (lastRecordedActionWithUrl) lastUrl = lastRecordedActionWithUrl.url;
        }
        const finalAction: RecordedAction = { type: 'navigate', url: lastUrl, timestamp: Date.now(), value: 'Recording session stopped (page was already closed)' };
        session.actions.push(finalAction);
        resolvedLogger.info({ message: `PS:stopRecordingSession - Page for session was already closed. Final action URL uses a fallback.`, sessionId, fallbackUrl: lastUrl });
      }

      if (session.page && !session.page.isClosed()) {
        resolvedLogger.debug({ message: `PS:stopRecordingSession - Attempting to close page`, sessionId });
        await session.page.close().catch(e => resolvedLogger.warn({ message: `PS:stopRecordingSession - Error closing page resource`, sessionId, error: e.message, stack: e.stack }));
      } else {
        resolvedLogger.debug({ message: `PS:stopRecordingSession - Page for session was already closed or did not exist.`, sessionId });
      }

      if (session.context) {
        resolvedLogger.debug({ message: `PS:stopRecordingSession - Attempting to close context`, sessionId });
        await session.context.close().catch(e => resolvedLogger.warn({ message: `PS:stopRecordingSession - Error closing context resource`, sessionId, error: e.message, stack: e.stack }));
      } else {
        resolvedLogger.debug({ message: `PS:stopRecordingSession - Context for session did not exist.`, sessionId });
      }

      if (session.browser && session.browser.isConnected()) {
        resolvedLogger.debug({ message: `PS:stopRecordingSession - Attempting to close browser`, sessionId });
        await session.browser.close().catch(e => resolvedLogger.warn({ message: `PS:stopRecordingSession - Error closing browser resource`, sessionId, error: e.message, stack: e.stack }));
      } else {
        resolvedLogger.debug({ message: `PS:stopRecordingSession - Browser for session was already closed, not connected, or did not exist.`, sessionId });
      }

      const recordedActions = session.actions;
      if (recordedActions.length === 0) {
        resolvedLogger.warn({ message: `PS:stopRecordingSession - Session is being stopped with an empty action list.`, sessionId });
      } else if (recordedActions.length === 1 && (recordedActions[0].value === 'Recording session stopped' || recordedActions[0].value === 'Recording session stopped (page was already closed)')) {
        if (session.actions.find(action => action.value === 'Recording session started' && action.type === 'navigate')) {
             resolvedLogger.warn({ message: `PS:stopRecordingSession - Session stopped with only the final 'stop' action, initial navigation was present but no user actions.`, sessionId });
        } else {
             resolvedLogger.warn({ message: `PS:stopRecordingSession - Session stopped with only the final 'stop' action. No user or initial navigation actions recorded/persisted.`, sessionId });
        }
      }

      resolvedLogger.info({ message: `PS:stopRecordingSession - Session finalized. Returning actions.`, sessionId, actionCount: recordedActions.length });
      this.activeSessions.delete(sessionId);
      resolvedLogger.debug({ message: `PS:stopRecordingSession - Session removed from activeSessions.`, sessionId });

      return { success: true, actions: recordedActions };

    } catch (error: any) {
      resolvedLogger.error({ message: `PS:stopRecordingSession - CRITICAL error during stop sequence`, sessionId, error: error.message, stack: error.stack });
      this.activeSessions.delete(sessionId);
      resolvedLogger.debug({ message: `PS:stopRecordingSession - Session removed from activeSessions due to critical error during stop sequence.`, sessionId });
      return { success: false, error: error.message || `Unknown error stopping recording session ${sessionId}` };
    }
  }

  async getRecordedActions(sessionId: string, userId?: number): Promise<{ success: boolean, actions?: RecordedAction[], error?: string }> {
    const session = this.activeSessions.get(sessionId);
    resolvedLogger.debug({ message: "PS:getRecordedActions called", sessionId, userId, sessionFound: !!session });

    if (!session) {
      return { success: false, error: "Recording session not found or already stopped." };
    }

    if (userId && session.userId && session.userId !== userId) {
      resolvedLogger.warn({ message: `User ID mismatch attempting to get actions for session`, sessionId, requestUserId: userId, sessionUserId: session.userId });
      return { success: false, error: "Unauthorized to access this recording session." };
    }
    resolvedLogger.debug({ message: `Retrieved actions for session`, sessionId, actionCount: session.actions.length });
    return { success: true, actions: [...session.actions] };
  }

  async executeAdhocSequence(payload: AdhocSequencePayload, userId: number): Promise<{ success: boolean; steps?: StepResult[]; error?: string; duration?: number; detectedElements?: DetectedElement[] }> {
    const testName = payload.name || "Ad-hoc Test";
    resolvedLogger.http({ message: "PlaywrightService: executeAdhocSequence called", testName, userId, url: payload.url });
    const startTime = Date.now();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    resolvedLogger.debug({ message: "PS:executeAdhocSequence - Initial state", testName, userId });
    const stepResults: StepResult[] = [];
    let overallSuccess = true;

    try {
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Fetching user settings", testName, userId });
      const userSettings = await storage.getUserSettings(userId);
      const settingsSummary = userSettings ? { browser: userSettings.playwrightBrowser, headless: userSettings.playwrightHeadless, timeout: userSettings.playwrightDefaultTimeout } : {};
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - User settings fetched", testName, settingsSummary });

      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Effective settings", testName, browserType, headlessMode, pageTimeout });

      const browserLaunchOptions = { headless: headlessMode };
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Attempting to launch browser", testName, browserType, options: browserLaunchOptions });
      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch(browserLaunchOptions);
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Browser launched", testName, connected: browser?.isConnected(), type: browser?.browserType?.().name() });

      const contextOptions = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Attempting to create new browser context", testName, options: contextOptions });
      context = await browser.newContext(contextOptions);
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Browser context created", testName });

      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Attempting to create new page", testName });
      page = await context.newPage();
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - New page created", testName, pageClosed: page?.isClosed() });

      resolvedLogger.debug({ message: `PS:executeAdhocSequence - Setting default timeout to ${pageTimeout}ms`, testName });
      page.setDefaultTimeout(pageTimeout);

      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Setting viewport size to 1280x720", testName });
      await page.setViewportSize({ width: 1280, height: 720 });

      if (payload.url) {
        const gotoOptions = { waitUntil: 'domcontentloaded' as const };
        resolvedLogger.debug({ message: `PS:executeAdhocSequence - Navigating to URL`, testName, url: payload.url, options: gotoOptions, pageClosed: page?.isClosed() });
        try {
          await page.goto(payload.url, gotoOptions);
          resolvedLogger.debug({ message: "PS:executeAdhocSequence - Navigation complete. Attempting screenshot...", testName });
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
          resolvedLogger.error({ message: `PS:executeAdhocSequence - ERROR during initial navigation`, testName, url: payload.url, error: e.message, stack: e.stack, pageClosed: page?.isClosed() });
          const errorScreenshotBuffer = await page?.screenshot({ type: 'png' }).catch(() => null);
          const errorScreenshot = errorScreenshotBuffer?.toString('base64');
          stepResults.push({
            name: 'Load Page',
            type: 'navigation',
            status: 'failed',
            error: e.message,
            screenshot: errorScreenshot ? `data:image/png;base64,${errorScreenshot}` : undefined,
            details: `Failed to navigate to ${payload.url}: ${e.message}`,
          });
          const duration = Date.now() - startTime;
          let finalDetectedElementsNavFail: DetectedElement[] = [];
          if (page && !page.isClosed()) {
            resolvedLogger.debug({ message: "PS:executeAdhocSequence - Attempting element detection (due to navigation failure)", testName, pageClosed: page?.isClosed() });
            try {
              finalDetectedElementsNavFail = await page.evaluate(() => { // Code for element detection (omitted for brevity, same as original)
                const interactiveSelectors = ['input:not([type="hidden"])','button','a[href]','select','textarea','[onclick]','[role="button"]','[tabindex]:not([tabindex="-1"])','h1, h2, h3, h4, h5, h6','img[alt]','form','[data-testid]','[data-test]'];
                const detectedElementsEval: any[] = []; let globalElementCounter = 0;
                interactiveSelectors.forEach(selector => { document.querySelectorAll(selector).forEach((element, index) => { const rect = element.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0 && rect.top >= 0) { const tagName = element.tagName.toLowerCase(); const text = element.textContent?.trim() || ''; const placeholder = element.getAttribute('placeholder') || ''; const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`; let uniqueSelector = selector; if (element.id) { uniqueSelector = `#${element.id}`; } else if (element.className && typeof element.className === 'string') { const classes = element.className.split(' ').filter(c => c.length > 0 && !c.includes(':') && !c.includes('(') && !c.includes(')') ); if (classes.length > 0) uniqueSelector = `${tagName}.${classes[0]}`; } let elementType = 'element'; if (tagName === 'input') elementType = element.getAttribute('type') || 'input'; else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button'; else if (tagName === 'a') elementType = 'link'; else if (tagName.match(/h[1-6]/)) elementType = 'heading'; else if (tagName === 'select') elementType = 'select'; else if (tagName === 'textarea') elementType = 'textarea'; const attributes: Record<string, string> = {}; Array.from(element.attributes).forEach(attr => { attributes[attr.name] = attr.value; }); detectedElementsEval.push({ id: `elem-${tagName}-${globalElementCounter++}`, type: elementType, selector: uniqueSelector, text: displayText.substring(0, 100), tag: tagName, attributes, boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } }); } }); });
                return detectedElementsEval.slice(0, 50);
              });
            } catch (detectionError: any) {
              resolvedLogger.warn({ message: `PS:executeAdhocSequence - Error during element detection (navigation fail path)`, testName, error: detectionError.message, stack: detectionError.stack });
            }
          }
          return { success: false, steps: stepResults, error: `Initial navigation failed: ${e.message}`, duration, detectedElements: finalDetectedElementsNavFail };
        }
      } else {
        stepResults.push({ name: 'Initial State', type: 'setup', status: 'passed', details: 'No initial URL provided for ad-hoc sequence.' });
      }

      if (overallSuccess && payload.sequence && Array.isArray(payload.sequence)) {
        resolvedLogger.debug({ message: `PS:executeAdhocSequence - Starting execution of ${payload.sequence.length} steps.`, testName });
        for (const step of payload.sequence) {
          let stepStatus: 'passed' | 'failed' = 'passed';
          let stepError: string | undefined;
          let stepScreenshot: string | undefined;
          const actionId = step.action?.id;
          const actionName = step.action?.name || 'Unnamed Action';
          resolvedLogger.verbose({ message: `PS:executeAdhocSequence - LOOP START for step`, testName, actionName, actionId, pageClosed: page?.isClosed() });

          try {
            if (!actionId) throw new Error('Step action ID is missing.');
            if (!page) throw new Error('Page is not available.');
            if (page.isClosed()) throw new Error('Page was closed unexpectedly before step execution.');

            resolvedLogger.verbose({ message: `PS:executeAdhocSequence - Executing step`, testName, actionName, actionId, selector: step.targetElement?.selector, value: step.value });

            switch (actionId) {
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
              case 'assert':
                resolvedLogger.warn({ message: `PS:executeAdhocSequence - Generic 'assert' action encountered. Consider using specific assertions.`, testName, actionName, selector: step.targetElement?.selector });
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = 'Selector missing for generic assert action.';
                } else {
                  const elementToAssert = await page.locator(step.targetElement.selector).count();
                  if (elementToAssert === 0) { stepStatus = 'failed'; stepError = `Assertion Failed: Element "${step.targetElement.selector}" not found.`; }
                }
                break;
              case 'assertTextContains':
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for assertTextContains action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Expected text (value) missing or empty for assertTextContains action."; break; }
                const elementForText = page.locator(step.targetElement.selector);
                const actualText = await elementForText.textContent();
                if (actualText === null || !actualText.includes(step.value)) { stepStatus = 'failed'; stepError = `Assertion Failed: Element "${step.targetElement.selector}" did not contain text "${step.value}". Actual: "${actualText === null ? 'null' : actualText}".`; }
                break;
              case 'assertElementCount':
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for assertElementCount action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Expected count (value) missing or empty for assertElementCount action."; break; }
                const parsedAssertion = parseAssertionValue(step.value);
                if (!parsedAssertion) { stepStatus = 'failed'; stepError = `Invalid format for assertElementCount value: "${step.value}". Expected format like "==5", ">=2", or "3".`; break; }
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
                  default: stepStatus = 'failed'; stepError = `Unknown operator "${parsedAssertion.operator}" for assertElementCount.`; break;
                }
                if (!countMatch && stepStatus === 'passed') { stepStatus = 'failed'; stepError = `Assertion Failed: Element count for selector "${step.targetElement.selector}" did not match. Expected ${parsedAssertion.operator} ${parsedAssertion.count}, Actual: ${actualCount}.`; }
                break;
              case 'hover':
                if (!step.targetElement?.selector) throw new Error('Selector missing for hover action.');
                await page.hover(step.targetElement.selector);
                break;
              case 'select':
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for select action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Value missing for select action (expected option value)."; break; }
                await page.selectOption(step.targetElement.selector, step.value);
                break;
              default:
                throw new Error(`Unsupported action ID: ${actionId}`);
            }
            resolvedLogger.verbose({ message: `PS:executeAdhocSequence - Taking screenshot for step`, testName, actionName, actionId });
            const screenshotBuffer = await page.screenshot({ type: 'png' });
            stepScreenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
            resolvedLogger.verbose({ message: "PS:executeAdhocSequence - Step screenshot taken", testName, actionName });

          } catch (e: any) {
            stepStatus = 'failed';
            stepError = e.message;
            overallSuccess = false;
            resolvedLogger.error({ message: `PS:executeAdhocSequence - ERROR during step execution`, testName, actionName, actionId, error: e.message, stack: e.stack, pageClosed: page?.isClosed() });
            if (page && !page.isClosed()) {
              resolvedLogger.debug({ message: "PS:executeAdhocSequence - Attempting error screenshot for failed step...", testName, actionName });
              try {
                const errorScreenshotBuffer = await page.screenshot({ type: 'png' });
                stepScreenshot = `data:image/png;base64,${errorScreenshotBuffer.toString('base64')}`;
              } catch (screenError: any) {
                resolvedLogger.warn({ message: 'PS:executeAdhocSequence - Failed to take error screenshot for step', testName, actionName, error: screenError.message, stack: screenError.stack });
              }
            }
          }
          if (stepStatus === 'failed') overallSuccess = false;

          stepResults.push({ name: actionName, type: actionId || 'unknown', selector: step.targetElement?.selector, value: step.value, status: stepStatus, screenshot: stepScreenshot, error: stepError, details: stepStatus === 'passed' ? 'Action executed successfully.' : `Action failed: ${stepError || 'Unknown error'}`, });
          if (!overallSuccess) {
            resolvedLogger.info({ message: `PS:executeAdhocSequence - Step failed. Stopping sequence execution.`, testName, failedStep: actionName });
            break;
          }
        }
      }

      const duration = Date.now() - startTime;
      resolvedLogger.info({ message: `PS:executeAdhocSequence - Test completed.`, testName, overallSuccess, durationMs: duration, stepsExecuted: stepResults.length });

      let finalDetectedElements: DetectedElement[] = [];
      if (page && !page.isClosed()) {
          resolvedLogger.debug({ message: "PS:executeAdhocSequence - Attempting final element detection (success path)", testName, pageClosed: page?.isClosed() });
          try {
              finalDetectedElements = await page.evaluate(() => { // Code for element detection (omitted for brevity, same as original)
                const interactiveSelectors = ['input:not([type="hidden"])','button','a[href]','select','textarea','[onclick]','[role="button"]','[tabindex]:not([tabindex="-1"])','h1, h2, h3, h4, h5, h6','img[alt]','form','[data-testid]','[data-test]'];
                const detectedElementsEval: any[] = []; let globalElementCounter = 0;
                interactiveSelectors.forEach(selector => { document.querySelectorAll(selector).forEach((element, index) => { const rect = element.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0 && rect.top >= 0) { const tagName = element.tagName.toLowerCase(); const text = element.textContent?.trim() || ''; const placeholder = element.getAttribute('placeholder') || ''; const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`; let uniqueSelector = selector; if (element.id) { uniqueSelector = `#${element.id}`; } else if (element.className && typeof element.className === 'string') { const classes = element.className.split(' ').filter(c => c.length > 0 && !c.includes(':') && !c.includes('(') && !c.includes(')') ); if (classes.length > 0) uniqueSelector = `${tagName}.${classes[0]}`; } let elementType = 'element'; if (tagName === 'input') elementType = element.getAttribute('type') || 'input'; else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button'; else if (tagName === 'a') elementType = 'link'; else if (tagName.match(/h[1-6]/)) elementType = 'heading'; else if (tagName === 'select') elementType = 'select'; else if (tagName === 'textarea') elementType = 'textarea'; const attributes: Record<string, string> = {}; Array.from(element.attributes).forEach(attr => { attributes[attr.name] = attr.value; }); detectedElementsEval.push({ id: `elem-${tagName}-${globalElementCounter++}`, type: elementType, selector: uniqueSelector, text: displayText.substring(0, 100), tag: tagName, attributes, boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } }); } }); });
                return detectedElementsEval.slice(0, 50);
              });
          } catch (detectionError: any) {
              resolvedLogger.warn({ message: `PS:executeAdhocSequence - Error during final element detection (success path)`, testName, error: detectionError.message, stack: detectionError.stack });
          }
      }
      return { success: overallSuccess, steps: stepResults, duration, detectedElements: finalDetectedElements };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      resolvedLogger.error({ message: `PS:executeAdhocSequence - CRITICAL ERROR in executeAdhocSequence`, testName, userId, error: error.message, stack: error.stack, browserExists: !!browser, contextExists: !!context, pageExists: !!page, pageClosed: page?.isClosed() });
      let finalDetectedElementsCriticalError: DetectedElement[] = [];
      if (page && !page.isClosed()) {
        resolvedLogger.debug({ message: "PS:executeAdhocSequence - Attempting element detection after critical error", testName, pageClosed: page?.isClosed() });
        try {
          finalDetectedElementsCriticalError = await page.evaluate(() => { // Code for element detection (omitted for brevity, same as original)
            const interactiveSelectors = ['input:not([type="hidden"])','button','a[href]','select','textarea','[onclick]','[role="button"]','[tabindex]:not([tabindex="-1"])','h1, h2, h3, h4, h5, h6','img[alt]','form','[data-testid]','[data-test]'];
            const detectedElementsEval: any[] = []; let globalElementCounter = 0;
            interactiveSelectors.forEach(selector => { document.querySelectorAll(selector).forEach((element, index) => { const rect = element.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0 && rect.top >= 0) { const tagName = element.tagName.toLowerCase(); const text = element.textContent?.trim() || ''; const placeholder = element.getAttribute('placeholder') || ''; const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`; let uniqueSelector = selector; if (element.id) { uniqueSelector = `#${element.id}`; } else if (element.className && typeof element.className === 'string') { const classes = element.className.split(' ').filter(c => c.length > 0 && !c.includes(':') && !c.includes('(') && !c.includes(')') ); if (classes.length > 0) uniqueSelector = `${tagName}.${classes[0]}`; } let elementType = 'element'; if (tagName === 'input') elementType = element.getAttribute('type') || 'input'; else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button'; else if (tagName === 'a') elementType = 'link'; else if (tagName.match(/h[1-6]/)) elementType = 'heading'; else if (tagName === 'select') elementType = 'select'; else if (tagName === 'textarea') elementType = 'textarea'; const attributes: Record<string, string> = {}; Array.from(element.attributes).forEach(attr => { attributes[attr.name] = attr.value; }); detectedElementsEval.push({ id: `elem-${tagName}-${globalElementCounter++}`, type: elementType, selector: uniqueSelector, text: displayText.substring(0, 100), tag: tagName, attributes, boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } }); } }); });
            return detectedElementsEval.slice(0, 50);
          });
        } catch (detectionError: any) {
          resolvedLogger.warn({ message: `PS:executeAdhocSequence - Error during element detection (critical error path)`, testName, error: detectionError.message, stack: detectionError.stack });
        }
      }
      return { success: false, steps: stepResults, error: error.message || 'Unknown critical error during ad-hoc execution', duration, detectedElements: finalDetectedElementsCriticalError };
    } finally {
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Inside finally block.", testName });
      resolvedLogger.verbose({ message: "PS:executeAdhocSequence (finally) - State before closing page", testName, pageExists:!!page, pageClosed: page?.isClosed() });
      if (page && !page.isClosed()) {
        resolvedLogger.debug({ message: "PS:executeAdhocSequence (finally) - Attempting to close page...", testName });
        await page.close().catch(e => resolvedLogger.warn({ message: "PS:executeAdhocSequence - Error closing page (adhoc)", testName, error: e.message, stack: e.stack }));
      }
      resolvedLogger.verbose({ message: "PS:executeAdhocSequence (finally) - State before closing context", testName, contextExists: !!context });
      if (context) {
        resolvedLogger.debug({ message: "PS:executeAdhocSequence (finally) - Attempting to close context...", testName });
        await context.close().catch(e => resolvedLogger.warn({ message: "PS:executeAdhocSequence - Error closing context (adhoc)", testName, error: e.message, stack: e.stack }));
      }
      resolvedLogger.verbose({ message: "PS:executeAdhocSequence (finally) - State before closing browser", testName, browserExists: !!browser, browserConnected: browser?.isConnected() });
      if (browser && browser.isConnected()) {
        resolvedLogger.debug({ message: "PS:executeAdhocSequence (finally) - Attempting to close browser...", testName });
        await browser.close().catch(e => resolvedLogger.warn({ message: "PS:executeAdhocSequence - Error closing browser (adhoc)", testName, error: e.message, stack: e.stack }));
      }
    }
  }

  async detectElements(url: string, userId?: number): Promise<DetectedElement[]> {
    resolvedLogger.http({ message: "PlaywrightService: detectElements called", url, userId });
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    resolvedLogger.debug({ message: "PS:detectElements - Initial state", url, userId });

    try {
      resolvedLogger.debug({ message: "PS:detectElements - Fetching user settings", userId });
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      resolvedLogger.debug({ message: "PS:detectElements - Effective settings", browserType, headlessMode, pageTimeout, userId });

      resolvedLogger.debug({ message: "PS:detectElements - Attempting to launch browser", browserType, headlessMode });
      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch({ headless: headlessMode });

      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      resolvedLogger.debug({ message: "PS:detectElements - Attempting to create new browser context", userAgent });
      context = await browser.newContext({ userAgent });

      resolvedLogger.debug({ message: "PS:detectElements - Attempting to create new page" });
      page = await context.newPage();

      resolvedLogger.debug({ message: "PS:detectElements - Setting default timeout", pageTimeout });
      page.setDefaultTimeout(pageTimeout);

      resolvedLogger.debug({ message: "PS:detectElements - Setting viewport size" });
      await page.setViewportSize({ width: 1280, height: 720 });

      resolvedLogger.debug({ message: `PS:detectElements - Navigating to URL`, url, pageClosed: page?.isClosed() });
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const waitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME;
      resolvedLogger.debug({ message: `PS:detectElements - Waiting for timeout`, waitTime, pageClosed: page?.isClosed() });
      await page.waitForTimeout(waitTime);

      resolvedLogger.debug({ message: "PS:detectElements - Evaluating page for elements", pageClosed: page?.isClosed() });
      const elements = await page.evaluate(() => { // Code for element detection (omitted for brevity, same as original)
        const interactiveSelectors = ['input:not([type="hidden"])','button','a[href]','select','textarea','[onclick]','[role="button"]','[tabindex]:not([tabindex="-1"])','h1, h2, h3, h4, h5, h6','img[alt]','form','[data-testid]','[data-test]'];
        const detectedElements:any[] = []; let globalElementCounter = 0;
        interactiveSelectors.forEach(selector => { document.querySelectorAll(selector).forEach((element, index) => { const rect = element.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0 && rect.top >= 0) { const tagName = element.tagName.toLowerCase(); const text = element.textContent?.trim() || ''; const placeholder = element.getAttribute('placeholder') || ''; const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`; let uniqueSelector = selector; if (element.id) { uniqueSelector = `#${element.id}`; } else if (element.className && typeof element.className === 'string') { const classes = element.className.split(' ').filter(c => c.length > 0 && !c.includes(':') && !c.includes('(') && !c.includes(')') ); if (classes.length > 0) { uniqueSelector = `${tagName}.${classes[0]}`; } } let elementType = 'element'; if (tagName === 'input') elementType = element.getAttribute('type') || 'input'; else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button'; else if (tagName === 'a') elementType = 'link'; else if (tagName.match(/h[1-6]/)) elementType = 'heading'; else if (tagName === 'select') elementType = 'select'; else if (tagName === 'textarea') elementType = 'textarea'; const attributes:Record<string,string> = {}; Array.from(element.attributes).forEach(attr => { attributes[attr.name] = attr.value; }); detectedElements.push({ id: `elem-${tagName}-${globalElementCounter++}`, type: elementType, selector: uniqueSelector, text: displayText.substring(0, 100), tag: tagName, attributes, boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } }); } }); });
        return detectedElements.slice(0, 50);
      });
      resolvedLogger.info({ message: `PS:detectElements - Element detection script completed.`, foundCount: elements?.length, url, userId });

      return elements;
    } catch (error: any) {
      resolvedLogger.error({ message: "PS:detectElements - Error caught during element detection", url, userId, error: error.message, stack: error.stack, pageExists: !!page, pageClosed: page?.isClosed() });
      throw error;
    } finally {
      resolvedLogger.debug({ message: "PS:detectElements - Inside finally block.", url, userId });
      resolvedLogger.verbose({ message: "PS:detectElements (finally) - State before closing page", url, pageExists:!!page, pageClosed: page?.isClosed() });
      if (page && !page.isClosed()) {
        resolvedLogger.debug({ message: "PS:detectElements (finally) - Attempting to close page...", url });
        await page.close().catch(e => resolvedLogger.warn({ message: "PS:detectElements - Error closing page", url, error: e.message, stack: e.stack }));
      }
      resolvedLogger.verbose({ message: "PS:detectElements (finally) - State before closing context", url, contextExists: !!context });
      if (context) {
        resolvedLogger.debug({ message: "PS:detectElements (finally) - Attempting to close context...", url });
        await context.close().catch(e => resolvedLogger.warn({ message: "PS:detectElements - Error closing context", url, error: e.message, stack: e.stack }));
      }
      resolvedLogger.verbose({ message: "PS:detectElements (finally) - State before closing browser", url, browserExists: !!browser, browserConnected: browser?.isConnected() });
      if (browser && browser.isConnected()) {
        resolvedLogger.debug({ message: "PS:detectElements (finally) - Attempting to close browser...", url });
        await browser.close().catch(e => resolvedLogger.warn({ message: "PS:detectElements - Error closing browser", url, error: e.message, stack: e.stack }));
      }
    }
  }

  async executeTestSequence(
    test: Test,
    userId: number,
    screenshotBaseDir?: string // Optional base directory for screenshots
  ): Promise<{ success: boolean; steps?: StepResult[]; error?: string; duration?: number }> {
    const startTime = Date.now();
    resolvedLogger.http({ message: "PlaywrightService: executeTestSequence called", testName: test.name, testId: test.id, userId, testUrl: test.url, screenshotBaseDir });
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
      resolvedLogger.debug({ message: `PS:executeTestSequence - Effective settings`, testName: test.name, browserType, headlessMode, pageTimeout });

      const browserEngine = playwright[browserType];
      browser = await browserEngine.launch({ headless: headlessMode });
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      context = await browser.newContext({ userAgent });
      page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);
      await page.setViewportSize({ width: 1280, height: 720 });

      if (test.url) {
        try {
          resolvedLogger.debug({message: "PS:executeTestSequence - Navigating to initial URL", testName: test.name, url: test.url});
          await page.goto(test.url, { waitUntil: 'domcontentloaded' });
          let navScreenshotPath: string | undefined;
          if (screenshotBaseDir) {
            await fs.ensureDir(screenshotBaseDir);
            const screenshotFilePath = path.join(screenshotBaseDir, `step_navigation_load_${Date.now()}.png`);
            await page.screenshot({ type: 'png', path: screenshotFilePath });
            navScreenshotPath = screenshotFilePath;
          } else {
            const screenshotBuffer = await page.screenshot({ type: 'png' });
            navScreenshotPath = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
          }
          stepResults.push({ name: 'Load Page', type: 'navigation', status: 'passed', screenshot: navScreenshotPath, details: `Successfully navigated to ${test.url}` });
        } catch (e: any) {
          overallSuccess = false;
          resolvedLogger.error({ message: "PS:executeTestSequence - Failed initial navigation", testName: test.name, url: test.url, error: e.message, stack: e.stack });
          let errorNavScreenshotPath: string | undefined;
          if (page && !page.isClosed()) {
            if (screenshotBaseDir) {
              await fs.ensureDir(screenshotBaseDir);
              const errorScreenshotFilePath = path.join(screenshotBaseDir, `step_navigation_load_error_${Date.now()}.png`);
              await page.screenshot({ type: 'png', path: errorScreenshotFilePath }).catch(err => resolvedLogger.warn("Failed to save error screenshot to file", err));
              errorNavScreenshotPath = errorScreenshotFilePath;
            } else {
              const errorScreenshotBuffer = await page.screenshot({ type: 'png' }).catch(() => null);
              errorNavScreenshotPath = errorScreenshotBuffer ? `data:image/png;base64,${errorScreenshotBuffer.toString('base64')}` : undefined;
            }
          }
          stepResults.push({ name: 'Load Page', type: 'navigation', status: 'failed', error: e.message, screenshot: errorNavScreenshotPath, details: `Failed to navigate to ${test.url}` });
          const duration = Date.now() - startTime;
          return { success: false, steps: stepResults, error: e.message, duration };
        }
      } else {
        stepResults.push({ name: 'Initial State', type: 'setup', status: 'passed', details: 'No initial URL provided.' });
      }

      if (overallSuccess && test.sequence && Array.isArray(test.sequence)) {
        resolvedLogger.debug({ message: `PS:executeTestSequence - Starting execution of ${test.sequence.length} steps`, testName: test.name });
        for (const step of test.sequence as TestStep[]) {
          let stepStatus: 'passed' | 'failed' = 'passed';
          let stepError: string | undefined;
          let stepScreenshot: string | undefined;
          const actionId = step.action?.id;
          const actionName = step.action?.name || 'Unnamed Action';
          resolvedLogger.verbose({ message: `PS:executeTestSequence - Executing step`, testName: test.name, actionName, actionId, selector: step.targetElement?.selector, value: step.value });

          try {
            if (!actionId) throw new Error('Step action ID is missing.');
            if (!page) throw new Error('Page is not available.');

            switch (actionId) {
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
              case 'assert':
                resolvedLogger.warn({ message: `Generic 'assert' action encountered in test sequence. Consider using specific assertions.`, testName: test.name, actionName, selector: step.targetElement?.selector });
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = 'Selector missing for generic assert action.';
                } else {
                  const elementToAssert = await page.locator(step.targetElement.selector).count();
                  if (elementToAssert === 0) { stepStatus = 'failed'; stepError = `Assertion Failed: Element "${step.targetElement.selector}" not found.`; }
                }
                break;
              case 'assertTextContains':
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for assertTextContains action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Expected text (value) missing or empty for assertTextContains action."; break; }
                const elementForText = page.locator(step.targetElement.selector);
                const actualText = await elementForText.textContent();
                if (actualText === null || !actualText.includes(step.value)) { stepStatus = 'failed'; stepError = `Assertion Failed: Element "${step.targetElement.selector}" did not contain text "${step.value}". Actual: "${actualText === null ? 'null' : actualText}".`; }
                break;
              case 'assertElementCount':
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for assertElementCount action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Expected count (value) missing or empty for assertElementCount action."; break; }
                const parsedAssertion = parseAssertionValue(step.value);
                if (!parsedAssertion) { stepStatus = 'failed'; stepError = `Invalid format for assertElementCount value: "${step.value}". Expected format like "==5", ">=2", or "3".`; break; }
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
                   default: stepStatus = 'failed'; stepError = `Unknown operator "${parsedAssertion.operator}" for assertElementCount.`; break;
                }
                 if (!countMatch && stepStatus === 'passed') { stepStatus = 'failed'; stepError = `Assertion Failed: Element count for selector "${step.targetElement.selector}" did not match. Expected ${parsedAssertion.operator} ${parsedAssertion.count}, Actual: ${actualCount}.`; }
                break;
              case 'hover':
                if (!step.targetElement?.selector) throw new Error('Selector missing for hover action.');
                await page.hover(step.targetElement.selector);
                break;
              case 'select':
                 if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for select action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Value missing for select action (expected option value)."; break; }
                await page.selectOption(step.targetElement.selector, step.value);
                break;
              default:
                throw new Error(`Unsupported action ID: ${actionId}`);
            }

            // Screenshot logic for successful step
            if (screenshotBaseDir) {
              await fs.ensureDir(screenshotBaseDir);
              // Sanitize actionName for use in filename
              const sanitizedActionName = actionName.replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);
              const screenshotFilePath = path.join(screenshotBaseDir, `step_${sanitizedActionName}_${Date.now()}.png`);
              await page.screenshot({ type: 'png', path: screenshotFilePath });
              stepScreenshot = screenshotFilePath;
            } else {
              const screenshotBuffer = await page.screenshot({ type: 'png' });
              stepScreenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
            }

          } catch (e: any) {
            stepStatus = 'failed';
            stepError = e.message;
            overallSuccess = false;
            resolvedLogger.error({ message: `Error in step "${actionName}"`, testName: test.name, testId: test.id, actionId, selector: step.targetElement?.selector, error: e.message, stack: e.stack });

            // Screenshot logic for failed step
            if (page && !page.isClosed()) {
              try {
                if (screenshotBaseDir) {
                  await fs.ensureDir(screenshotBaseDir);
                  const sanitizedActionName = actionName.replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);
                  const errorScreenshotFilePath = path.join(screenshotBaseDir, `step_${sanitizedActionName}_error_${Date.now()}.png`);
                  await page.screenshot({ type: 'png', path: errorScreenshotFilePath });
                  stepScreenshot = errorScreenshotFilePath;
                } else {
                  const errorScreenshotBuffer = await page.screenshot({ type: 'png' });
                  stepScreenshot = `data:image/png;base64,${errorScreenshotBuffer.toString('base64')}`;
                }
              } catch (screenError: any) {
                resolvedLogger.warn({ message: 'Failed to take screenshot on error', testName: test.name, actionName, error: screenError.message, stack: screenError.stack });
              }
            }
          }
          if (stepStatus === 'failed') overallSuccess = false;
          stepResults.push({ name: actionName, type: actionId || 'unknown', selector: step.targetElement?.selector, value: step.value, status: stepStatus, screenshot: stepScreenshot, error: stepError, details: stepStatus === 'passed' ? 'Action executed successfully.' : `Action failed: ${stepError || 'Unknown error'}` });
          if (!overallSuccess) {
            resolvedLogger.info({ message: `PS:executeTestSequence - Step failed. Stopping sequence execution.`, testName: test.name, failedStep: actionName });
            break;
          }
        }
      }

      const duration = Date.now() - startTime;
      resolvedLogger.info({ message: `Test "${test.name}" completed.`, testId: test.id, success: overallSuccess, durationMs: duration, stepsExecuted: stepResults.length });
      return { success: overallSuccess, steps: stepResults, duration };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      resolvedLogger.error({ message: `Critical error executing test "${test.name}"`, testId: test.id, userId, error: error.message, stack: error.stack });
      return { success: false, steps: stepResults, error: error.message || 'Unknown critical error', duration };
    } finally {
      resolvedLogger.debug({ message: "PS:executeTestSequence - Inside finally block", testName: test.name, testId: test.id });
      if (page) await page.close().catch(e => resolvedLogger.warn({ message: "Error closing page in finally", testName: test.name, error: e.message, stack: e.stack }));
      if (context) await context.close().catch(e => resolvedLogger.warn({ message: "Error closing context in finally", testName: test.name, error: e.message, stack: e.stack }));
      if (browser) await browser.close().catch(e => resolvedLogger.warn({ message: "Error closing browser in finally", testName: test.name, error: e.message, stack: e.stack }));
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