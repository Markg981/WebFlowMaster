import type { Locator, Page } from 'playwright';
import { clearMocks, installBlock, installMock, parseMockSpec } from './network-mocks';
import type { PlaywrightReporter } from './playwright-reporter';
import {
  ADHOC_ACTION_IDS,
  ASSERTABLE_STATES,
  SETTABLE_STATES,
  type AdhocActionId,
  type AssertableState,
  type SettableState,
} from '@shared/recording';
import {
  DEFAULT_ACCESSIBILITY_THRESHOLD,
  describeFinding,
  isAccessibilityImpact,
  ACCESSIBILITY_IMPACTS,
  type AccessibilityFinding,
  type AccessibilityImpact,
} from '@shared/accessibility';
import { MAX_LOOP_ITERATIONS } from '@shared/flow';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import type { Download } from 'playwright';
import { parseSmsQuery, SMS_TIMEOUT_MS, waitForSms as waitForSmsInInbox, type SmsQuery } from './sms-inbox';
import { inspectDownload } from './download-check';
import { parseDownloadChecks, parseGeolocation, runDownloadChecks, type DownloadFinding } from '@shared/downloads';
import { measurePagePerformance, runLighthouse } from './web-performance';
import {
  DEFAULT_PERFORMANCE_LIMITS,
  check,
  describeChecks,
  formatMetric,
  parseLighthouseLimits,
  parsePerformanceLimits,
  type LighthouseFinding,
  type PerformanceFinding,
  type PerformanceMetric,
} from '@shared/web-performance';
import { scanAccessibility } from './accessibility';
import { allowsSelfSignedCertificate, requestVariables, substituteVariables } from './outbound-http';
import { EMAIL_TIMEOUT_MS, findOtp, inboxConfig, parseEmailQuery, waitForEmail, type InboxGet } from './email-inbox';
import {
  DATABASE_TIMEOUT_MS,
  connectionVariable,
  databaseKind,
  parseDatabaseQuery,
  redactMessage,
  resultVariables,
  runDatabaseQuery,
  type DatabaseRunner,
} from './database-step';
import { findUnresolvedVariables } from './variables';

/**
 * The single implementation of "run one step of a test sequence".
 *
 * There used to be two, one inside `executeAdhocSequence` and one inside
 * `executeTestSequence`, and they had drifted: the persisted one had no `navigate` case, so
 * a recorded multi-page test passed in the builder's preview and failed on every replay and
 * every schedule, and it skipped variable substitution, so a recorded `{{secret_…}}`
 * password was typed into the app verbatim. Both were consequences of the duplication rather
 * than separate mistakes, which is why this file exists instead of a patch to each copy.
 *
 * The two callers still differ in what they own — browser lifecycle, screenshots, WebSocket
 * logs, Allure reporting — and keep owning it. Only the step itself is shared.
 *
 * Actions live in a `Record<AdhocActionId, …>` rather than a `switch` on purpose: that makes
 * the compiler, not a reviewer, the thing that notices an action declared in
 * `shared/recording.ts` with no implementation here. The drift this file exists to fix was
 * exactly that, and a `switch` cannot catch it.
 */

export interface StepContext {
  page: Page;
  /**
   * Present only on the persisted path. When set, interactions route through it so a failed
   * selector can be repaired by the AI healing pass; the ad-hoc preview has no reporter and
   * talks to the page directly.
   */
  reporter?: PlaywrightReporter;
  /** Resolved `{{name}}` values. Defaults to the process-level set when omitted. */
  vars?: Record<string, string>;
  /**
   * When the test began (epoch ms). A `waitForEmail` step takes only mail received since then,
   * so a fixed address does not read the previous run's email. Defaults to the step's own start.
   */
  startedAt?: number;
  /** Runs a `queryDatabase` statement. The real drivers when omitted. */
  database?: DatabaseRunner;
  /** Where an `auditLighthouse` step keeps its HTML report; none in the builder's preview. */
  artifactDir?: string;
  /** Waits for a text message in the organization's SMS inbox. The real inbox when omitted. */
  waitForSms?: StepRuntime['waitForSms'];
  /** Stand-ins for the performance measurements, for tests. The real ones when omitted. */
  measurePerformance?: StepRuntime['measurePerformance'];
  runLighthouse?: StepRuntime['runLighthouse'];
}

export interface StepOutcome {
  status: 'passed' | 'failed';
  error?: string;
  /**
   * What the step actually did, when that is not obvious from it having passed.
   *
   * `ensureState` needs this: "the function was already enabled" and "the function has been
   * enabled" are both successes, and a report that shows them identically cannot answer the
   * question people ask of a setup step — did this run change the system, or find it as it
   * should be?
   */
  detail?: string;
  /** What an `assertAccessible` step found, kept on the step for the report. */
  accessibility?: AccessibilityFinding;
  /** What a `measurePerformance` step measured (shared/web-performance.ts). */
  performance?: PerformanceFinding;
  /** What an `auditLighthouse` step scored. */
  lighthouse?: LighthouseFinding;
  /** The file an `expectDownload` step took, and its checks (shared/downloads.ts). */
  download?: DownloadFinding;
  /**
   * The tab the rest of the test runs in, when this step moved it (`switchTab`, `closeTab`).
   *
   * Returned rather than swapped behind the caller's back: the caller owns the page it takes
   * screenshots of and hands to the reporter, and a step that changed it silently would leave
   * the evidence showing one tab while the steps acted on another.
   */
  page?: Page;
  /** What an `if` or `repeatWhile` found, for the runner's flow cursor to act on. */
  condition?: boolean;
  /** How many times a `repeat` runs its body. */
  iterations?: number;
}

/** The step shape both callers pass in — the builder's `TestStep`, structurally. */
export interface ExecutableStep {
  action?: { id?: string; name?: string } | null;
  targetElement?: { selector?: string; frameSelector?: string | null } | null;
  value?: unknown;
  /** Set on the step a custom action call expands into (server/custom-actions.ts). */
  args?: Record<string, string> | null;
}

/**
 * Where a step's selectors resolve: the page, or a chain of iframes within it.
 *
 * The chain is ' >> ' separated and outermost first, as element detection records it.
 */
function frameScope(page: Page, frameSelector?: string | null) {
  if (!frameSelector) return page;
  return frameSelector
    .split(' >> ')
    .filter(Boolean)
    .reduce<any>((scope, step) => scope.frameLocator(step), page);
}

const passed: StepOutcome = { status: 'passed' };
const failed = (error: string): StepOutcome => ({ status: 'failed', error });

/** Marks the message so callers and tests can recognise this specific failure. */
export const UNRESOLVED_VARIABLE_ERROR = 'Unresolved variable(s)';

/** Ceiling for the conditional waits. Long enough for a slow SignalR push, short enough
 * that a genuinely missing element fails the step rather than stalling the run. */
export const DEFAULT_WAIT_TIMEOUT_MS = 15_000;

/**
 * How long an assertion keeps looking before it gives up.
 *
 * Shorter than the explicit waits above, and deliberately so. `waitForElement` is the tester
 * saying "this takes time"; an assertion is the tester saying "this should be true by now".
 * Some patience covers the gap between a click returning and the screen catching up — an
 * Angular tab strip re-renders after its click handler resolves — but matching the explicit
 * wait would make those actions pointless and would make every genuine failure take fifteen
 * seconds, which is what turns a red suite into one nobody runs.
 *
 * Without any patience the assertions were worse than flaky, they were wrong: replaying a
 * recorded DMO test, the tab existed a moment later and the step reported it missing in 16ms.
 */
export const ASSERTION_TIMEOUT_MS = 5_000;

/**
 * Retries a check until it holds, or the deadline passes.
 *
 * Polling rather than Playwright's own waiting because each assertion decides what "true"
 * means — a substring that is case-sensitive, a count compared with an operator — and
 * expressing those through `waitFor` would change what they assert. `filter({ hasText })`,
 * for one, matches case-insensitively, so a test that should fail would start passing.
 */
async function holdsWithin(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Where non-native dropdowns put their options, across the libraries DMO actually uses. */
const OPTION_SELECTOR = '[role="option"], .mat-mdc-option, .mat-option, .ng-option';

/**
 * Substitution deliberately leaves an unknown `{{name}}` in place rather than blanking it.
 * That is right for a URL, where a wrong address is obvious, and wrong for a value typed
 * into the page: a literal `{{secret_password}}` entered into a login form looks like a
 * failed login, and the tester has no way to tell the two apart. Anything sent to the
 * system under test is checked first, and reported by name.
 */
function resolveValue(
  raw: string,
  vars: Record<string, string>,
): { value: string } | { error: string } {
  const missing = findUnresolvedVariables(raw, vars);
  if (missing.length > 0) {
    return {
      error:
        `${UNRESOLVED_VARIABLE_ERROR} ${missing.join(', ')}. ` +
        'Select an environment that defines them, or write the value in full.',
    };
  }
  return { value: substituteVariables(raw, vars) };
}

/** Parses the `assertElementCount` value: `"==5"`, `">=2"`, or a bare `"3"`. */
export function parseAssertionValue(value: string): { operator: string; count: number } | null {
  const match = value.match(/^(==|>=|<=|>|<|!=)?\s*(\d+)$/);
  if (!match) {
    const singleNumberMatch = value.match(/^\s*(\d+)\s*$/);
    if (singleNumberMatch) {
      return { operator: '==', count: parseInt(singleNumberMatch[1], 10) };
    }
    return null;
  }
  return { operator: match[1] || '==', count: parseInt(match[2], 10) };
}

function compareCount(operator: string, actual: number, expected: number): boolean | null {
  switch (operator) {
    case '==': return actual === expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '!=': return actual !== expected;
    default: return null;
  }
}

/** What a handler is given. Everything a step can need, already resolved. */
interface StepRuntime {
  page: Page;
  vars: Record<string, string>;
  /** The step's target selector, if it has one. */
  selector?: string;
  /** The step's raw value, before substitution. */
  raw?: unknown;
  /** A custom action's arguments, before substitution. */
  args?: Record<string, string> | null;
  actionName: string;
  /** Routed through the reporter when there is one, so AI healing still applies. */
  click: (selector: string) => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  /**
   * A locator for a selector, inside the step's frame when it has one.
   *
   * Every handler goes through this rather than `page.locator` directly: page.locator does
   * not cross an iframe boundary, so an element inside one was unreachable however correct
   * its selector was.
   */
  locator: (selector: string) => Locator;
  /** Same, for Playwright's role engine, which also needs the frame. */
  byRole: (role: string, name: string) => Locator;
  timeoutMs: number;
  /** Shorter than timeoutMs, and separate on purpose — see ASSERTION_TIMEOUT_MS. */
  assertionTimeoutMs: number;
  /** Runs axe-core on the page. A field rather than an import, so it can be stood in for. */
  scanAccessibility: (threshold: AccessibilityImpact) => Promise<AccessibilityFinding>;
  /**
   * Sets `{{name}}` for the steps after this one. Absent when the caller passed no variables
   * of its own: the fallback is the process-wide set, and a value written there would turn up
   * in whichever run read it next.
   */
  storeVariable?: (name: string, value: string) => void;
  /** Removes `{{name}}`, so a value an earlier step found is not taken for this one's. */
  forgetVariable?: (name: string) => void;
  /** See StepContext.startedAt. */
  startedAt: number;
  /**
   * GET for the test inbox, through the browser context: it is sent from wherever the browser
   * runs, so a run on a local agent reaches the Mailpit of the agent's network.
   */
  inboxGet: InboxGet;
  /** See StepContext.database. */
  database: DatabaseRunner;
  /** The browser's own measurements of the page (server/web-performance.ts). */
  measurePerformance: () => Promise<{ url: string; metrics: Record<PerformanceMetric, number | null> }>;
  /** Where a step keeps a file it produced (StepContext.artifactDir); none in the builder's preview. */
  artifactDir?: string;
  /** A text message to the number, received after `since`; null when none came in time. */
  waitForSms: (query: SmsQuery, since: number, timeoutMs: number) => Promise<{ body: string; fromNumber: string | null } | null>;
  /** Lighthouse on the page's address, with the test's cookies for it. */
  runLighthouse: (formFactor: 'mobile' | 'desktop') => Promise<Omit<LighthouseFinding, 'checks'>>;
}

/** Reads the step's value as a non-empty string, or explains what is missing. */
function requireValue(rt: StepRuntime, action: string): { value: string } | { error: string } {
  if (typeof rt.raw !== 'string' || rt.raw.trim() === '') {
    return { error: `Value missing for ${action} action.` };
  }
  return resolveValue(rt.raw, rt.vars);
}

/** Reads the step's selector, or explains what is missing. */
function requireSelector(rt: StepRuntime, action: string): { selector: string } | { error: string } {
  if (!rt.selector) return { error: `Selector missing for ${action} action.` };
  return { selector: rt.selector };
}

/** Splits "name=value" at the first `=`, so a value may contain its own. */
export function parseAssignment(value: string): { name: string; value: string } | null {
  const at = value.indexOf('=');
  if (at <= 0) return null;
  const name = value.slice(0, at).trim();
  return name === '' ? null : { name, value: value.slice(at + 1) };
}

/** What `{{name}}` accepts — the same pattern substitution reads, so a stored name resolves. */
const VARIABLE_NAME = /^[\w.]+$/;

const UPLOAD_MIME_TYPES: Record<string, string> = {
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  md: 'text/markdown',
};

/**
 * The file an `uploadFile` step hands the page: "name.ext", or "name.ext|content".
 *
 * Made from the step rather than read from disk. The runner is shared by every organization on
 * the installation, so a path on the server would be a way to send one tenant's files — or the
 * server's own — to whatever application a test points at. A name and a text body cover the
 * forms that check a file was chosen and parse what is in it; binary fixtures need a file store
 * of their own.
 */
export function parseUploadValue(
  value: string,
): { name: string; mimeType: string; buffer: Buffer } | { error: string } {
  const bar = value.indexOf('|');
  const name = (bar === -1 ? value : value.slice(0, bar)).trim();
  if (name === '' || /[\\/]/.test(name)) {
    return { error: `"${name}" is not a file name. Write a name such as "invoice.csv", optionally followed by |content.` };
  }
  const content = bar === -1 ? `Test file ${name}\n` : value.slice(bar + 1);
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return {
    name,
    mimeType: UPLOAD_MIME_TYPES[extension] ?? 'application/octet-stream',
    buffer: Buffer.from(content, 'utf8'),
  };
}

export type DialogAnswer = { accept: boolean; promptText?: string };

/** "accept", "dismiss", or "accept:text"; empty means accept. */
export function parseDialogAnswer(value: string): DialogAnswer | null {
  const trimmed = value.trim();
  if (trimmed === '' || /^accept$/i.test(trimmed)) return { accept: true };
  if (/^dismiss$/i.test(trimmed)) return { accept: false };
  const prompt = /^accept:(.*)$/is.exec(trimmed);
  return prompt ? { accept: true, promptText: prompt[1] } : null;
}

/**
 * Answers waiting for the dialogs a page has not opened yet, in the order they were given.
 *
 * A queue rather than `page.once` per step: two `handleDialog` steps before the first dialog
 * would otherwise both answer it, and the second would fail on a dialog already handled while
 * the next one went unanswered. Keyed by page so a tab's answers stay with that tab.
 */
const pendingDialogAnswers = new WeakMap<Page, DialogAnswer[]>();

function queueDialogAnswer(page: Page, answer: DialogAnswer) {
  let queue = pendingDialogAnswers.get(page);
  if (!queue) {
    queue = [];
    pendingDialogAnswers.set(page, queue);
    const answers = queue;
    // Once a listener is attached Playwright no longer dismisses dialogs by itself, so one
    // nobody gave an answer for is dismissed here — what happened to it before this existed.
    page.on('dialog', (dialog) => {
      const next = answers.shift();
      const handled = !next
        ? dialog.dismiss()
        : next.accept
          ? dialog.accept(next.promptText)
          : dialog.dismiss();
      handled.catch(() => {});
    });
  }
  queue.push(answer);
}

/** A tab by what the value says: empty or "new" for the newest, a number from 1, or text in its address or title. */
async function findTab(rt: StepRuntime, wanted: string): Promise<Page | null> {
  const context = rt.page.context();
  const open = () => context.pages().filter((p) => !p.isClosed());

  if (wanted === '' || /^(new|newest|latest|last)$/i.test(wanted)) {
    const others = () => open().filter((p) => p !== rt.page);
    // The click that opens a tab returns before the tab exists, so it is waited for.
    if (!(await holdsWithin(async () => others().length > 0, rt.timeoutMs))) return null;
    return others().at(-1) ?? null;
  }

  if (/^\d+$/.test(wanted)) {
    const index = parseInt(wanted, 10) - 1;
    if (index < 0) return null;
    if (!(await holdsWithin(async () => open().length > index, rt.timeoutMs))) return null;
    return open()[index] ?? null;
  }

  let found: Page | null = null;
  await holdsWithin(async () => {
    for (const page of open()) {
      const title = await page.title().catch(() => '');
      if (page.url().includes(wanted) || title.includes(wanted)) {
        found = page;
        return true;
      }
    }
    return false;
  }, rt.timeoutMs);
  return found;
}

/** What a condition can ask of an element. */
export const CONDITION_STATES = ['visible', 'hidden', 'exists', 'missing', 'checked', 'unchecked', 'enabled', 'disabled'] as const;

/**
 * Compares two values: "{{status}} == Paid", "{{count}} > 3", "{{title}} contains Order".
 * Also takes a bare "true" or "false", which is what a variable holding a flag resolves to.
 */
export function compareValues(expression: string): { value: boolean } | { error: string } {
  const text = expression.trim();
  if (/^true$/i.test(text)) return { value: true };
  if (/^false$/i.test(text)) return { value: false };

  const words = /^(.*?)\s+(not contains|contains)\s+(.*)$/is.exec(text);
  if (words) {
    const found = words[1].trim().includes(words[3].trim());
    return { value: words[2].toLowerCase() === 'contains' ? found : !found };
  }

  const symbols = /^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/s.exec(text);
  if (!symbols) {
    return { error: `"${expression}" is not a comparison. Write it as left == right, !=, >, <, >=, <=, contains or not contains.` };
  }
  const [, rawLeft, operator, rawRight] = symbols;
  const left = rawLeft.trim();
  const right = rawRight.trim();
  if (operator === '==') return { value: left === right };
  if (operator === '!=') return { value: left !== right };
  const a = Number(left);
  const b = Number(right);
  if (left === '' || right === '' || Number.isNaN(a) || Number.isNaN(b)) {
    return { error: `"${left}" ${operator} "${right}" compares values that are not both numbers.` };
  }
  return { value: compareCount(operator, a, b) ?? false };
}

/**
 * The condition of an `if` or a `repeatWhile`.
 *
 * With an element, a state it is in NOW, without waiting: "if the cookie banner is visible,
 * close it" has to answer no straight away when there is no banner, not after fifteen seconds
 * of hoping one appears. A condition about something still loading goes after a wait step.
 * Without an element, a comparison of values.
 */
async function evaluateCondition(rt: StepRuntime, action: string): Promise<{ value: boolean; describe: string } | { error: string }> {
  const wanted = requireValue(rt, action);
  if ('error' in wanted) return wanted;
  const condition = wanted.value.trim();

  if (!rt.selector) {
    const compared = compareValues(condition);
    return 'error' in compared ? compared : { value: compared.value, describe: condition };
  }

  const all = rt.locator(rt.selector);
  const present = (await all.count()) > 0;
  const element = all.first();
  const describe = `"${rt.selector}" ${condition}`;

  const contains = /^(not\s+)?contains:(.*)$/is.exec(condition);
  if (contains) {
    const text = present ? ((await element.textContent().catch(() => null)) ?? '') : '';
    const found = present && text.includes(contains[2]);
    return { value: contains[1] ? !found : found, describe };
  }

  const state = condition.toLowerCase();
  const read: Record<(typeof CONDITION_STATES)[number], () => Promise<boolean>> = {
    visible: async () => present && (await element.isVisible()),
    hidden: async () => !present || !(await element.isVisible()),
    exists: async () => present,
    missing: async () => !present,
    checked: async () => present && (await element.isChecked()),
    unchecked: async () => present && !(await element.isChecked()),
    enabled: async () => present && (await element.isEnabled()),
    disabled: async () => present && (await element.isDisabled()),
  };
  const check = read[state as keyof typeof read];
  if (!check) {
    return {
      error: `Unknown condition "${condition}" for ${action}. With an element use one of ${CONDITION_STATES.join(', ')}, or contains:text.`,
    };
  }
  return { value: await check(), describe };
}

/** Keeps a stored or returned value readable in the report. */
function excerpt(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

type StepHandler = (rt: StepRuntime) => Promise<StepOutcome>;

const HANDLERS: Record<AdhocActionId, StepHandler> = {
  click: async (rt) => {
    const target = requireSelector(rt, 'click');
    if ('error' in target) throw new Error(target.error);
    await rt.click(target.selector);
    return passed;
  },

  input: async (rt) => {
    const target = requireSelector(rt, 'input');
    if ('error' in target) throw new Error(target.error);
    if (typeof rt.raw !== 'string') throw new Error('Value missing for input action.');
    // A recorded password is stored as a `{{secret_…}}` placeholder, never in clear text,
    // and has to resolve here — on every path, which is the point of the shared executor.
    const typed = resolveValue(rt.raw, rt.vars);
    if ('error' in typed) return failed(typed.error);
    await rt.fill(target.selector, typed.value);
    return passed;
  },

  wait: async (rt) => {
    if (typeof rt.raw !== 'string' || isNaN(parseInt(rt.raw))) {
      throw new Error('Invalid or missing value for wait action.');
    }
    await rt.page.waitForTimeout(parseInt(rt.raw));
    return passed;
  },

  scroll: async (rt) => {
    if (rt.selector) {
      await rt.locator(rt.selector).scrollIntoViewIfNeeded();
    } else {
      await rt.page.evaluate(() => window.scrollBy(0, 200));
    }
    return passed;
  },

  navigate: async (rt) => {
    // Only standalone navigations reach here: ones implied by a click are filtered out
    // while recording (see isRedundantNavigation).
    const destination = typeof rt.raw === 'string' ? rt.raw.trim() : '';
    if (!destination) throw new Error('URL (value) missing for navigate action.');
    const target = resolveValue(destination, rt.vars);
    if ('error' in target) return failed(target.error);
    await rt.page.goto(target.value, { waitUntil: 'domcontentloaded' });
    return passed;
  },

  assert: async (rt) => {
    // "Element is visible" — the assertion the recorder emits when the user picks the
    // visibility check in the in-page assert panel. The persisted copy used to only count
    // nodes, so an element present but hidden passed there and failed in the preview.
    const target = requireSelector(rt, 'visibility assert');
    if ('error' in target) return failed(target.error);

    const visible = await holdsWithin(
      () => rt.locator(target.selector).first().isVisible(),
      rt.assertionTimeoutMs,
    );

    return visible
      ? passed
      : failed(
          `Assertion Failed: Element "${target.selector}" was not visible within ` +
            `${rt.assertionTimeoutMs}ms.`,
        );
  },

  /**
   * The state of a control, rather than its presence.
   *
   * "Is this function enabled", "is this box ticked" had no action of its own, so the only
   * way to check one was to fold it into the selector — matching an element that also
   * carries `aria-checked="true"`. That works and reports badly: when the toggle is off the
   * selector matches nothing, and the step says the element was not found. The tester is
   * told to go looking for a control that is on screen in front of them.
   *
   * Reads through Playwright's own accessors, so an Angular Material toggle — a div with a
   * role and aria-checked, not an <input> — answers the same way a checkbox does.
   */
  assertState: async (rt) => {
    const target = requireSelector(rt, 'assertState');
    if ('error' in target) return failed(target.error);
    const wanted = requireValue(rt, 'assertState');
    if ('error' in wanted) return failed(wanted.error);

    const state = wanted.value.trim().toLowerCase() as AssertableState;
    if (!(ASSERTABLE_STATES as readonly string[]).includes(state)) {
      // Named rather than treated as "not true": a typo would otherwise fail the step with
      // a message about the control instead of about the test.
      return failed(
        `Unknown state "${wanted.value}" for assertState. Expected one of: ` +
          `${ASSERTABLE_STATES.join(', ')}.`,
      );
    }

    const element = rt.locator(target.selector).first();
    const read: Record<AssertableState, () => Promise<boolean>> = {
      checked: () => element.isChecked(),
      unchecked: async () => !(await element.isChecked()),
      enabled: () => element.isEnabled(),
      disabled: () => element.isDisabled(),
      editable: () => element.isEditable(),
      readonly: async () => !(await element.isEditable()),
    };

    // Reported separately from "it is not in that state", because they are different
    // problems: isChecked() throws on an element that is not checkable at all, and calling
    // that "unchecked" would hide a test pointed at the wrong element.
    let lastError: string | null = null;
    const held = await holdsWithin(async () => {
      try {
        lastError = null;
        return await read[state]();
      } catch (e: any) {
        lastError = e?.message ?? String(e);
        return false;
      }
    }, rt.assertionTimeoutMs);

    if (!held) {
      return failed(
        lastError
          ? `Assertion Failed: could not read the ${state} state of "${target.selector}" ` +
              `within ${rt.assertionTimeoutMs}ms — ${lastError}`
          : `Assertion Failed: Element "${target.selector}" was not ${state} within ` +
              `${rt.assertionTimeoutMs}ms.`,
      );
    }
    return passed;
  },

  /**
   * Bring a control to a state, rather than perform an operation on it.
   *
   * The step a test's preconditions actually mean. "Enable the NetContent function on this
   * machine" is a statement about the starting point, and `click` cannot express it: a click
   * on a checkbox is a toggle, so it means "enable" only while the box happens to be off.
   * Against an environment where the function was already switched on — which is the normal
   * case for a shared test system, and the case on the second run of the same test — the
   * setup step switched it back off and the test then failed on a tab that never appeared.
   *
   * So: read first, click only on a difference, and report which of the two happened.
   */
  ensureState: async (rt) => {
    const target = requireSelector(rt, 'ensureState');
    if ('error' in target) return failed(target.error);
    const wanted = requireValue(rt, 'ensureState');
    if ('error' in wanted) return failed(wanted.error);

    const state = wanted.value.trim().toLowerCase() as SettableState;
    if (!(SETTABLE_STATES as readonly string[]).includes(state)) {
      // Whether a control is enabled or read-only is the application's decision. A test
      // asking to "set" one of those is describing something it cannot do, and saying so is
      // more useful than clicking and reporting whatever happened next.
      const assertOnly = ASSERTABLE_STATES.filter(
        (s) => !(SETTABLE_STATES as readonly string[]).includes(s),
      );
      return failed(
        `Unknown state "${wanted.value}" for ensureState. Expected one of: ` +
          `${SETTABLE_STATES.join(', ')}. ` +
          `${assertOnly.join(', ')} are decided by the application under test — ` +
          `assert them with assertState instead of setting them.`,
      );
    }

    const element = rt.locator(target.selector).first();
    const wantChecked = state === 'checked';

    let current: boolean;
    try {
      current = await element.isChecked();
    } catch (e: any) {
      // Distinct from "it is in the wrong state": isChecked() throws on an element that has
      // no checked state at all, and clicking that would be a guess about what the test meant.
      return failed(
        `Could not read the checked state of "${target.selector}" — ${e?.message ?? String(e)}. ` +
          `ensureState needs a checkbox, a radio, or an element that exposes aria-checked.`,
      );
    }

    if (current === wantChecked) {
      return { status: 'passed', detail: `Already ${state}. Nothing changed.` };
    }

    // Through rt.click rather than element.check(): check() insists on a real input or
    // role="checkbox", which rules out the role="switch" toggles Angular Material renders,
    // and going through rt.click keeps the AI healing pass in the loop on the persisted path.
    await rt.click(target.selector);

    const reached = await holdsWithin(
      async () => (await element.isChecked()) === wantChecked,
      rt.assertionTimeoutMs,
    );
    if (!reached) {
      return failed(
        `"${target.selector}" was still not ${state} ${rt.assertionTimeoutMs}ms after being clicked.`,
      );
    }
    return { status: 'passed', detail: `Set to ${state}.` };
  },

  assertTextContains: async (rt) => {
    const target = requireSelector(rt, 'assertTextContains');
    if ('error' in target) return failed(target.error);
    const expected = requireValue(rt, 'assertTextContains');
    if ('error' in expected) return failed(expected.error);

    // Kept so the failure can say what it saw, rather than only what it wanted.
    let actualText: string | null = null;

    const contains = await holdsWithin(async () => {
      actualText = await rt.locator(target.selector).first().textContent();
      // Case-sensitive, as before. This is why the check is written out rather than handed
      // to `filter({ hasText })`, which would quietly start accepting the wrong case.
      return actualText !== null && actualText.includes(expected.value);
    }, rt.assertionTimeoutMs);

    if (!contains) {
      return failed(
        `Assertion Failed: Element "${target.selector}" did not contain text ` +
          `"${expected.value}" within ${rt.assertionTimeoutMs}ms. ` +
          `Actual: "${actualText === null ? 'null' : actualText}".`,
      );
    }
    return passed;
  },

  assertElementCount: async (rt) => {
    const target = requireSelector(rt, 'assertElementCount');
    if ('error' in target) return failed(target.error);
    if (typeof rt.raw !== 'string' || rt.raw.trim() === '') {
      return failed('Expected count (value) missing or empty for assertElementCount action.');
    }
    const parsed = parseAssertionValue(rt.raw);
    if (!parsed) {
      return failed(
        `Invalid format for assertElementCount value: "${rt.raw}". ` +
          'Expected format like "==5", ">=2", or "3".',
      );
    }
    // An unknown operator is a broken step, not a state to wait for: say so immediately
    // rather than spending the assertion's patience discovering it again every 100ms.
    if (compareCount(parsed.operator, 0, parsed.count) === null) {
      return failed(`Unknown operator "${parsed.operator}" for assertElementCount.`);
    }

    let actualCount = 0;

    const matched = await holdsWithin(async () => {
      actualCount = await rt.locator(target.selector).count();
      return compareCount(parsed.operator, actualCount, parsed.count) === true;
    }, rt.assertionTimeoutMs);

    if (!matched) {
      return failed(
        `Assertion Failed: Element count for selector "${target.selector}" did not match ` +
          `within ${rt.assertionTimeoutMs}ms. ` +
          `Expected ${parsed.operator} ${parsed.count}, Actual: ${actualCount}.`,
      );
    }
    return passed;
  },

  hover: async (rt) => {
    const target = requireSelector(rt, 'hover');
    if ('error' in target) throw new Error(target.error);
    await rt.locator(target.selector).first().hover();
    return passed;
  },

  select: async (rt) => {
    const target = requireSelector(rt, 'select');
    if ('error' in target) return failed(target.error);
    const option = requireValue(rt, 'select');
    if ('error' in option) return failed(option.error);
    await rt.locator(target.selector).first().selectOption(option.value);
    return passed;
  },

  /**
   * Waits for an element to reach a state, rather than for a duration.
   *
   * The only wait that existed was a fixed timer, which on a page that renders after a
   * SignalR push is a guess: too short and the test fails for a reason that has nothing to
   * do with what it checks, too long and every run pays for it.
   */
  waitForElement: async (rt) => {
    const target = requireSelector(rt, 'waitForElement');
    if ('error' in target) return failed(target.error);

    const wanted = typeof rt.raw === 'string' ? rt.raw.trim().toLowerCase() : '';
    const state = wanted === 'hidden' ? 'hidden' : 'visible';

    try {
      await rt.locator(target.selector).first().waitFor({ state, timeout: rt.timeoutMs });
      return passed;
    } catch {
      // Playwright's own timeout message describes the locator machinery, not the intent.
      return failed(
        `Timed out after ${rt.timeoutMs}ms waiting for "${target.selector}" to be ${state}.`,
      );
    }
  },

  /** Waits for an element to contain text — the "did the update arrive yet" wait. */
  waitForText: async (rt) => {
    const target = requireSelector(rt, 'waitForText');
    if ('error' in target) return failed(target.error);
    const expected = requireValue(rt, 'waitForText');
    if ('error' in expected) return failed(expected.error);

    try {
      // `filter({ hasText })` takes the text as data, so it needs no escaping — unlike
      // building a `:has-text("…")` selector string out of whatever the tester typed.
      await rt
        .locator(target.selector)
        .filter({ hasText: expected.value })
        .first()
        .waitFor({ state: 'attached', timeout: rt.timeoutMs });
      return passed;
    } catch {
      const actual = await rt.locator(target.selector).first().textContent().catch(() => null);
      return failed(
        `Timed out after ${rt.timeoutMs}ms waiting for "${target.selector}" to contain ` +
          `"${expected.value}". Last seen: "${actual ?? 'nothing'}".`,
      );
    }
  },

  /** Waits for in-flight requests to settle, for the "saved, now reload the grid" case. */
  waitForNetworkIdle: async (rt) => {
    try {
      await rt.page.waitForLoadState('networkidle', { timeout: rt.timeoutMs });
      return passed;
    } catch {
      // Unlike the screenshot helper, which swallows this: here the wait *is* the step, so
      // a page that never settles is the step's result, not a detail to hide.
      return failed(
        `Timed out after ${rt.timeoutMs}ms waiting for network activity to settle. ` +
          'A page with a persistent connection (long-polling, WebSocket, SignalR) may never ' +
          'go idle — wait for an element or a text instead.',
      );
    }
  },

  /**
   * Checks the page, as it is at this point of the flow, with axe-core.
   *
   * The value is the least severe violation that fails the step; empty means "serious". Every
   * violation is kept on the step whether it failed it or not, so the report shows the minor
   * ones too without turning the build red over them.
   */
  assertAccessible: async (rt) => {
    const wanted = typeof rt.raw === 'string' ? rt.raw.trim().toLowerCase() : '';
    if (wanted !== '' && !isAccessibilityImpact(wanted)) {
      return failed(`Unknown severity "${rt.raw}" for assertAccessible. Use one of: ${ACCESSIBILITY_IMPACTS.join(', ')}.`);
    }
    const threshold = wanted === '' ? DEFAULT_ACCESSIBILITY_THRESHOLD : wanted;
    const finding = await rt.scanAccessibility(threshold);
    return {
      status: finding.blocking > 0 ? 'failed' : 'passed',
      ...(finding.blocking > 0 ? { error: describeFinding(finding) } : { detail: describeFinding(finding) }),
      accessibility: finding,
    };
  },

  /**
   * The page's speed as the browser measured it: Core Web Vitals and the timings around them,
   * against the limits in the value (shared/web-performance.ts). Empty checks the Core Web
   * Vitals' "good" thresholds. A metric this browser cannot measure is reported, not failed.
   */
  /**
   * Where the browser says it is: navigator.geolocation answers with this point from now on, in
   * every tab of the test, and the page is allowed to ask without a prompt.
   */
  setGeolocation: async (rt) => {
    const wanted = requireValue(rt, 'setGeolocation');
    if ('error' in wanted) return failed(wanted.error);
    const point = parseGeolocation(wanted.value);
    if ('error' in point) return failed(point.error);
    const context = rt.page.context();
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(point);
    return { status: 'passed', detail: `The browser is now at ${point.latitude}, ${point.longitude} (±${point.accuracy} m).` };
  },

  /**
   * Clicks the element and takes the file it downloads: checks its name, kind, size and content
   * (shared/downloads.ts), keeps it with the run's evidence, and sets {{download.name}},
   * {{download.size}}, {{download.rows}}, {{download.pages}} and {{download.text}} for later steps.
   */
  expectDownload: async (rt) => {
    const target = requireSelector(rt, 'expectDownload');
    if ('error' in target) return failed(target.error);
    const text = typeof rt.raw === 'string' ? rt.raw : '';
    const resolved = text.trim() ? resolveValue(text, rt.vars) : { value: '' };
    if ('error' in resolved) return failed(resolved.error);
    const checks = parseDownloadChecks(resolved.value);
    if ('error' in checks) return failed(checks.error);

    let download: Download;
    try {
      [download] = await Promise.all([
        rt.page.waitForEvent('download', { timeout: rt.timeoutMs }),
        rt.click(target.selector),
      ]);
    } catch (error) {
      if (error instanceof Error && /timeout/i.test(error.message)) {
        return failed(`Clicking ${target.selector} did not download a file within ${Math.round(rt.timeoutMs / 1000)} s.`);
      }
      throw error;
    }
    const failure = await download.failure();
    if (failure) return failed(`The download failed: ${failure}.`);
    const name = download.suggestedFilename();
    const dir = rt.artifactDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-download-')));
    await fs.ensureDir(dir);
    const file = path.join(dir, `download_${Date.now()}_${name.replace(/[^\w.-]+/g, '_').slice(-80)}`);
    await download.saveAs(file);
    let inspected: Awaited<ReturnType<typeof inspectDownload>>;
    try {
      inspected = await inspectDownload(file, name);
    } catch (error) {
      return failed(`${name} could not be read: ${(error as Error).message}`);
    } finally {
      if (!rt.artifactDir) await fs.remove(dir).catch(() => undefined);
    }
    const results = runDownloadChecks(inspected.file, inspected.text, checks);
    const finding: DownloadFinding = { ...inspected.file, checks: results, ...(rt.artifactDir ? { fileUrl: file } : {}) };
    rt.storeVariable?.('download.name', name);
    rt.storeVariable?.('download.size', String(inspected.file.size));
    if (inspected.file.rows !== undefined) rt.storeVariable?.('download.rows', String(inspected.file.rows));
    if (inspected.file.pages !== undefined) rt.storeVariable?.('download.pages', String(inspected.file.pages));
    rt.storeVariable?.('download.text', inspected.text.slice(0, 2000));
    const kind = `${name} (${inspected.file.type}, ${Math.max(1, Math.round(inspected.file.size / 1024))} KB${inspected.file.rows !== undefined ? `, ${inspected.file.rows} rows` : ''}${inspected.file.pages !== undefined ? `, ${inspected.file.pages} page(s)` : ''})`;
    const wrong = results.filter((r) => !r.ok);
    if (wrong.length) {
      return { status: 'failed', error: `Downloaded ${kind}, but: ${wrong.map((r) => (r.actual ? `${r.text} (found ${r.actual})` : `${r.text} (not found)`)).join('; ')}.`, download: finding };
    }
    return { status: 'passed', detail: `Downloaded ${kind}${results.length ? `; ${results.length} check(s) hold` : ''}.`, download: finding };
  },

  measurePerformance: async (rt) => {
    const text = typeof rt.raw === 'string' && rt.raw.trim() ? rt.raw : DEFAULT_PERFORMANCE_LIMITS;
    const resolved = resolveValue(text, rt.vars);
    if ('error' in resolved) return failed(resolved.error);
    const limits = parsePerformanceLimits(resolved.value);
    if ('error' in limits) return failed(limits.error);
    const measured = await rt.measurePerformance();
    const checks = check(limits, measured.metrics);
    const finding: PerformanceFinding = { url: measured.url, metrics: measured.metrics, checks };
    const line = describeChecks(checks, formatMetric);
    return checks.some((c) => c.ok === false)
      ? { status: 'failed', error: line, performance: finding }
      : { status: 'passed', detail: line, performance: finding };
  },

  /**
   * Lighthouse on the page the test is on: category scores against the limits in the value,
   * and its HTML report kept with the run. Empty records the scores and checks nothing.
   */
  auditLighthouse: async (rt) => {
    const text = typeof rt.raw === 'string' ? rt.raw : '';
    const resolved = text.trim() ? resolveValue(text, rt.vars) : { value: '' };
    if ('error' in resolved) return failed(resolved.error);
    const parsed = parseLighthouseLimits(resolved.value);
    if ('error' in parsed) return failed(parsed.error);
    const url = rt.page.url();
    if (!/^https?:/i.test(url)) return failed('Lighthouse needs a page with a web address: navigate first.');
    let audit: Omit<LighthouseFinding, 'checks'>;
    try {
      audit = await rt.runLighthouse(parsed.formFactor);
    } catch (error) {
      return failed((error as Error).message);
    }
    const checks = check(parsed.limits, audit.scores);
    const finding: LighthouseFinding = { ...audit, checks };
    const scores = Object.entries(audit.scores).map(([k, v]) => `${k} ${v}`).join(', ');
    const failing = checks.filter((c) => c.ok === false);
    if (failing.length) {
      return { status: 'failed', error: `Lighthouse (${audit.formFactor}) below the limit: ${failing.map((c) => `${c.metric} ${c.actual} (limit ${c.op} ${c.value})`).join('; ')}.`, lighthouse: finding };
    }
    return { status: 'passed', detail: `Lighthouse (${audit.formFactor}): ${scores || 'no scores'}.`, lighthouse: finding };
  },

  /**
   * Picks an option from a dropdown that is not a native `<select>`.
   *
   * `select` calls `page.selectOption`, which only drives real `<select>` elements. Angular
   * Material renders a `mat-select` as a div whose options are mounted in a CDK overlay
   * elsewhere in the document, so the whole interaction is click, wait, click. Matching on
   * `role="option"` first covers mat-select, ng-select and anything else that gets its
   * accessibility right, and the text fallback covers the ones that do not.
   */
  selectByText: async (rt) => {
    const target = requireSelector(rt, 'selectByText');
    if ('error' in target) return failed(target.error);
    const wanted = requireValue(rt, 'selectByText');
    if ('error' in wanted) return failed(wanted.error);

    await rt.click(target.selector);

    // One locator, one timeout. Trying the two strategies in sequence meant an option that
    // genuinely is not there cost two full timeouts before the step failed.
    const option = rt
      .byRole('option', wanted.value)
      // Some overlays mark their options with a class instead of a role.
      .or(rt.locator(OPTION_SELECTOR).filter({ hasText: wanted.value }))
      .first();

    try {
      await option.waitFor({ state: 'visible', timeout: rt.timeoutMs });
      await option.click();
      return passed;
    } catch {
      // Fall through to the report below, which says what was on offer instead.
    }

    // Report what was actually on offer: "option not found" sends the tester back to the
    // browser to find out, and the runner already knows.
    const seen = await rt
      .locator(OPTION_SELECTOR)
      .allTextContents()
      .catch(() => [] as string[]);
    const offered = seen.map((t) => t.trim()).filter(Boolean);

    return failed(
      `Could not find option "${wanted.value}" in the dropdown opened by ` +
        `"${target.selector}". ` +
        (offered.length > 0
          ? `Options seen: ${offered.join(', ')}.`
          : 'No options were visible — the trigger may not have opened.'),
    );
  },

  /** On the step's element when it has one, otherwise on whatever has focus. */
  pressKey: async (rt) => {
    const key = requireValue(rt, 'pressKey');
    if ('error' in key) return failed(key.error);
    if (rt.selector) await rt.locator(rt.selector).first().press(key.value.trim());
    else await rt.page.keyboard.press(key.value.trim());
    return passed;
  },

  doubleClick: async (rt) => {
    const target = requireSelector(rt, 'doubleClick');
    if ('error' in target) throw new Error(target.error);
    await rt.locator(target.selector).first().dblclick();
    return passed;
  },

  rightClick: async (rt) => {
    const target = requireSelector(rt, 'rightClick');
    if ('error' in target) throw new Error(target.error);
    await rt.locator(target.selector).first().click({ button: 'right' });
    return passed;
  },

  dragAndDrop: async (rt) => {
    const source = requireSelector(rt, 'dragAndDrop');
    if ('error' in source) return failed(source.error);
    const destination = requireValue(rt, 'dragAndDrop');
    if ('error' in destination) return failed(destination.error);
    // Same frame as the element dragged: a drop into another document is not something a
    // pointer can do either.
    await rt.locator(source.selector).first().dragTo(rt.locator(destination.value.trim()).first());
    return passed;
  },

  /**
   * Hands the page a file, through its file input or through the chooser a button opens.
   *
   * Most upload widgets hide the real `<input type="file">` behind a styled button, and a click
   * on that button opens a native dialog no test can reach. The input takes the file directly,
   * hidden or not; anything else is clicked with the chooser intercepted.
   */
  uploadFile: async (rt) => {
    const target = requireSelector(rt, 'uploadFile');
    if ('error' in target) return failed(target.error);
    const wanted = requireValue(rt, 'uploadFile');
    if ('error' in wanted) return failed(wanted.error);
    const file = parseUploadValue(wanted.value);
    if ('error' in file) return failed(file.error);

    const element = rt.locator(target.selector).first();
    const isFileInput = await element
      .evaluate((node) => node instanceof HTMLInputElement && node.type === 'file')
      .catch(() => false);
    if (isFileInput) {
      await element.setInputFiles(file);
    } else {
      const [chooser] = await Promise.all([
        rt.page.waitForEvent('filechooser', { timeout: rt.timeoutMs }),
        element.click(),
      ]);
      await chooser.setFiles(file);
    }
    return { status: 'passed', detail: `Uploaded ${file.name} (${file.buffer.length} bytes).` };
  },

  handleDialog: async (rt) => {
    const raw = typeof rt.raw === 'string' ? rt.raw : '';
    const resolved = resolveValue(raw, rt.vars);
    if ('error' in resolved) return failed(resolved.error);
    const answer = parseDialogAnswer(resolved.value);
    if (!answer) {
      return failed(`Unknown answer "${raw}" for handleDialog. Use accept, dismiss, or accept:text for a prompt.`);
    }
    queueDialogAnswer(rt.page, answer);
    return {
      status: 'passed',
      detail: answer.accept
        ? `The next dialog will be accepted${answer.promptText !== undefined ? ` with "${answer.promptText}"` : ''}.`
        : 'The next dialog will be dismissed.',
    };
  },

  switchTab: async (rt) => {
    const raw = typeof rt.raw === 'string' ? rt.raw.trim() : '';
    const wanted = resolveValue(raw, rt.vars);
    if ('error' in wanted) return failed(wanted.error);
    const tab = await findTab(rt, wanted.value);
    if (!tab) {
      const open = rt.page.context().pages().map((p, i) => `${i + 1}: ${p.url()}`);
      return failed(
        `No tab matching "${wanted.value || 'the newest'}" within ${rt.timeoutMs}ms. Open tabs — ${open.join(', ')}.`,
      );
    }
    await tab.waitForLoadState('domcontentloaded').catch(() => {});
    await tab.bringToFront();
    return { status: 'passed', page: tab, detail: `Now on ${tab.url()}.` };
  },

  /** Closes the current tab and goes back to the one that opened it, or to the first. */
  closeTab: async (rt) => {
    const remaining = rt.page.context().pages().filter((p) => p !== rt.page && !p.isClosed());
    if (remaining.length === 0) {
      return failed('This is the only open tab; closing it would leave the test nowhere to go.');
    }
    const opener = await rt.page.opener().catch(() => null);
    const next = opener && !opener.isClosed() ? opener : remaining[0];
    await rt.page.close();
    await next.bringToFront();
    return { status: 'passed', page: next, detail: `Back on ${next.url()}.` };
  },

  storeText: async (rt) => {
    const target = requireSelector(rt, 'storeText');
    if ('error' in target) return failed(target.error);
    const name = typeof rt.raw === 'string' ? rt.raw.trim().replace(/^\{\{\s*|\s*\}\}$/g, '') : '';
    if (name === '') return failed('Value missing for storeText action: the name of the variable to store into.');
    if (!VARIABLE_NAME.test(name)) {
      return failed(`"${rt.raw ?? ''}" is not a variable name. Use letters, digits, _ and . — for example orderNumber.`);
    }
    if (!rt.storeVariable) return failed('This run has no variables of its own to store a value in.');

    const element = rt.locator(target.selector).first();
    await element.waitFor({ state: 'attached', timeout: rt.timeoutMs });
    // A field's content is its value; anything else's is the text a person reads on it.
    const read = await element.evaluate((node) => ({
      text:
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement
          ? node.value
          : ((node as HTMLElement).innerText ?? node.textContent ?? ''),
      secret: node instanceof HTMLInputElement && node.type === 'password',
    }));
    const value = read.text.trim();
    rt.storeVariable(name, value);
    // The report is read by more people than the test's variables are.
    return { status: 'passed', detail: `{{${name}}} = ${read.secret ? '(a password field, not shown)' : `"${excerpt(value)}"`}` };
  },

  setCookie: async (rt) => {
    const wanted = requireValue(rt, 'setCookie');
    if ('error' in wanted) return failed(wanted.error);
    const cookie = parseAssignment(wanted.value);
    if (!cookie) return failed(`"${rt.raw}" is not name=value.`);
    const url = rt.page.url();
    if (!/^https?:/i.test(url)) return failed('Open a page first: a cookie is set for the address the tab is on.');
    await rt.page.context().addCookies([{ name: cookie.name, value: cookie.value, url }]);
    return passed;
  },

  clearCookies: async (rt) => {
    await rt.page.context().clearCookies();
    return passed;
  },

  /** Answers the page's requests to an address instead of the server (server/network-mocks.ts). */
  mockRequest: async (rt) => {
    const wanted = requireValue(rt, 'mockRequest');
    if ('error' in wanted) return failed(wanted.error);
    const spec = parseMockSpec(wanted.value);
    if ('error' in spec) return failed(spec.error);
    await installMock(rt.page.context(), spec);
    return {
      status: 'passed',
      detail:
        `${spec.method ?? 'Any'} request to ${spec.pattern} is answered ${spec.status}` +
        `${spec.delayMs ? ` after ${spec.delayMs} ms` : ''}${spec.body ? ` with ${spec.body.length} characters (${spec.contentType.split(';')[0]})` : ', empty'}, for the rest of the test.`,
    };
  },

  blockRequests: async (rt) => {
    const wanted = requireValue(rt, 'blockRequests');
    if ('error' in wanted) return failed(wanted.error);
    const pattern = wanted.value.trim();
    if (!pattern) return failed('Name the address to block: a URL or a pattern such as **/analytics/**.');
    await installBlock(rt.page.context(), pattern);
    return { status: 'passed', detail: `Requests to ${pattern} fail, for the rest of the test.` };
  },

  clearMocks: async (rt) => {
    const count = await clearMocks(rt.page.context());
    return { status: 'passed', detail: count === 0 ? 'No mock or block was set.' : `${count} mock(s) and block(s) taken back: the page reaches the servers again.` };
  },

  setLocalStorage: async (rt) => {
    const wanted = requireValue(rt, 'setLocalStorage');
    if ('error' in wanted) return failed(wanted.error);
    const entry = parseAssignment(wanted.value);
    if (!entry) return failed(`"${rt.raw}" is not key=value.`);
    try {
      await rt.page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [entry.name, entry.value] as const);
    } catch (error: any) {
      return failed(`Could not write localStorage on ${rt.page.url()}: ${error?.message ?? error}. Open a page of the application first.`);
    }
    return passed;
  },

  /**
   * Runs the value in the page. A script with a `return` is the body of an async function;
   * one without is evaluated for its last value, the way a console would.
   *
   * Evaluated as a string through the browser's debugging protocol rather than with
   * `new Function` in the page, so an application whose Content-Security-Policy forbids eval
   * can still be tested. It runs with the page's powers and nothing more.
   */
  executeScript: async (rt) => {
    const wanted = requireValue(rt, 'executeScript');
    if ('error' in wanted) return failed(wanted.error);
    const source = wanted.value;
    let expression = /\breturn\b/.test(source) ? `(async () => {\n${source}\n})()` : source;
    if (rt.args) {
      // A custom action: its script is a function body that reads `args` and `element`.
      // The arguments are resolved one by one and then serialised, rather than substituted
      // into the script's text, so a value holding a quote is a value and not broken code.
      const args: Record<string, string> = {};
      for (const [name, raw] of Object.entries(rt.args)) {
        const resolved = resolveValue(raw, rt.vars);
        if ('error' in resolved) return failed(`Argument ${name}: ${resolved.error}`);
        args[name] = resolved.value;
      }
      const selector = JSON.stringify(rt.selector ?? '');
      expression =
        `(async () => {\nconst args = ${JSON.stringify(args)};\n` +
        `const element = (() => { try { return ${selector} ? document.querySelector(${selector}) : null; } catch { return null; } })();\n` +
        `${source}\n})()`;
    }
    let result: unknown;
    try {
      result = await rt.page.evaluate(expression);
    } catch (error: any) {
      return failed(`The script threw: ${error?.message ?? error}`);
    }
    if (result === false) return failed('The script returned false.');
    return result === undefined
      ? passed
      : { status: 'passed', detail: `Returned ${excerpt(JSON.stringify(result) ?? String(result))}.` };
  },

  setVariable: async (rt) => {
    const wanted = requireValue(rt, 'setVariable');
    if ('error' in wanted) return failed(wanted.error);
    // Split at the first "=", so a value that contains one — a generated token, a query
    // string — stays whole.
    const assignment = parseAssignment(wanted.value);
    if (!assignment || !VARIABLE_NAME.test(assignment.name)) {
      return failed(`"${rt.raw}" is not name=value with a name of letters, digits, _ and . — for example email={{$randomEmail}}.`);
    }
    if (!rt.storeVariable) return failed('This run has no variables of its own to store a value in.');
    rt.storeVariable(assignment.name, assignment.value);
    const shown = assignment.name.startsWith('secret_') ? '(secret, not shown)' : `"${excerpt(assignment.value)}"`;
    return { status: 'passed', detail: `{{${assignment.name}}} = ${shown}` };
  },

  waitForEmail: async (rt) => {
    const wanted = requireValue(rt, 'waitForEmail');
    if ('error' in wanted) return failed(wanted.error);
    const query = parseEmailQuery(wanted.value);
    if ('error' in query) return failed(query.error);
    const config = inboxConfig(rt.vars);
    if (!config) {
      return failed(
        'No test inbox is configured. Add mailpit.url to the environment (for example http://mailpit:8025), ' +
          'or set MAILPIT_URL on the server.',
      );
    }
    if (!rt.storeVariable) return failed('This run has no variables of its own to store the email in.');

    const seconds = Number(rt.vars['mailpit.timeout']);
    const timeoutMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : EMAIL_TIMEOUT_MS;
    const fields = ['otp', 'link', 'subject', 'from', 'text'];
    for (const field of fields) rt.forgetVariable?.(`email.${field}`);

    let found;
    try {
      found = await waitForEmail(rt.inboxGet, config, query, rt.startedAt, timeoutMs);
    } catch (error: any) {
      return failed(error?.message ?? String(error));
    }
    const wantedSubject = query.subject ? ` with "${query.subject}" in the subject` : '';
    if (!found) {
      return failed(
        `No email to ${query.address}${wantedSubject} arrived within ${Math.round(timeoutMs / 1000)}s at ${config.url}. ` +
          "Check that the application's SMTP server is that Mailpit (port 1025 by default).",
      );
    }
    const { message, otp, link } = found;
    rt.storeVariable('email.subject', message.subject);
    rt.storeVariable('email.from', message.from);
    rt.storeVariable('email.text', message.text);
    if (otp !== null) rt.storeVariable('email.otp', otp);
    if (link !== null) rt.storeVariable('email.link', link);
    if (query.pattern && otp === null) {
      return failed(`The email "${message.subject}" arrived, but the pattern /${query.pattern.source}/ matched nothing in it.`);
    }
    const read = [
      otp !== null ? `{{email.otp}} = "${otp}"` : 'no code found',
      link !== null ? `{{email.link}} = ${excerpt(link)}` : 'no link found',
    ];
    return { status: 'passed', detail: `"${excerpt(message.subject)}" from ${message.from || 'an unknown sender'}: ${read.join(', ')}.` };
  },

  /**
   * Waits for a text message to a test number in the organization's SMS inbox
   * (server/sms-inbox.ts), received after the test started, and reads the code in it:
   * {{sms.otp}}, {{sms.text}}, {{sms.from}}. "number" or "number|pattern", like waitForEmail.
   */
  waitForSms: async (rt) => {
    const wanted = requireValue(rt, 'waitForSms');
    if ('error' in wanted) return failed(wanted.error);
    const query = parseSmsQuery(wanted.value);
    if ('error' in query) return failed(query.error);
    if (!rt.storeVariable) return failed('This run has no variables of its own to store the message in.');
    const seconds = Number(rt.vars['sms.timeout']);
    const timeoutMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : SMS_TIMEOUT_MS;
    for (const field of ['otp', 'text', 'from']) rt.forgetVariable?.(`sms.${field}`);
    const message = await rt.waitForSms(query, rt.startedAt, timeoutMs);
    if (!message) {
      return failed(
        `No text message to ${query.number} arrived within ${Math.round(timeoutMs / 1000)}s. Check that the number's provider ` +
          'forwards incoming messages to the inbound address in Settings → SMS inbox.',
      );
    }
    const otp = findOtp(message.body, query.pattern);
    rt.storeVariable('sms.text', message.body);
    rt.storeVariable('sms.from', message.fromNumber ?? '');
    if (otp !== null) rt.storeVariable('sms.otp', otp);
    if (query.pattern && otp === null) return failed(`A message arrived, but the pattern /${query.pattern.source}/ matched nothing in it.`);
    return { status: 'passed', detail: `Text from ${message.fromNumber || 'an unknown sender'}: ${otp !== null ? `{{sms.otp}} = "${otp}"` : 'no code found'}.` };
  },

  queryDatabase: async (rt) => {
    if (typeof rt.raw !== 'string' || rt.raw.trim() === '') return failed('Value missing for queryDatabase action.');
    // The connection's name is read before substitution: it names a variable, it is not one.
    const query = parseDatabaseQuery(rt.raw);
    if ('error' in query) return failed(query.error);
    const sql = resolveValue(query.sql, rt.vars);
    if ('error' in sql) return failed(sql.error);
    const variable = connectionVariable(query.connection);
    const url = rt.vars[variable];
    if (!url) {
      return failed(`No database is configured: add ${variable} to the environment, for example postgres://user:password@host:5432/shop.`);
    }
    const kind = databaseKind(url);
    if (!kind) return failed(`${variable} is not a postgres://, mysql:// or sqlserver:// address.`);
    if (!rt.storeVariable) return failed('This run has no variables of its own to store the result in.');

    const seconds = Number(rt.vars['db.timeout']);
    const timeoutMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DATABASE_TIMEOUT_MS;
    // The previous query's columns are forgotten, so {{db.total}} never answers for a query
    // that had no such column.
    for (const name of (rt.vars['db.columns'] ?? '').split(',').filter(Boolean)) rt.forgetVariable?.(`db.${name}`);
    for (const name of ['db.rowCount', 'db.value', 'db.json', 'db.columns']) rt.forgetVariable?.(name);

    let result;
    try {
      result = await rt.database(kind, url, sql.value, timeoutMs);
    } catch (error: any) {
      return failed(`The database answered: ${redactMessage(String(error?.message ?? error), url)}`);
    }
    const values = resultVariables(result);
    for (const [name, value] of Object.entries(values)) rt.storeVariable(name, value);
    rt.storeVariable('db.columns', Object.keys(values).filter((n) => !['db.rowCount', 'db.value', 'db.json'].includes(n)).map((n) => n.slice(3)).join(','));
    const described = result.columns.length
      ? `${result.rowCount} row(s); {{db.value}} = "${excerpt(values['db.value'])}"`
      : `${result.rowCount} row(s) changed`;
    return { status: 'passed', detail: `${described}.` };
  },

  assertCondition: async (rt) => {
    const wanted = requireValue(rt, 'assertCondition');
    if ('error' in wanted) return failed(wanted.error);
    const compared = compareValues(wanted.value);
    if ('error' in compared) return failed(compared.error);
    // What the values were, unless one of them is a secret: the report is read by everyone.
    const raw = String(rt.raw).trim();
    const shown = /\{\{\s*secret_/.test(raw) || raw === wanted.value.trim() ? `"${raw}"` : `"${raw}" (${excerpt(wanted.value.trim())})`;
    return compared.value ? { status: 'passed', detail: `${shown} holds.` } : failed(`${shown} does not hold.`);
  },

  if: async (rt) => {
    const result = await evaluateCondition(rt, 'if');
    if ('error' in result) return failed(result.error);
    return {
      status: 'passed',
      condition: result.value,
      detail: `${result.describe}: ${result.value ? 'true, running the steps below' : 'false, skipping them'}.`,
    };
  },

  // Reached only at the end of the branch that ran; the flow cursor moves past the rest.
  else: async () => passed,
  endIf: async () => passed,

  repeat: async (rt) => {
    const wanted = requireValue(rt, 'repeat');
    if ('error' in wanted) return failed(wanted.error);
    const times = Number(wanted.value.trim());
    if (!Number.isInteger(times) || times < 0 || times > MAX_LOOP_ITERATIONS) {
      return failed(`"${wanted.value}" is not a number of times between 0 and ${MAX_LOOP_ITERATIONS}.`);
    }
    return { status: 'passed', iterations: times, detail: `Repeating ${times} time${times === 1 ? '' : 's'}.` };
  },

  repeatWhile: async (rt) => {
    const result = await evaluateCondition(rt, 'repeatWhile');
    if ('error' in result) return failed(result.error);
    return {
      status: 'passed',
      condition: result.value,
      detail: `${result.describe}: ${result.value ? 'true, running the loop' : 'false, leaving the loop'}.`,
    };
  },

  endLoop: async () => passed,
};

/**
 * Actions this executor can run.
 *
 * Derived from the handler map, not from `ADHOC_ACTION_IDS`: an earlier version read the
 * declaration list, which made the coverage test compare the list to itself.
 */
export const HANDLED_ACTION_IDS: ReadonlySet<AdhocActionId> = new Set(
  Object.keys(HANDLERS) as AdhocActionId[],
);

/**
 * Runs one step against the page.
 *
 * Returns a failed outcome for an assertion that did not hold, a wait that timed out, or a
 * step missing a selector or value — normal product outcomes the caller records against the
 * step. Throws for an interaction that could not be carried out at all, which the caller
 * already catches and reports the same way.
 */
export async function executeStep(ctx: StepContext, step: ExecutableStep): Promise<StepOutcome> {
  const { page, reporter } = ctx;
  const actionId = step.action?.id;
  const actionName = step.action?.name || 'Unnamed Action';

  if (!actionId) throw new Error('Step action ID is missing.');

  const handler = HANDLERS[actionId as AdhocActionId];
  if (!handler) throw new Error(`Unsupported action ID: ${actionId}`);

  // Where this step's selectors resolve: the page, or the iframe chain the element was
  // detected in. page.locator does not cross that boundary, so without this an element
  // inside a frame is unreachable however correct its selector is.
  const scope = frameScope(page, step.targetElement?.frameSelector);

  const rt: StepRuntime = {
    page,
    vars: ctx.vars ?? requestVariables(),
    selector: step.targetElement?.selector,
    raw: step.value,
    args: step.args ?? null,
    actionName,
    // The reporter drives the page directly and knows nothing about frames, so a step
    // inside one goes straight to the locator. It loses AI healing for that step, which is
    // the honest trade: healing a selector in the wrong document would be worse.
    click: (sel) =>
      reporter && scope === page
        ? reporter.click(sel, actionName)
        : scope.locator(sel).first().click(),
    fill: (sel, value) =>
      reporter && scope === page
        ? reporter.fill(sel, value, actionName)
        : scope.locator(sel).first().fill(value),
    locator: (sel) => scope.locator(sel),
    byRole: (role, name) => scope.getByRole(role as any, { name, exact: false }),
    timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
    assertionTimeoutMs: ASSERTION_TIMEOUT_MS,
    // The whole page, not the step's frame: an accessibility check is about what a person
    // meets, and they meet the page.
    scanAccessibility: (threshold) => scanAccessibility(page, threshold),
    ...(ctx.vars
      ? {
          storeVariable: (name: string, value: string) => {
            ctx.vars![name] = value;
          },
          forgetVariable: (name: string) => {
            delete ctx.vars![name];
          },
        }
      : {}),
    startedAt: ctx.startedAt ?? Date.now(),
    artifactDir: ctx.artifactDir,
    waitForSms: ctx.waitForSms ?? ((query, since, timeoutMs) => waitForSmsInInbox(query, since, timeoutMs)),
    inboxGet: async (url, headers) => {
      const response = await page.context().request.get(url, {
        headers,
        ignoreHTTPSErrors: allowsSelfSignedCertificate(url),
        timeout: 15_000,
      });
      return { status: response.status(), json: () => response.json() };
    },
    database: ctx.database ?? runDatabaseQuery,
    measurePerformance: ctx.measurePerformance ?? (() => measurePagePerformance(page)),
    runLighthouse:
      ctx.runLighthouse ??
      (async (formFactor) => {
        const url = page.url();
        const cookies = await page.context().cookies(url).catch(() => []);
        return runLighthouse({
          url,
          formFactor,
          cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join('; ') || undefined,
          outputDir: ctx.artifactDir,
        });
      }),
  };

  return handler(rt);
}

/** Every action id the engine knows, in declaration order. Re-exported for the client. */
export { ADHOC_ACTION_IDS };
