import playwright, { Browser, Page, BrowserContext, Frame } from 'playwright';
import { v4 as uuidv4 } from 'uuid'; // For generating session IDs
import loggerPromise from './logger';
import type { Logger as WinstonLogger } from 'winston';
import { storage } from './storage'; // To fetch user settings
import type { Test, Precondition } from '@shared/schema'; // Import Test and UserSettings type
import { type RecordedAction, RecordedActionSchema } from '@shared/recording';
import { RECORDER_SCRIPT } from './recorder-script';
import { runPreconditions } from './precondition-runner';
import { recordRunnerFailure } from './observability/taps/runner';
import fs from 'fs-extra';
import path from 'path';
import { PlaywrightReporter } from './playwright-reporter';
import { browserPool } from './browser-pool';
import { getWsEmitter } from './websocket';
import { allowsSelfSignedCertificate, substituteVariables, requestVariables } from './outbound-http';
import { executeStep } from './step-executor';
import { resolveVariables } from './variables';
import { loadLoginState, saveLoginState, type EnvironmentScope } from './login-state';

// Default settings if not found or incomplete
const DEFAULT_BROWSER: 'chromium' | 'firefox' | 'webkit' = 'chromium';
const DEFAULT_HEADLESS = true;
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_WAIT_TIME = 2000;

/**
 * How many detected elements to return.
 *
 * Was a hard-coded 50, which is plenty for a landing page and a fraction of a DMO grid —
 * and it truncated silently, so the Detected Elements panel looked complete while missing
 * most of the page. The cap still exists (an unbounded list would be unusable in the UI and
 * slow to verify), but it is raised, configurable, and reported: see lastDetectionSummary.
 */
function detectionLimit(): number {
  const configured = parseInt(process.env.ELEMENT_DETECTION_LIMIT || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 300;
}

/** What a detection run found, so a caller can tell the user it was truncated. */
export interface DetectionSummary {
  totalFound: number;
  returned: number;
  truncated: boolean;
  pageSize: { width: number; height: number };
}

/**
 * A detection run: the elements, and the picture the highlighting is drawn on.
 *
 * The screenshot belongs here rather than coming from loadWebsite() because the two used to
 * be separate browser sessions with separate navigations. On any page that renders
 * differently twice — a carousel, a grid ordered by time, anything with an ad — the image
 * and the boxes described two different pages, and the highlight landed on the wrong
 * element. It is full-page so that an element below the fold is on the image at all.
 */
export interface DetectionResult {
  elements: DetectedElement[];
  screenshot: string;
  summary: DetectionSummary;
}

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

export interface DetectedElement { // Exporting if it's used elsewhere, or keep private
  id: string;
  type: string;
  selector: string;
  /**
   * The iframe chain this element's selector is relative to, ' >> ' separated, or absent
   * for the top document.
   *
   * page.locator() does not cross an iframe boundary, so an element inside one needs both
   * halves to be reachable: which frame, and where in it. Without this the element was not
   * merely unclickable — detection never saw it, which reads as the page not having it.
   */
  frameSelector?: string | null;
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
  /** Environment whose secrets resolve `{{name}}` placeholders, as picked in the builder. */
  environmentId?: number | null;
  /** Organization the environment must belong to — set by the route, never by the client. */
  organizationId?: number;
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

/**
 * Collects the interactive elements of ONE document — a frame, not necessarily the page.
 *
 * Module-level because it is now run once per frame rather than once per page: an element
 * inside an iframe was invisible to detection entirely, since page.evaluate only reaches the
 * top document and page.locator does not cross the boundary either.
 */
function collectCandidatesInFrame() {
    // esbuild/tsx (keepNames) wraps named functions in `__name(fn, "…")`; that helper only
    // exists in the Node bundle, so provide a harmless identity shim for the browser page.
    (globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn);

    const interactiveSelectors = ['input:not([type="hidden"])', 'button', 'a[href]', 'select', 'textarea', '[onclick]', '[role="button"]', '[tabindex]:not([tabindex="-1"])', 'h1, h2, h3, h4, h5, h6', 'img[alt]', 'form', '[data-testid]', '[data-test]'];

    /**
     * Ids a framework generated rather than a developer chose.
     *
     * Angular Material stamps `mat-input-3`, `mat-select-value-5`, `mat-button-9` in render
     * order, so they shift as soon as anything above the element changes. Radix and React's
     * useId produce `:r1a:`. Preferring one of these over a label is what makes a recorded
     * test fail the next day against an application nobody touched.
     */
    const isVolatileId = (id: string) => {
      if (/^(mat|mdc|cdk|ng|dx|p|ui|kendo)[-_]/i.test(id) && /\d+$/.test(id)) return true;
      if (/^:[a-z0-9]+:$/i.test(id)) return true;
      if (/^[0-9a-f]{12,}$/i.test(id)) return true;
      return /^[a-z-]*\d{4,}$/i.test(id);
    };

    /**
     * Every document-like root, including open shadow roots.
     *
     * querySelectorAll stops at a shadow boundary; Playwright's CSS engine pierces open
     * roots on its own. Walking only the light DOM therefore left the element missing from
     * the list while being perfectly clickable — and made the uniqueness check disagree
     * with the engine that would later act on the selector.
     */
    const roots: Array<Document | ShadowRoot> = [document];
    (function collectRoots(root: Document | ShadowRoot) {
      root.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          collectRoots(el.shadowRoot);
        }
      });
    })(document);

    const queryAll = (sel: string): Element[] =>
      roots.flatMap((root) => {
        try { return Array.from(root.querySelectorAll(sel)); } catch { return []; }
      });

    const isUnique = (sel: string) => queryAll(sel).length === 1;

    const isVolatileClass = (c: string) =>
      !c ||
      /[:()[\]/.]/.test(c) ||
      /^(ng|cdk|mat|mdc)-/.test(c) ||
      /(focus|active|hover|selected|touched|dirty|pristine|disabled|expanded)/i.test(c);

    const structuralPath = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
        if (node.id && !isVolatileId(node.id) && isUnique(`#${CSS.escape(node.id)}`)) {
          parts.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
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

    /**
     * The first CSS selector that identifies this element on its own, or null.
     *
     * Ordered by how long the thing it keys on tends to survive: a developer-chosen id,
     * then a test id, then the accessible label, then non-framework classes. A generated id
     * is skipped rather than ranked last, because it looks perfectly unique today — which
     * is exactly why it used to win.
     */
    const buildCssSelector = (el: Element): string | null => {
      const tag = el.tagName.toLowerCase();

      if (el.id && !isVolatileId(el.id) && isUnique(`#${CSS.escape(el.id)}`)) {
        return `#${CSS.escape(el.id)}`;
      }
      for (const attr of ['data-testid', 'data-test', 'name', 'aria-label', 'placeholder']) {
        const v = el.getAttribute(attr);
        if (v) {
          const s = `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;
          if (isUnique(s)) return s;
        }
      }
      if (typeof el.className === 'string' && el.className.trim()) {
        const classes = el.className.split(/\s+/).filter((c) => !isVolatileClass(c));
        for (let n = classes.length; n >= 1; n--) {
          const s = `${tag}.${classes.slice(0, n).join('.')}`;
          if (isUnique(s)) return s;
        }
      }
      return null;
    };

    /** The ARIA role: explicit, or the obvious one implied by the tag. */
    const roleOf = (el: Element): string | null => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a') return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'img') return 'img';
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        if (['text', 'email', 'tel', 'url', 'password', 'search'].indexOf(type) !== -1) return 'textbox';
      }
      return null;
    };

    /** Close enough to the accessible name for Playwright's `role=…[name=…]` engine. */
    const accessibleNameOf = (el: Element): string | null => {
      const label = el.getAttribute('aria-label');
      if (label && label.trim()) return label.trim();
      const alt = el.getAttribute('alt');
      if (alt && alt.trim()) return alt.trim();
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && text.length <= 80) return text;
      const placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();
      return null;
    };

    const detectedElements: any[] = [];
    const seen = new Set<Element>();
    let globalElementCounter = 0;

    interactiveSelectors.forEach((selector) => {
      queryAll(selector).forEach((element, index) => {
        if (seen.has(element)) return; // an element can match several selectors — keep one entry
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        seen.add(element);

        const tagName = element.tagName.toLowerCase();
        const text = element.textContent?.trim() || '';
        const placeholder = element.getAttribute('placeholder') || '';
        const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`;
        let elementType = 'element';
        if (tagName === 'input') elementType = element.getAttribute('type') || 'input';
        else if (tagName === 'button' || element.getAttribute('role') === 'button') elementType = 'button';
        else if (tagName === 'a') elementType = 'link';
        else if (tagName.match(/h[1-6]/)) elementType = 'heading';
        else if (tagName === 'select') elementType = 'select';
        else if (tagName === 'textarea') elementType = 'textarea';
        const attributes: Record<string, string> = {};
        Array.from(element.attributes).forEach((attr: any) => { attributes[attr.name] = attr.value; });

        const exactText = text.replace(/\s+/g, ' ').trim();

        detectedElements.push({
          id: `elem-${tagName}-${globalElementCounter++}`,
          type: elementType,
          text: displayText.substring(0, 100),
          tag: tagName,
          attributes,
          // Document-relative, not viewport-relative: the preview is a full-page
          // screenshot, and an element below the fold has to be drawable on it.
          boundingBox: {
            x: Math.round(rect.x + window.scrollX),
            y: Math.round(rect.y + window.scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          cssSelector: buildCssSelector(element),
          role: roleOf(element),
          accessibleName: accessibleNameOf(element),
          exactText: exactText && exactText.length <= 80 ? exactText : null,
          structuralPath: structuralPath(element),
        });
      });
    });

    return {
      elements: detectedElements,
      totalFound: detectedElements.length,
      pageSize: {
        width: Math.max(document.documentElement.scrollWidth, window.innerWidth),
        height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
      },
    };
}

/**
 * Where a selector should be looked up: the page, or a chain of iframes within it.
 *
 * page.locator() does not cross an iframe boundary, so an element inside one needs both
 * halves — which frame, and where in it. The chain is ' >> ' separated and outermost first,
 * which is how frameChainFor writes it.
 */
export function scopeFor(page: Page, frameSelector?: string | null) {
  if (!frameSelector) return page;
  return frameSelector
    .split(' >> ')
    .filter(Boolean)
    .reduce<any>((scope, step) => scope.frameLocator(step), page);
}

/**
 * The rows a test runs over, or null when it runs once.
 *
 * An empty array counts as none: it is a dataset someone started and did not fill in, and
 * running zero times while reporting success would be a green result for a test that never
 * executed. Values are coerced to strings because that is what `{{variable}}` substitution
 * puts into a URL or a form field.
 */
function datasetRows(test: { dataset?: unknown }): Array<Record<string, string>> | null {
  const raw = (test as { dataset?: unknown }).dataset;
  const parsed = typeof raw === 'string' ? safeParseJson(raw) : raw;
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  return parsed
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : String(value ?? ''),
        ]),
      ),
    );
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class PlaywrightService {
  /**
   * Set by every detection run. Read by the routes so the interface can say "showing 300 of
   * 812" instead of presenting a truncated list as if it were the whole page.
   */
  private lastDetectionSummary: DetectionSummary | undefined;

  getLastDetectionSummary(): DetectionSummary | undefined {
    return this.lastDetectionSummary;
  }

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
  /**
   * Saves the recording browser's current session against an environment.
   *
   * Called once the tester has signed in inside the recorder window. From then on, runs
   * against that environment start authenticated instead of replaying the login — which is
   * both the slowest part of a DMO test and the part most likely to fail for a reason the
   * test was not written to check.
   *
   * Returns false for a session that is not open, rather than storing an empty state: an
   * empty cookie jar would silently turn "reuse the login" into "log in every time", and
   * the tester would have no way to tell which they had.
   */
  async captureLoginState(sessionId: string, environment: EnvironmentScope): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      resolvedLogger.warn({
        message: 'PS:captureLoginState - no such recording session',
        sessionId,
        environmentId: environment.environmentId,
      });
      return false;
    }

    const state = await session.context.storageState();
    await saveLoginState(environment, state as any);
    resolvedLogger.info({
      message: 'PS:captureLoginState - login state saved',
      sessionId,
      environmentId: environment.environmentId,
      cookieCount: state.cookies?.length ?? 0,
    });
    return true;
  }

  /**
   * Runs a function against a live recording session's browser context.
   *
   * Exists so tests can put a session into the recorder's browser the way a tester would by
   * signing in, without the context itself leaking out of this class.
   */
  async withRecordingContext(
    sessionId: string,
    fn: (context: BrowserContext) => Promise<void>,
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;
    await fn(session.context);
    return true;
  }

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

      // Infrastructure failure, not a test that legitimately failed — worth an incident.
      recordRunnerFailure({
        phase: `recording:${stage}`,
        error,
        context: { sessionId, url, browserType },
        userId,
      });

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
  /**
   * How to address a frame from the top document: ' >> ' separated, outermost first.
   *
   * Returns null when any link in the chain cannot be addressed. A frame with no id, no
   * name and no stable position is one whose elements could never be acted on, and
   * listing them would be a promise the runner cannot keep.
   */
  private async frameChainFor(frame: Frame): Promise<string | null> {
    const chain: string[] = [];
    let current: Frame | null = frame;

    while (current && current.parentFrame()) {
      let element;
      try {
        element = await current.frameElement();
      } catch {
        return null; // detached mid-scan
      }

      const selector = await element
        .evaluate((el: Element) => {
          const escape = (value: string) => (window as any).CSS.escape(value);
          const tag = el.tagName.toLowerCase(); // iframe, or the older frame
          const doc = el.ownerDocument!;
          const unique = (sel: string) => doc.querySelectorAll(sel).length === 1;

          if (el.id && unique(tag + '#' + escape(el.id))) return tag + '#' + escape(el.id);
          const name = el.getAttribute('name');
          if (name && unique(tag + '[name="' + name + '"]')) return tag + '[name="' + name + '"]';
          const title = el.getAttribute('title');
          if (title && unique(tag + '[title="' + title + '"]')) return tag + '[title="' + title + '"]';

          // Position among the same tag in its own document: stable as long as the
          // surrounding markup is, which is the same bargain the structural path makes.
          const index = Array.from(doc.querySelectorAll(tag)).indexOf(el);
          return index >= 0 ? tag + ' >> nth=' + index : null;
        })
        .catch(() => null);

      await element.dispose().catch(() => {});
      if (!selector) return null;

      chain.unshift(selector);
      current = current.parentFrame();
    }

    return chain.length > 0 ? chain.join(' >> ') : null;
  }

  private async detectElementsOnPage(page: Page): Promise<DetectedElement[]> {
    // One pass per frame. page.frames() is flat and already includes nested ones, so a
    // frame three levels down is reached the same way as a direct child.
    const perFrame: Array<{ frameSelector: string | null; data: any }> = [];
    for (const frame of page.frames()) {
      let frameSelector: string | null = null;
      if (frame !== page.mainFrame()) {
        frameSelector = await this.frameChainFor(frame);
        // A frame whose own <iframe> cannot be addressed from its parent is one whose
        // elements could never be acted on, so reporting them would be a false promise.
        if (!frameSelector) continue;
      }
      try {
        perFrame.push({ frameSelector, data: await frame.evaluate(collectCandidatesInFrame) });
      } catch {
        // A frame can navigate or detach mid-scan, and a cross-origin one cannot be read
        // at all. Neither is a reason to fail the whole detection.
      }
    }

    const candidates = {
      elements: perFrame.flatMap((f) =>
        f.data.elements.map((e: any) => ({ ...e, frameSelector: f.frameSelector })),
      ),
      totalFound: perFrame.reduce((n, f) => n + f.data.totalFound, 0),
      // The top document decides the picture the highlighting is drawn on.
      pageSize: perFrame[0]?.data.pageSize ?? { width: 1280, height: 720 },
    };

    const limit = detectionLimit();
    const chosen: DetectedElement[] = [];

    for (const candidate of candidates.elements.slice(0, limit)) {
      chosen.push({
        id: candidate.id,
        type: candidate.type,
        selector: await this.pickSelector(page, candidate),
        // Which frame that selector is relative to, so the step can be replayed.
        frameSelector: candidate.frameSelector ?? null,
        text: candidate.text,
        tag: candidate.tag,
        attributes: candidate.attributes,
        boundingBox: candidate.boundingBox,
      });
    }

    if (candidates.totalFound > limit) {
      resolvedLogger.info({
        message: 'PS:detectElementsOnPage - element list truncated',
        totalFound: candidates.totalFound,
        returned: chosen.length,
        limit,
      });
    }

    this.lastDetectionSummary = {
      totalFound: candidates.totalFound,
      returned: chosen.length,
      truncated: candidates.totalFound > limit,
      pageSize: candidates.pageSize,
    };

    return chosen;
  }

  /**
   * Chooses the selector to store for a detected element.
   *
   * CSS candidates were already checked for uniqueness inside the page, where it costs one
   * `querySelectorAll`. Playwright's own engines — `role=` and `text=` — cannot be evaluated
   * there, so they are verified here, and only for the elements that had no unique CSS. That
   * keeps the round-trips proportional to the awkward elements rather than to all of them.
   */
  private async pickSelector(
    page: Page,
    candidate: {
      cssSelector: string | null;
      role: string | null;
      accessibleName: string | null;
      exactText: string | null;
      structuralPath: string;
      frameSelector?: string | null;
    },
  ): Promise<string> {
    if (candidate.cssSelector) return candidate.cssSelector;

    // Counted inside the frame the element lives in. Against the top document a selector
    // unique in its own frame would look like zero matches, and lose to the structural
    // path for no reason.
    const scope = scopeFor(page, candidate.frameSelector);

    const engineCandidates: string[] = [];
    if (candidate.role && candidate.accessibleName) {
      engineCandidates.push(
        `role=${candidate.role}[name=${JSON.stringify(candidate.accessibleName)}]`,
      );
    }
    if (candidate.exactText) {
      engineCandidates.push(`text=${JSON.stringify(candidate.exactText)}`);
    }

    for (const selector of engineCandidates) {
      try {
        if ((await scope.locator(selector).count()) === 1) return selector;
      } catch {
        // An unusable selector is simply a candidate that lost.
      }
    }

    // Last resort: brittle against markup changes, but unambiguous today, which is the
    // property the engine needs in order to act at all.
    return candidate.structuralPath;
  }

  /**
   * How many elements each selector matches on a page.
   *
   * A selector matching zero or several elements cannot be clicked, and discovering that
   * during replay instead of during authoring is the expensive order of events.
   */
  async countSelectorMatches(
    url: string,
    selectors: string[],
  ): Promise<Array<{ selector: string; count: number }>> {
    const targetUrl = substituteVariables(url);
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        ignoreHTTPSErrors: allowsSelfSignedCertificate(targetUrl),
      });
      const page = await context.newPage();
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      const results: Array<{ selector: string; count: number }> = [];
      for (const selector of selectors) {
        let count = -1;
        try {
          count = await page.locator(selector).count();
        } catch {
          count = -1; // malformed selector: reported, not thrown
        }
        results.push({ selector, count });
      }
      return results;
    } finally {
      await browser.close().catch(() => {});
    }
  }

  async executeAdhocSequence(payload: AdhocSequencePayload, userId: number): Promise<{ success: boolean; steps?: StepResult[]; error?: string; duration?: number; detectedElements?: DetectedElement[] }> {
    const testName = payload.name || "Ad-hoc Test";
    resolvedLogger.http({ message: "PlaywrightService: executeAdhocSequence called", testName, userId, url: payload.url });
    // The preview resolves variables the same way a scheduled run does, so a test that
    // works here is not relying on something only this path provides.
    const vars = payload.organizationId
      ? await resolveVariables({
          userId,
          organizationId: payload.organizationId,
          environmentId: payload.environmentId,
        })
      : requestVariables();
    const targetUrl = payload.url ? substituteVariables(payload.url, vars) : payload.url;
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

            const outcome = await executeStep({ page, vars }, step);
            if (outcome.status === 'failed') {
              stepStatus = 'failed';
              stepError = outcome.error;
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

      // A step that fails its assertion is a normal product outcome and never lands here;
      // this catch is reached only when the run itself could not be carried out.
      recordRunnerFailure({
        phase: 'adhoc-execution',
        error,
        context: { testName, url: payload.url, stepCount: payload.sequence?.length ?? 0 },
        userId,
      });
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

  async detectElements(url: string, userId?: number): Promise<DetectionResult> {
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

      // Taken from this page, after this detection: the boxes and the picture have to agree.
      const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: true });
      const summary = this.getLastDetectionSummary() ?? {
        totalFound: elements.length,
        returned: elements.length,
        truncated: false,
        pageSize: { width: 1280, height: 720 },
      };

      return {
        elements,
        screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
        summary,
      };
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
    executionId?: string, // Optional execution ID for real-time logging
    // Resolved `{{name}}` values. Supplied by the caller that knows which environment
    // applies; falls back to the defaults so existing callers keep working.
    vars: Record<string, string> = requestVariables(),
    // The environment whose saved browser session to start from, when it has one. Without
    // it the run starts signed out, exactly as it always did.
    environment?: EnvironmentScope,
  ): Promise<{ success: boolean; steps?: StepResult[]; error?: string; duration?: number }> {
    const startTime = Date.now();

    // A test with rows of input runs once per row, with that row's values layered over the
    // environment's. Each row gets its own browser rather than sharing one: a row is an
    // independent case, and one leaving a modal open or a session half-established would
    // otherwise decide the outcome of the next.
    const rows = datasetRows(test);
    if (rows) {
      const allSteps: StepResult[] = [];
      let allPassed = true;

      for (const [index, row] of rows.entries()) {
        const label = `Row ${index + 1} of ${rows.length}`;
        const rowResult = await this.executeTestSequence(
          { ...test, dataset: null } as Test,
          userId,
          screenshotBaseDir ? path.join(screenshotBaseDir, `row_${index + 1}`) : undefined,
          executionId,
          { ...vars, ...row },
          environment,
        );

        // Prefixed, because "assertion failed" repeated twenty times says nothing about
        // which input broke it — and finding that out by rerunning the set by hand is the
        // cost this feature exists to remove.
        for (const step of rowResult.steps ?? []) {
          allSteps.push({ ...step, name: `${label} — ${step.name}` });
        }
        if (!rowResult.success) allPassed = false;
        // Deliberately no early exit: stopping at the first bad row would hide whatever
        // else is broken, and the next run would find it one row at a time.
      }

      return { success: allPassed, steps: allSteps, duration: Date.now() - startTime };
    }
    const wsEmitter = getWsEmitter();
    resolvedLogger.http({ message: "PlaywrightService: executeTestSequence called", testName: test.name, testId: test.id, userId, testUrl: test.url, screenshotBaseDir });
    const targetUrl = test.url ? substituteVariables(test.url, vars) : test.url;
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
      // Start from the environment's saved session when there is one, so the test does not
      // spend its first thirty seconds logging in — and does not fail for a reason that has
      // nothing to do with what it checks.
      const storageState = environment ? await loadLoginState(environment) : undefined;
      if (storageState) {
        resolvedLogger.debug({
          message: 'PS:executeTestSequence - starting from the saved login state',
          testName: test.name,
          environmentId: environment?.environmentId,
        });
      }

      context = await browser.newContext({
        userAgent,
        ignoreHTTPSErrors: allowsSelfSignedCertificate(targetUrl ?? ''),
        ...(storageState ? { storageState: storageState as any } : {}),
      });
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

            const outcome = await executeStep({ page, reporter, vars }, step);
            if (outcome.status === 'failed') {
              stepStatus = 'failed';
              stepError = outcome.error;
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