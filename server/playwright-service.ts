import playwright, { Browser, Page, BrowserContext } from 'playwright';
import { v4 as uuidv4 } from 'uuid'; // For generating session IDs
import loggerPromise from './logger';
import type { Logger as WinstonLogger } from 'winston';
import { storage } from './storage'; // To fetch user settings
import type { Test, Precondition } from '@shared/schema'; // Import Test and UserSettings type
import { type RecordedAction, RecordedActionSchema } from '@shared/recording';
import { RECORDER_SCRIPT } from './recorder-script';
import { runPreconditions } from './precondition-runner';
import fs from 'fs-extra';
import path from 'path';
import { PlaywrightReporter } from './playwright-reporter';
import { browserPool } from './browser-pool';
import { getWsEmitter } from './websocket';
import { allowsSelfSignedCertificate, substituteVariables, requestVariables } from './outbound-http';

// Default settings if not found or incomplete
const DEFAULT_BROWSER: 'chromium' | 'firefox' | 'webkit' = 'chromium';
const DEFAULT_HEADLESS = true;
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_WAIT_TIME = 2000;

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
    fallbackLogger.error("PlaywrightService: Failed to initialize Winston logger. Falling back to console.", { error: error.message, stack: error.stack });
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
  text?: string | null;
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
  value?: string | null;
}

export interface StepResult {
  name: string;
  type: string;
  selector?: string | null;
  value?: string | null;
  status: 'passed' | 'failed';
  screenshot?: string;
  error?: string;
  details: string;
  healed?: boolean;
  rca?: string;
}

// Interface for the ad-hoc sequence payload
interface AdhocSequencePayload {
  url: string;
  sequence: TestStep[];
  elements: DetectedElement[]; // Currently for context, not actively used in loop logic by default
  name?: string;
  /** Same setup calls the scheduled runner performs, so the preview matches the real run. */
  preconditions?: Precondition[] | null;
}

interface ActiveSession {
  page: Page;
  browser: Browser;
  context: BrowserContext;
  actions: RecordedAction[];
  userId?: number; // Store the user ID associated with the session
  targetUrl: string; // The initial URL the recording started on
  pageClosedByEventHandler?: boolean; // Flag to indicate if page was closed by event handler
  lastActivityAt: number; // Drives the idle sweeper
}

/** Idle recording sessions are reaped so an abandoned browser cannot leak forever. */
const RECORDING_SESSION_IDLE_MS = 30 * 60 * 1000;
const RECORDING_SWEEP_INTERVAL_MS = 60 * 1000;
/** Hard cap on buffered actions: the page can call the binding as often as it likes. */
const MAX_RECORDED_ACTIONS = 2000;
/**
 * A navigation that lands within this window after a click/keypress is a *consequence* of
 * that interaction, so replaying it as its own goto() would be redundant (and would turn a
 * POST-redirect result into a plain GET). Standalone navigations are still recorded.
 */
const IMPLICIT_NAVIGATION_WINDOW_MS = 3000;

export class PlaywrightService {
  private activeSessions: Map<string, ActiveSession> = new Map();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  // Removing shared browser instance to allow per-execution settings
  // private browser: Browser | null = null;
  // private context: BrowserContext | null = null;

  // initialize and close methods might need to be re-evaluated if a shared browser is ever re-introduced.
  // For now, each major function will manage its own browser lifecycle.

  async loadWebsite(url: string, userId?: number): Promise<{ success: boolean; screenshot?: string; html?: string; error?: string }> {
    resolvedLogger.http({ message: "PlaywrightService: loadWebsite called", url, userId });
    const targetUrl = substituteVariables(url);
    let browser: Browser | null = null;
    try {
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      const browserType = userSettings?.playwrightBrowser || DEFAULT_BROWSER;
      const headlessMode = userSettings?.playwrightHeadless !== undefined ? userSettings.playwrightHeadless : DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      const effectiveWaitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME;
      resolvedLogger.debug({ message: "PS:loadWebsite - Effective settings", browserType, headlessMode, pageTimeout, effectiveWaitTime, userId });

      const browserEngine = (playwright as any)[browserType];
      if (!browserEngine) throw new Error(`Invalid browser type: ${browserType}`);
      browser = await browserEngine.launch({ headless: headlessMode });
      if (!browser) throw new Error("Failed to launch browser instance.");
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'; // Standardized UA
      const context = await browser.newContext({ userAgent, ignoreHTTPSErrors: allowsSelfSignedCertificate(targetUrl) });
      const page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);

      await page.setViewportSize({ width: 1280, height: 720 });
      // Removed page.setUserAgent, as it's set on context

      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        // timeout is already set by setDefaultTimeout
      });

      // SPA frameworks (Angular/DevExpress, React, …) render their content after
      // domcontentloaded, so a fixed short wait captures an empty shell. Wait for the
      // network to go idle first; if it never settles (long-polling/websockets), fall
      // back to the fixed wait rather than failing.
      await page.waitForLoadState('networkidle', { timeout: pageTimeout }).catch(() => {
        resolvedLogger.debug({ message: "PS:loadWebsite - networkidle not reached, proceeding after fixed wait", url });
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

  /**
   * Buffers one action coming from the in-page recorder.
   *
   * Everything crossing this boundary is produced by JavaScript running inside the page
   * under test, so it is schema-validated and capped rather than trusted.
   */
  private pushAction(sessionId: string, raw: unknown): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      resolvedLogger.warn({ message: "PS:pushAction - Action received for non-existent session", sessionId });
      return;
    }

    const parsed = RecordedActionSchema.safeParse(raw);
    if (!parsed.success) {
      resolvedLogger.warn({ message: "PS:pushAction - Discarded malformed action from page", sessionId, issues: parsed.error.flatten() });
      return;
    }

    const action = parsed.data;
    action.timestamp = Date.now();
    if (!action.url && session.page && !session.page.isClosed()) {
      action.url = session.page.url();
    }
    session.lastActivityAt = action.timestamp;

    if (action.type === 'navigate' && this.isRedundantNavigation(session, action)) {
      resolvedLogger.verbose({ message: "PS:pushAction - Skipped redundant navigation", sessionId, url: action.url });
      return;
    }

    if (session.actions.length >= MAX_RECORDED_ACTIONS) {
      resolvedLogger.warn({ message: "PS:pushAction - Action buffer full, dropping action", sessionId, cap: MAX_RECORDED_ACTIONS });
      return;
    }

    session.actions.push(action);
    resolvedLogger.verbose({ message: "PS:pushAction - Action recorded", sessionId, actionType: action.type, total: session.actions.length });
  }

  /**
   * True when a navigation should not become its own replay step: either it repeats the URL
   * we are already on, or it is the direct consequence of the interaction just recorded.
   */
  private isRedundantNavigation(session: ActiveSession, action: RecordedAction): boolean {
    const previous = [...session.actions].reverse().find(a => !a.meta);
    if (!previous) {
      // First real action: the initial page load is already implied by the test's own URL.
      return true;
    }
    if (previous.type === 'navigate' && previous.url === action.url) return true;
    if (
      (previous.type === 'click' || previous.type === 'keypress') &&
      action.timestamp - previous.timestamp < IMPLICIT_NAVIGATION_WINDOW_MS
    ) {
      return true;
    }
    return false;
  }

  /** Starts the idle sweeper on demand; it never keeps the process alive on its own. */
  private ensureSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      void this.sweepIdleSessions();
    }, RECORDING_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  private stopSweeperIfIdle(): void {
    if (this.activeSessions.size === 0 && this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private async sweepIdleSessions(): Promise<void> {
    const now = Date.now();
    for (const [sessionId, session] of [...this.activeSessions.entries()]) {
      if (now - session.lastActivityAt < RECORDING_SESSION_IDLE_MS) continue;
      resolvedLogger.warn({ message: "PS:sweepIdleSessions - Reaping idle recording session", sessionId, idleMs: now - session.lastActivityAt });
      await this.disposeSessionResources(session, sessionId);
      this.activeSessions.delete(sessionId);
    }
    this.stopSweeperIfIdle();
  }

  /** Closes page/context/browser of a session, never throwing. */
  private async disposeSessionResources(session: ActiveSession, sessionId: string): Promise<void> {
    if (session.page && !session.page.isClosed()) {
      await session.page.close().catch(e => resolvedLogger.warn({ message: "PS:disposeSessionResources - Error closing page", sessionId, error: e.message }));
    }
    if (session.context) {
      await session.context.close().catch(e => resolvedLogger.warn({ message: "PS:disposeSessionResources - Error closing context", sessionId, error: e.message }));
    }
    if (session.browser && session.browser.isConnected()) {
      await session.browser.close().catch(e => resolvedLogger.warn({ message: "PS:disposeSessionResources - Error closing browser", sessionId, error: e.message }));
    }
  }

  /** Stops the sweeper and tears down every live session. Used on shutdown and in tests. */
  async disposeAllRecordingSessions(): Promise<void> {
    for (const [sessionId, session] of [...this.activeSessions.entries()]) {
      await this.disposeSessionResources(session, sessionId);
      this.activeSessions.delete(sessionId);
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * Installs the recorder into a browser context.
   *
   * Both the binding and the script go on the CONTEXT, before any page exists, so they apply
   * to every document and every tab — including ones the site opens itself. The previous
   * `page.addScriptTag()` only lived in the first document and died on the first navigation.
   *
   * Exposed (rather than inlined in startRecordingSession) so the integration test can drive
   * the exact same wiring headlessly; recording sessions themselves are always headed.
   */
  async installRecorder(context: BrowserContext, sessionId: string): Promise<void> {
    await context.exposeBinding('__wfmRecordAction', (_source, action: unknown) => {
      this.pushAction(sessionId, action);
    });
    await context.addInitScript({ content: RECORDER_SCRIPT });
  }

  /** Registers a session record without launching a browser. Used by installRecorder callers. */
  registerSession(sessionId: string, session: Omit<ActiveSession, 'actions' | 'lastActivityAt'> & Partial<Pick<ActiveSession, 'actions'>>): void {
    this.activeSessions.set(sessionId, {
      actions: session.actions ?? [],
      lastActivityAt: Date.now(),
      ...session,
    } as ActiveSession);
  }

  async startRecordingSession(url: string, userId?: number): Promise<{ success: boolean, sessionId?: string, error?: string }> {
    resolvedLogger.http({ message: "PlaywrightService: startRecordingSession called", url, userId });
    const targetUrl = substituteVariables(url);
    const sessionId = uuidv4();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    let browserType: 'chromium' | 'firefox' | 'webkit' = DEFAULT_BROWSER; // Defined here for catch-block visibility

    try {
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      browserType = (userSettings?.playwrightBrowser as any) || DEFAULT_BROWSER;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      const specificWaitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME;
      // Recording is interactive by definition: the user drives a real, visible window.
      const effectiveHeadlessMode = false;
      resolvedLogger.debug({ message: "PS:startRecordingSession - Effective settings", sessionId, browserType, effectiveHeadlessMode, pageTimeout, specificWaitTime });

      const browserEngine = (playwright as any)[browserType];
      if (!browserEngine) throw new Error(`Invalid browser type: ${browserType}`);
      browser = await browserEngine.launch({ headless: effectiveHeadlessMode });
      if (!browser) throw new Error("Failed to launch browser for recording.");

      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: allowsSelfSignedCertificate(targetUrl)
      });

      await this.installRecorder(context, sessionId);

      page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);

      const sessionData: ActiveSession = {
        browser,
        context,
        page,
        actions: [],
        userId,
        targetUrl: url,
        lastActivityAt: Date.now(),
      };
      // Registered before navigating, so actions fired during the initial load are not lost.
      this.activeSessions.set(sessionId, sessionData);
      sessionData.actions.push({
        type: 'navigate',
        url: targetUrl,
        value: targetUrl,
        timestamp: Date.now(),
        meta: 'session-started',
      });
      this.ensureSweeper();

      // When the user closes the last tab the session is over, even if Stop was never pressed.
      const markClosedIfLastPage = () => {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;
        const stillOpen = session.context.pages().filter(p => !p.isClosed());
        if (stillOpen.length === 0) {
          session.pageClosedByEventHandler = true;
          resolvedLogger.info({ message: "PS:startRecordingSession - All pages closed; session marked as ended", sessionId });
        }
      };
      context.on('page', newPage => {
        newPage.on('close', markClosedIfLastPage);
      });
      page.on('close', markClosedIfLastPage);

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(specificWaitTime);
      await page.bringToFront();

      resolvedLogger.info({ message: "PS:startRecordingSession - Recording session started successfully", sessionId, url, userId: userId || 'anonymous' });
      return { success: true, sessionId };

    } catch (error: any) {
      let stage = "unknown";
      if (!browser) stage = `browser launch (type: ${browserType})`;
      else if (!context) stage = "browser context creation";
      else if (!page) stage = "page creation";
      else if (page.isClosed()) stage = "page operation on closed page";
      else stage = "page navigation/setup";

      resolvedLogger.error({ message: "PS:startRecordingSession - CRITICAL ERROR during session setup", sessionId, stage, url, error: error.message, stack: error.stack });

      if (browser && browser.isConnected()) {
        await browser.close().catch(err => resolvedLogger.error({ message: "PS:startRecordingSession - Failed to close browser during error handling", sessionId, error: err.message }));
      }
      this.activeSessions.delete(sessionId);
      this.stopSweeperIfIdle();
      return { success: false, error: `Failed during ${stage}: ${error.message}` };
    }
  }

  async stopRecordingSession(sessionId: string, userId?: number): Promise<{ success: boolean, sequence?: RecordedAction[], error?: string }> {
    resolvedLogger.http({ message: "PlaywrightService: stopRecordingSession called", sessionId, userId });
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      resolvedLogger.warn({ message: "PS:stopRecordingSession - Session not found or already stopped.", sessionId, userId });
      return { success: false, error: "Recording session not found or already stopped." };
    }

    if (userId && session.userId && session.userId !== userId) {
      resolvedLogger.warn({ message: "User ID mismatch attempting to stop session", sessionId, requestUserId: userId, sessionUserId: session.userId });
      return { success: false, error: "Unauthorized to stop this recording session." };
    }

    try {
      const pageOpen = !!session.page && !session.page.isClosed();
      const lastUrl = pageOpen
        ? session.page.url()
        : ([...session.actions].reverse().find(a => a.url)?.url ?? session.targetUrl);

      session.actions.push({
        type: 'navigate',
        url: lastUrl,
        value: lastUrl,
        timestamp: Date.now(),
        meta: 'session-stopped',
      });

      await this.disposeSessionResources(session, sessionId);

      const recordedActions = session.actions;
      const userActionCount = recordedActions.filter(a => !a.meta).length;
      if (userActionCount === 0) {
        resolvedLogger.warn({ message: "PS:stopRecordingSession - Session stopped without any user action.", sessionId });
      }

      this.activeSessions.delete(sessionId);
      this.stopSweeperIfIdle();
      resolvedLogger.info({ message: "PS:stopRecordingSession - Session finalized.", sessionId, actionCount: recordedActions.length, userActionCount });

      return { success: true, sequence: recordedActions };

    } catch (error: any) {
      resolvedLogger.error({ message: "PS:stopRecordingSession - CRITICAL error during stop sequence", sessionId, error: error.message, stack: error.stack });
      this.activeSessions.delete(sessionId);
      this.stopSweeperIfIdle();
      return { success: false, error: error.message || `Unknown error stopping recording session ${sessionId}` };
    }
  }

  async getRecordedActions(sessionId: string, userId?: number): Promise<{ success: boolean, sequence?: RecordedAction[], error?: string, sessionEnded?: boolean }> {
    const session = this.activeSessions.get(sessionId);
    resolvedLogger.debug({ message: "PS:getRecordedActions called", sessionId, userId, sessionFound: !!session });

    if (!session) {
      return { success: false, sessionEnded: true, error: "Recording session not found or already stopped." };
    }

    if (userId && session.userId && session.userId !== userId) {
      resolvedLogger.warn({ message: "User ID mismatch attempting to get actions for session", sessionId, requestUserId: userId, sessionUserId: session.userId });
      return { success: false, error: "Unauthorized to access this recording session." };
    }

    // The browser window was closed without pressing Stop: hand back what we buffered and
    // tell the client to stop polling instead of letting it spin against a dead session.
    if (session.pageClosedByEventHandler) {
      return {
        success: true,
        sequence: [...session.actions],
        sessionEnded: true,
        error: "The recording browser window was closed.",
      };
    }

    return { success: true, sequence: [...session.actions] };
  }

  /**
   * Scans the current page for interactive elements and returns them with GUARANTEED
   * unique CSS selectors (id → stable attribute → non-transient class combo → nth-of-type
   * structural path). Single source of truth for element detection — used by both
   * detectElements() and the post-run detection inside executeAdhocSequence(), so the two
   * never drift apart (previously they did: execution produced non-unique class selectors
   * like `button.mat-mdc-menu-item`, which Playwright could not click unambiguously).
   */
  private async detectElementsOnPage(page: Page): Promise<DetectedElement[]> {
    return await page.evaluate(() => {
      // esbuild/tsx (keepNames) wraps named functions in `__name(fn, "…")`; that helper only
      // exists in the Node bundle, so provide a harmless identity shim for the browser page.
      (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);

      const interactiveSelectors = ['input:not([type="hidden"])', 'button', 'a[href]', 'select', 'textarea', '[onclick]', '[role="button"]', '[tabindex]:not([tabindex="-1"])', 'h1, h2, h3, h4, h5, h6', 'img[alt]', 'form', '[data-testid]', '[data-test]'];

      const isUnique = (sel: string) => {
        try { return document.querySelectorAll(sel).length === 1; } catch { return false; }
      };

      const structuralPath = (el: Element): string => {
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
          if (node.id && isUnique(`#${CSS.escape(node.id)}`)) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
          let part = node.tagName.toLowerCase();
          const parent: Element | null = node.parentElement;
          if (parent) {
            const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
            if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
          }
          parts.unshift(part);
          node = parent;
        }
        return parts.join(' > ');
      };

      const buildUniqueSelector = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        if (el.id && isUnique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
        for (const attr of ['data-testid', 'data-test', 'name', 'aria-label']) {
          const v = el.getAttribute(attr);
          if (v) { const s = `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`; if (isUnique(s)) return s; }
        }
        if (typeof el.className === 'string' && el.className.trim()) {
          const classes = el.className.split(/\s+/).filter((c) =>
            c && !/[:()[\]/.]/.test(c) && !/^(ng|cdk)-/.test(c) && !/(focus|active|hover|selected|touched|dirty|pristine)/i.test(c));
          for (let n = classes.length; n >= 1; n--) {
            const s = `${tag}.${classes.slice(0, n).join('.')}`;
            if (isUnique(s)) return s;
          }
        }
        return structuralPath(el);
      };

      const detectedElements: any[] = [];
      const seen = new Set<Element>();
      let globalElementCounter = 0;
      interactiveSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((element, index) => {
          if (seen.has(element)) return; // an element can match several selectors — keep one entry
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
            seen.add(element);
            const tagName = element.tagName.toLowerCase();
            const text = element.textContent?.trim() || '';
            const placeholder = element.getAttribute('placeholder') || '';
            const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`;
            const uniqueSelector = buildUniqueSelector(element);
            let elementType = 'element';
            if (tagName === 'input') elementType = element.getAttribute('type') || 'input';
            else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button';
            else if (tagName === 'a') elementType = 'link';
            else if (tagName.match(/h[1-6]/)) elementType = 'heading';
            else if (tagName === 'select') elementType = 'select';
            else if (tagName === 'textarea') elementType = 'textarea';
            const attributes: Record<string, string> = {};
            Array.from(element.attributes).forEach((attr: any) => { attributes[attr.name] = attr.value; });
            detectedElements.push({
              id: `elem-${tagName}-${globalElementCounter++}`,
              type: elementType,
              selector: uniqueSelector,
              text: displayText.substring(0, 100),
              tag: tagName,
              attributes,
              boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
            });
          }
        });
      });
      return detectedElements.slice(0, 50) as DetectedElement[];
    });
  }

  async executeAdhocSequence(payload: AdhocSequencePayload, userId: number): Promise<{ success: boolean; steps?: StepResult[]; error?: string; duration?: number; detectedElements?: DetectedElement[] }> {
    const testName = payload.name || "Ad-hoc Test";
    resolvedLogger.http({ message: "PlaywrightService: executeAdhocSequence called", testName, userId, url: payload.url });
    const targetUrl = payload.url ? substituteVariables(payload.url) : payload.url;
    const startTime = Date.now();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    resolvedLogger.debug({ message: "PS:executeAdhocSequence - Initial state", testName, userId });
    const stepResults: StepResult[] = [];
    let overallSuccess = true;

    try {
      // Preconditions run before the browser is even launched, exactly as the scheduled
      // runner does it (see test-execution-service). Fail-fast: a broken setup call makes
      // the run blocked, never a misleading pass or a confusing mid-sequence failure.
      if (payload.preconditions && payload.preconditions.length > 0) {
        const preResult = await runPreconditions(payload.preconditions, requestVariables());
        if (!preResult.ok) {
          const reason = `Precondition failed at "${preResult.failedAt}": ${preResult.reason}`;
          resolvedLogger.warn({ message: "PS:executeAdhocSequence - Blocked by precondition", testName, userId, failedAt: preResult.failedAt, reason: preResult.reason });
          return {
            success: false,
            error: reason,
            duration: Date.now() - startTime,
            detectedElements: [],
            steps: [{
              name: `Precondition: ${preResult.failedAt ?? 'setup'}`,
              type: 'precondition',
              status: 'failed',
              error: preResult.reason,
              details: reason,
            }],
          };
        }
        stepResults.push({
          name: 'Preconditions',
          type: 'precondition',
          status: 'passed',
          details: `${preResult.ranCount} setup call(s) completed.`,
        });
      }

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
      const browserEngine = (playwright as any)[browserType];
      if (!browserEngine) throw new Error(`Invalid browser type: ${browserType}`);
      browser = await browserEngine.launch(browserLaunchOptions);
      if (!browser) throw new Error("Failed to launch browser instance.");
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Browser launched", testName, connected: browser?.isConnected(), type: browser?.browserType?.().name() });

      const contextOptions = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: allowsSelfSignedCertificate(targetUrl ?? '')
      };
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

      if (targetUrl) {
        const gotoOptions = { waitUntil: 'domcontentloaded' as const };
        resolvedLogger.debug({ message: `PS:executeAdhocSequence - Navigating to URL`, testName, url: targetUrl, options: gotoOptions, pageClosed: page?.isClosed() });
        try {
          await page.goto(targetUrl, gotoOptions);
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
              finalDetectedElementsNavFail = await this.detectElementsOnPage(page);
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
                // Values go through variable substitution so a recorded password field —
                // which is stored as a `{{secret_…}}` placeholder, never in clear text —
                // resolves from the environment at replay time.
                await page.fill(step.targetElement.selector, substituteVariables(step.value));
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
              case 'navigate': {
                // Only standalone navigations reach here: ones implied by a click are filtered
                // out while recording (see isRedundantNavigation).
                const destination = typeof step.value === 'string' ? step.value.trim() : '';
                if (!destination) throw new Error('URL (value) missing for navigate action.');
                await page.goto(substituteVariables(destination), { waitUntil: 'domcontentloaded' });
                break;
              }
              case 'assert': {
                // "Element is visible" — the assertion the recorder emits when the user picks
                // the visibility check in the in-page assert panel.
                if (!step.targetElement?.selector) {
                  stepStatus = 'failed'; stepError = 'Selector missing for visibility assert action.';
                  break;
                }
                const target = page.locator(step.targetElement.selector).first();
                const isVisible = await target.isVisible().catch(() => false);
                if (!isVisible) {
                  stepStatus = 'failed';
                  stepError = `Assertion Failed: Element "${step.targetElement.selector}" is not visible.`;
                }
                break;
              }
              case 'assertTextContains': {
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for assertTextContains action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Expected text (value) missing or empty for assertTextContains action."; break; }
                const elementForText = page.locator(step.targetElement.selector);
                const actualText = await elementForText.textContent();
                if (actualText === null || !actualText.includes(step.value)) { stepStatus = 'failed'; stepError = `Assertion Failed: Element "${step.targetElement.selector}" did not contain text "${step.value}". Actual: "${actualText === null ? 'null' : actualText}".`; }
                break;
              }
              case 'assertElementCount': {
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
              }
              case 'hover':
                if (!step.targetElement?.selector) throw new Error('Selector missing for hover action.');
                await page.hover(step.targetElement.selector);
                break;
              case 'select':
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for select action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Value missing for select action (expected option value)."; break; }
                await page.selectOption(step.targetElement.selector, substituteVariables(step.value));
                break;
              default:
                throw new Error(`Unsupported action ID: ${actionId}`);
            }
            // Let the UI settle before capturing: a click often dismisses a menu and opens a
            // dialog with an animation, and may fire XHRs. Without this the screenshot catches a
            // mid-transition frame (old menu overlapping a half-open dialog).
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(600);
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
          finalDetectedElements = await this.detectElementsOnPage(page);
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
          finalDetectedElementsCriticalError = await this.detectElementsOnPage(page);
        } catch (detectionError: any) {
          resolvedLogger.warn({ message: `PS:executeAdhocSequence - Error during element detection (critical error path)`, testName, error: detectionError.message, stack: detectionError.stack });
        }
      }
      return { success: false, steps: stepResults, error: error.message || 'Unknown critical error during ad-hoc execution', duration, detectedElements: finalDetectedElementsCriticalError };
    } finally {
      resolvedLogger.debug({ message: "PS:executeAdhocSequence - Inside finally block.", testName });
      resolvedLogger.verbose({ message: "PS:executeAdhocSequence (finally) - State before closing page", testName, pageExists: !!page, pageClosed: page?.isClosed() });
      if (page && !page.isClosed()) {
        resolvedLogger.debug({ message: "PS:executeAdhocSequence - Closing page", testName });
        await page.close();
      }
      resolvedLogger.verbose({ message: "PS:executeAdhocSequence (finally) - State before closing context", testName, contextExists: !!context });
      if (context) {
        resolvedLogger.debug({ message: "PS:executeAdhocSequence - Closing context", testName });
        await context.close();
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
    const targetUrl = substituteVariables(url);
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
      const browserEngine = (playwright as any)[browserType];
      if (!browserEngine) throw new Error(`Invalid browser type: ${browserType}`);
      browser = await browserEngine.launch({ headless: headlessMode });
      if (!browser) throw new Error("Failed to launch browser instance for detectElements.");

      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      resolvedLogger.debug({ message: "PS:detectElements - Attempting to create new browser context", userAgent });
      context = await browser.newContext({ userAgent, ignoreHTTPSErrors: allowsSelfSignedCertificate(targetUrl) });

      resolvedLogger.debug({ message: "PS:detectElements - Attempting to create new page" });
      page = await context.newPage();

      resolvedLogger.debug({ message: "PS:detectElements - Setting default timeout", pageTimeout });
      page.setDefaultTimeout(pageTimeout);

      resolvedLogger.debug({ message: "PS:detectElements - Setting viewport size" });
      await page.setViewportSize({ width: 1280, height: 720 });

      resolvedLogger.debug({ message: `PS:detectElements - Navigating to URL`, url: targetUrl, pageClosed: page?.isClosed() });
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      // SPA content (Angular/DevExpress, React, …) mounts after domcontentloaded. Wait
      // for the network to settle so the DOM is populated before we query it; fall back
      // to the fixed wait if it never idles (long-polling/websockets).
      await page.waitForLoadState('networkidle', { timeout: pageTimeout }).catch(() => {
        resolvedLogger.debug({ message: "PS:detectElements - networkidle not reached, proceeding after fixed wait", url });
      });
      const waitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME;
      resolvedLogger.debug({ message: `PS:detectElements - Waiting for timeout`, waitTime, pageClosed: page?.isClosed() });
      await page.waitForTimeout(waitTime);

      let elements: DetectedElement[] = [];
      try {
        elements = await this.detectElementsOnPage(page);
      } catch (evalError: any) {
        resolvedLogger.warn({ message: "PS:detectElements - Evaluation failed", error: evalError.message });
      }
      resolvedLogger.info({ message: `PS:detectElements - Element detection script completed.`, foundCount: elements?.length, url, userId });

      return elements;
    } catch (error: any) {
      resolvedLogger.error({ message: "PS:detectElements - Error caught during element detection", url, userId, error: error.message, stack: error.stack, pageExists: !!page, pageClosed: page?.isClosed() });
      throw error;
    } finally {
      resolvedLogger.debug({ message: "PS:detectElements - Inside finally block.", url, userId });
      resolvedLogger.verbose({ message: "PS:detectElements (finally) - State before closing page", url, pageExists: !!page, pageClosed: page?.isClosed() });
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
    screenshotBaseDir?: string, // Optional base directory for screenshots
    executionId?: string // Optional execution ID for real-time logging
  ): Promise<{ success: boolean; steps?: StepResult[]; error?: string; duration?: number }> {
    const startTime = Date.now();
    const wsEmitter = getWsEmitter();
    resolvedLogger.http({ message: "PlaywrightService: executeTestSequence called", testName: test.name, testId: test.id, userId, testUrl: test.url, screenshotBaseDir });
    const targetUrl = test.url ? substituteVariables(test.url) : test.url;
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

      const browserEngine = (playwright as any)[browserType];
      if (!browserEngine) throw new Error(`Invalid browser type: ${browserType}`);
      browser = await browserEngine.launch({ headless: headlessMode });
      if (!browser) throw new Error("Failed to launch browser for executeApiDirect.");
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      context = await browser.newContext({ userAgent, ignoreHTTPSErrors: allowsSelfSignedCertificate(targetUrl ?? '') });
      page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);
      await page.setViewportSize({ width: 1280, height: 720 });

      if (targetUrl) {
        try {
          const navMessage = `Navigating to ${targetUrl}`;
          resolvedLogger.debug({ message: "PS:executeTestSequence - " + navMessage, testName: test.name, url: targetUrl });
          if (executionId) {
            wsEmitter.emitExecutionLog(executionId, {
              level: 'step',
              source: 'playwright',
              message: navMessage,
              timestamp: new Date().toISOString(),
              metadata: { url: targetUrl }
            });
          }
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
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

      const reporter = new PlaywrightReporter(page); // Initialize reporter

      if (overallSuccess && test.sequence && Array.isArray(test.sequence)) {
        resolvedLogger.debug({ message: `PS:executeTestSequence - Starting execution of ${test.sequence.length} steps`, testName: test.name });

        for (const [i, step] of (test.sequence as TestStep[]).entries()) {
          let stepStatus: 'passed' | 'failed' = 'passed';
          let stepError: string | undefined;
          let stepScreenshot: string | undefined;
          const actionId = step.action?.id;
          const actionName = step.action?.name || 'Unnamed Action';

          // Set context for AI Healing
          reporter.setContext(test.id, i);

          reporter.resetStepState();

          const stepLogMessage = `Executing step ${i + 1}: ${actionName}`;
          if (executionId) {
            wsEmitter.emitExecutionLog(executionId, {
              level: 'step',
              source: 'playwright',
              message: stepLogMessage,
              timestamp: new Date().toISOString(),
              metadata: { action: actionName, stepIndex: i, selector: step.targetElement?.selector }
            });
          }

          try {
            if (!actionId) throw new Error('Step action ID is missing.');

            switch (actionId) {
              case 'click':
                if (!step.targetElement?.selector) throw new Error('Selector missing for click action.');
                await reporter.click(step.targetElement.selector, actionName);
                break;
              case 'input':
                if (!step.targetElement?.selector) throw new Error('Selector missing for input action.');
                await reporter.fill(step.targetElement.selector, typeof step.value === 'string' ? step.value : '', actionName);
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
                if (!step.targetElement?.selector) {
                  stepStatus = 'failed'; stepError = 'Selector missing for generic assert action.';
                } else {
                  const elementToAssert = await page.locator(step.targetElement.selector).count();
                  if (elementToAssert === 0) { stepStatus = 'failed'; stepError = `Assertion Failed: Element "${step.targetElement.selector}" not found.`; }
                }
                break;
              case 'assertTextContains': {
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for assertTextContains action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Expected text (value) missing or empty for assertTextContains action."; break; }
                const elementForText = page.locator(step.targetElement.selector);
                const actualText = await elementForText.textContent();
                if (actualText === null || !actualText.includes(step.value)) { stepStatus = 'failed'; stepError = `Assertion Failed: Element "${step.targetElement.selector}" did not contain text "${step.value}". Actual: "${actualText === null ? 'null' : actualText}".`; }
                break;
              }
              case 'assertElementCount': {
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
              }
              case 'hover':
                if (!step.targetElement?.selector) throw new Error('Selector missing for hover action.');
                await page.hover(step.targetElement.selector);
                break;
              case 'select':
                if (!step.targetElement?.selector) { stepStatus = 'failed'; stepError = "Selector missing for select action."; break; }
                if (typeof step.value !== 'string' || step.value.trim() === '') { stepStatus = 'failed'; stepError = "Value missing for select action (expected option value)."; break; }
                await page.selectOption(step.targetElement.selector, substituteVariables(step.value));
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
            resolvedLogger.error({ message: `Error in step "${actionName}"`, error: e.message });

            // Reporter likely already captured screenshot on error inside its methods
            // But we can ensure it here if we want to update the result object
          }

          if (stepStatus === 'failed') overallSuccess = false;
          stepResults.push({
            name: actionName,
            type: actionId || 'unknown',
            status: stepStatus,
            screenshot: stepScreenshot,
            error: stepError,
            details: stepStatus === 'passed' ? 'Success' : stepError || 'Failed',
            healed: reporter.lastActionHealed,
            rca: reporter.lastActionRca
          });

          if (!overallSuccess) break;
        }
      }

      const duration = Date.now() - startTime;
      return { success: overallSuccess, steps: stepResults, duration };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      return { success: false, steps: stepResults, error: error.message || 'Unknown critical error', duration };
    } finally {
      if (page) await page.close().catch(() => { });
      if (context) await context.close().catch(() => { });
      if (browser) await (await browserPool).release(browser);
    }
  }
}

// Removed shared browser instance, so global close might not be needed or needs rethink
// async close() {
// No shared browser or context to close here anymore.
// }


export const playwrightService = new PlaywrightService();

// Cleanup on process exit - this might not be effective for browsers launched per-function
// Consider if this is still needed or how to manage orphaned browser processes if any.
// process.on('SIGINT', () => playwrightService.close());
// process.on('SIGTERM', () => playwrightService.close());