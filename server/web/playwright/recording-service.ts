import { RecordedActionSchema, type RecordedAction } from '@shared/recording';
import { flattenZodError } from '../../platform/zod-error';
import { Browser, BrowserContext, Page } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { gotoWithinPolicy } from '../../platform/egress-policy';
import { saveLoginState, type EnvironmentScope } from '../../runtime/login-state';
import { recordRunnerFailure } from '../../platform/observability/taps/runner';
import { substituteVariables } from '../../platform/outbound-http';
import { RECORDER_SCRIPT } from '../../authoring/recorder-script';
import { storage } from '../../identity/storage';

import {
  AUTHORING_USER_AGENT,
  BrowserSessionError,
  browserForSetting,
  openBrowserSession,
  type BrowserSession,
} from '../browser-session';
import { describeBrowser } from '../../runtime/browsers';
import { resolvedLogger } from './log';
import { DEFAULT_TIMEOUT, DEFAULT_WAIT_TIME } from './types';

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

export class RecordingService {
  private activeSessions: Map<string, ActiveSession> = new Map();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Buffers one action coming from the in-page recorder.
   *
   * Everything crossing this boundary is produced by JavaScript running inside the page
   * under test, so it is schema-validated and capped rather than trusted.
   */
  private pushAction(sessionId: string, raw: unknown): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      resolvedLogger.warn({
        message: 'PS:pushAction - Action received for non-existent session',
        sessionId,
      });
      return;
    }

    const parsed = RecordedActionSchema.safeParse(raw);
    if (!parsed.success) {
      resolvedLogger.warn({
        message: 'PS:pushAction - Discarded malformed action from page',
        sessionId,
        issues: flattenZodError(parsed.error),
      });
      return;
    }

    const action = parsed.data;
    action.timestamp = Date.now();
    if (!action.url && session.page && !session.page.isClosed()) {
      action.url = session.page.url();
    }
    session.lastActivityAt = action.timestamp;

    if (action.type === 'navigate' && this.isRedundantNavigation(session, action)) {
      resolvedLogger.verbose({
        message: 'PS:pushAction - Skipped redundant navigation',
        sessionId,
        url: action.url,
      });
      return;
    }

    if (session.actions.length >= MAX_RECORDED_ACTIONS) {
      resolvedLogger.warn({
        message: 'PS:pushAction - Action buffer full, dropping action',
        sessionId,
        cap: MAX_RECORDED_ACTIONS,
      });
      return;
    }

    session.actions.push(action);
    resolvedLogger.verbose({
      message: 'PS:pushAction - Action recorded',
      sessionId,
      actionType: action.type,
      total: session.actions.length,
    });
  }

  /**
   * True when a navigation should not become its own replay step: either it repeats the URL
   * we are already on, or it is the direct consequence of the interaction just recorded.
   */
  private isRedundantNavigation(session: ActiveSession, action: RecordedAction): boolean {
    const previous = [...session.actions].reverse().find((a) => !a.meta);
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
      resolvedLogger.warn({
        message: 'PS:sweepIdleSessions - Reaping idle recording session',
        sessionId,
        idleMs: now - session.lastActivityAt,
      });
      await this.disposeSessionResources(session, sessionId);
      this.activeSessions.delete(sessionId);
    }
    this.stopSweeperIfIdle();
  }

  /** Closes page/context/browser of a session, never throwing. */
  private async disposeSessionResources(session: ActiveSession, sessionId: string): Promise<void> {
    if (session.page && !session.page.isClosed()) {
      await session.page.close().catch((e) =>
        resolvedLogger.warn({
          message: 'PS:disposeSessionResources - Error closing page',
          sessionId,
          error: e.message,
        }),
      );
    }
    if (session.context) {
      await session.context.close().catch((e) =>
        resolvedLogger.warn({
          message: 'PS:disposeSessionResources - Error closing context',
          sessionId,
          error: e.message,
        }),
      );
    }
    if (session.browser && session.browser.isConnected()) {
      await session.browser.close().catch((e) =>
        resolvedLogger.warn({
          message: 'PS:disposeSessionResources - Error closing browser',
          sessionId,
          error: e.message,
        }),
      );
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
  /** The Accept-Language this page's requests carry, read off a real request. */
  private async acceptLanguageOf(page: Page): Promise<string | undefined> {
    try {
      const [request] = await Promise.all([
        page.waitForRequest(() => true, { timeout: 5000 }),
        page.evaluate(() =>
          fetch(location.href, { method: 'HEAD', credentials: 'include' }).catch(() => undefined),
        ),
      ]);
      return (await request.allHeaders())['accept-language'];
    } catch {
      return undefined;
    }
  }

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
    const acceptLanguage = await this.acceptLanguageOf(session.page);
    await saveLoginState(environment, {
      ...(state as any),
      ...(acceptLanguage ? { acceptLanguage } : {}),
    });
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
  registerSession(
    sessionId: string,
    session: Omit<ActiveSession, 'actions' | 'lastActivityAt'> &
      Partial<Pick<ActiveSession, 'actions'>>,
  ): void {
    this.activeSessions.set(sessionId, {
      actions: session.actions ?? [],
      lastActivityAt: Date.now(),
      ...session,
    } as ActiveSession);
  }

  async startRecordingSession(
    url: string,
    userId?: number,
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    resolvedLogger.http({
      message: 'PlaywrightService: startRecordingSession called',
      url,
      userId,
    });
    const targetUrl = substituteVariables(url);
    const sessionId = uuidv4();
    let session: BrowserSession | null = null;
    // Recording is interactive by definition: the user drives a real, visible window.
    let browser = browserForSetting(undefined, false);

    try {
      const userSettings = userId ? await storage.getUserSettings(userId) : undefined;
      browser = browserForSetting(userSettings?.playwrightBrowser, false);
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      const specificWaitTime = userSettings?.playwrightWaitTime || DEFAULT_WAIT_TIME;
      resolvedLogger.debug({
        message: 'PS:startRecordingSession - Effective settings',
        sessionId,
        browser: describeBrowser(browser),
        pageTimeout,
        specificWaitTime,
      });

      // Maximised, and the viewport left to follow the window.
      //
      // A recording window is one a person works in: at 1280x720 an enterprise screen is
      // cramped, tables scroll sideways, and menus that would be open on the tester's own
      // monitor are collapsed — so the recording captures a path through a layout nobody
      // uses. `--start-maximized` only has an effect with `viewport: null`, which tells
      // Playwright to stop pinning the page to a fixed size and let it fill the window.
      session = await openBrowserSession({
        browser,
        url: targetUrl,
        viewport: 'window',
        launchArgs: ['--start-maximized'],
        userAgent: AUTHORING_USER_AGENT,
        timeoutMs: pageTimeout,
        beforePage: (context) => this.installRecorder(context, sessionId),
      });
      const { context, page } = session;

      const sessionData: ActiveSession = {
        browser: session.browser,
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
        const stillOpen = session.context.pages().filter((p) => !p.isClosed());
        if (stillOpen.length === 0) {
          session.pageClosedByEventHandler = true;
          resolvedLogger.info({
            message: 'PS:startRecordingSession - All pages closed; session marked as ended',
            sessionId,
          });
        }
      };
      context.on('page', (newPage) => {
        newPage.on('close', markClosedIfLastPage);
      });
      page.on('close', markClosedIfLastPage);

      await gotoWithinPolicy(page, targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(specificWaitTime);
      await page.bringToFront();

      resolvedLogger.info({
        message: 'PS:startRecordingSession - Recording session started successfully',
        sessionId,
        url,
        userId: userId || 'anonymous',
      });
      return { success: true, sessionId };
    } catch (error: any) {
      const stage =
        error instanceof BrowserSessionError
          ? {
              launch: `browser launch (type: ${browser.label})`,
              context: 'browser context creation',
              page: 'page creation',
            }[error.stage]
          : session?.page.isClosed()
            ? 'page operation on closed page'
            : 'page navigation/setup';

      resolvedLogger.error({
        message: 'PS:startRecordingSession - CRITICAL ERROR during session setup',
        sessionId,
        stage,
        url,
        error: error.message,
        stack: error.stack,
      });

      // Infrastructure failure, not a test that legitimately failed — worth an incident.
      recordRunnerFailure({
        phase: `recording:${stage}`,
        error,
        context: { sessionId, url, browserType: browser.label },
        userId,
      });

      await session?.close();
      this.activeSessions.delete(sessionId);
      this.stopSweeperIfIdle();
      return { success: false, error: `Failed during ${stage}: ${error.message}` };
    }
  }

  async stopRecordingSession(
    sessionId: string,
    userId?: number,
  ): Promise<{ success: boolean; sequence?: RecordedAction[]; error?: string }> {
    resolvedLogger.http({
      message: 'PlaywrightService: stopRecordingSession called',
      sessionId,
      userId,
    });
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      resolvedLogger.warn({
        message: 'PS:stopRecordingSession - Session not found or already stopped.',
        sessionId,
        userId,
      });
      return { success: false, error: 'Recording session not found or already stopped.' };
    }

    if (userId && session.userId && session.userId !== userId) {
      resolvedLogger.warn({
        message: 'User ID mismatch attempting to stop session',
        sessionId,
        requestUserId: userId,
        sessionUserId: session.userId,
      });
      return { success: false, error: 'Unauthorized to stop this recording session.' };
    }

    try {
      const pageOpen = !!session.page && !session.page.isClosed();
      const lastUrl = pageOpen
        ? session.page.url()
        : ([...session.actions].reverse().find((a) => a.url)?.url ?? session.targetUrl);

      session.actions.push({
        type: 'navigate',
        url: lastUrl,
        value: lastUrl,
        timestamp: Date.now(),
        meta: 'session-stopped',
      });

      await this.disposeSessionResources(session, sessionId);

      const recordedActions = session.actions;
      const userActionCount = recordedActions.filter((a) => !a.meta).length;
      if (userActionCount === 0) {
        resolvedLogger.warn({
          message: 'PS:stopRecordingSession - Session stopped without any user action.',
          sessionId,
        });
      }

      this.activeSessions.delete(sessionId);
      this.stopSweeperIfIdle();
      resolvedLogger.info({
        message: 'PS:stopRecordingSession - Session finalized.',
        sessionId,
        actionCount: recordedActions.length,
        userActionCount,
      });

      return { success: true, sequence: recordedActions };
    } catch (error: any) {
      resolvedLogger.error({
        message: 'PS:stopRecordingSession - CRITICAL error during stop sequence',
        sessionId,
        error: error.message,
        stack: error.stack,
      });
      this.activeSessions.delete(sessionId);
      this.stopSweeperIfIdle();
      return {
        success: false,
        error: error.message || `Unknown error stopping recording session ${sessionId}`,
      };
    }
  }

  async getRecordedActions(
    sessionId: string,
    userId?: number,
  ): Promise<{
    success: boolean;
    sequence?: RecordedAction[];
    error?: string;
    sessionEnded?: boolean;
  }> {
    const session = this.activeSessions.get(sessionId);
    resolvedLogger.debug({
      message: 'PS:getRecordedActions called',
      sessionId,
      userId,
      sessionFound: !!session,
    });

    if (!session) {
      return {
        success: false,
        sessionEnded: true,
        error: 'Recording session not found or already stopped.',
      };
    }

    if (userId && session.userId && session.userId !== userId) {
      resolvedLogger.warn({
        message: 'User ID mismatch attempting to get actions for session',
        sessionId,
        requestUserId: userId,
        sessionUserId: session.userId,
      });
      return { success: false, error: 'Unauthorized to access this recording session.' };
    }

    // The browser window was closed without pressing Stop: hand back what we buffered and
    // tell the client to stop polling instead of letting it spin against a dead session.
    if (session.pageClosedByEventHandler) {
      return {
        success: true,
        sequence: [...session.actions],
        sessionEnded: true,
        error: 'The recording browser window was closed.',
      };
    }

    return { success: true, sequence: [...session.actions] };
  }
}
