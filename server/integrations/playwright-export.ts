import type { Cleanup, Precondition } from '@shared/schema';
import { STEP_GROUP_ACTION_ID, type AdhocActionId } from '@shared/recording';
import { parseGeolocation } from '@shared/downloads';
import { parseMockSpec } from '../authoring/network-mocks';
import { datasetRows } from '../web/playwright/run-helpers';
import {
  parseAssertionValue,
  parseAssignment,
  parseDialogAnswer,
  parseUploadValue,
} from '../web/step-executor';

/**
 * A web test as a Playwright Test file (`*.spec.ts`), to run without WebFlowMaster, in a
 * repository beside the application, or to take further by hand (P15, M04).
 *
 * The steps are the ones a run executes: the caller picks the version and expands step groups and
 * custom actions with that version's own dependencies (server/integrations/playwright-export-source.ts).
 * Each action becomes the Playwright calls that do what the runner does (server/web/step-executor.ts):
 * the same waits, the same patience for assertions, the same comparisons, the same failure when a
 * {{variable}} has no value. ACTION_CONFORMANCE says, for every action, whether that holds fully,
 * with a known difference, or not at all; docs/en/guide/playwright-export.md is that table verified.
 *
 * Two modes:
 *  - strict, for CI: a test with anything the file cannot do the way a run does is refused with
 *    the list (ExportNotConformantError). It never returns code that only looks equivalent.
 *  - draft, for a person: the file is written anyway, and each step it cannot do is a call to
 *    notExported(), which throws where the step was. A draft fails until it is finished by hand;
 *    it is never green by leaving steps out, and never relies on test.skip.
 *
 * {{variables}} come from environment variables, WFM_<NAME> (WFM_BASEURL for {{baseUrl}},
 * WFM_SECRET_PASSWORD for {{secret_password}}). Secrets stay placeholders: the file reads them at
 * run time and never contains them, and a literal credential in a header or a body is refused
 * rather than copied into the code.
 */

export interface ExportableStep {
  action?: { id?: string; name?: string } | null;
  value?: unknown;
  targetElement?: { selector?: string; frameSelector?: string | null; text?: string } | null;
  /** Set on the step a custom action call expands into (server/authoring/custom-actions.ts). */
  args?: Record<string, string> | null;
}

/** Which definition the file was made from, for its header and the response headers. */
export interface ExportSource {
  /** published: the version plans run; version: a saved version picked by number; working: the unsaved copy. */
  kind: 'published' | 'version' | 'working';
  version: number | null;
}

export interface ExportableTest {
  name: string;
  url: string;
  sequence: ExportableStep[];
  preconditions?: Precondition[] | null;
  cleanups?: Cleanup[] | null;
  /** Rows to run over: one test per row. */
  dataset?: unknown;
  source?: ExportSource | null;
}

export type ExportMode = 'draft' | 'strict';
export type ConformanceSupport = 'supported' | 'partial' | 'unsupported';

/** Something in the test the file does not do the way a run does. */
export interface ExportFinding {
  /** 1-based position in the expanded steps; null for the test's setup, cleanup or data. */
  step: number | null;
  area: ConformanceArea;
  support: Exclude<ConformanceSupport, 'supported'>;
  /** What it is: the step's action and value, or the precondition's name. */
  label: string;
  reason: string;
}

export interface PlaywrightExport {
  fileName: string;
  code: string;
  mode: ExportMode;
  /** True when nothing was found: every step is done the way a run does it. */
  complete: boolean;
  findings: ExportFinding[];
  /** "label: reason" of each step the file does not do (it throws there). */
  notExported: string[];
  variables: string[];
  source: ExportSource | null;
}

/** A strict export refused: the test holds what the file could not do faithfully. */
export class ExportNotConformantError extends Error {
  constructor(readonly findings: ExportFinding[]) {
    super(
      `This test cannot be exported strictly: ${findings.length} item(s) have no faithful Playwright equivalent — ` +
        findings.map((f) => `${f.step ? `step ${f.step} ` : ''}${f.label}: ${f.reason}`).join('; '),
    );
    this.name = 'ExportNotConformantError';
  }
}

interface ConformanceRow {
  support: ConformanceSupport;
  how: string;
}

/**
 * What each action becomes. Typed over every action id, so a new action cannot ship without a
 * row; `unsupported` actions are refused by strict and throw in a draft.
 */
export const ACTION_CONFORMANCE: Record<AdhocActionId, ConformanceRow> = {
  click: { support: 'supported', how: 'locator.first().click()' },
  doubleClick: { support: 'supported', how: 'locator.first().dblclick()' },
  rightClick: { support: 'supported', how: "locator.first().click({ button: 'right' })" },
  hover: { support: 'supported', how: 'locator.first().hover()' },
  input: { support: 'supported', how: 'locator.first().fill(value); an unset {{variable}} fails' },
  select: { support: 'supported', how: 'locator.first().selectOption(value)' },
  selectByText: {
    support: 'supported',
    how: 'click, then the option by role or by the overlay classes, visible within 15 s',
  },
  wait: { support: 'supported', how: 'page.waitForTimeout(ms); the value is a literal number' },
  scroll: {
    support: 'supported',
    how: 'locator.scrollIntoViewIfNeeded(), or window.scrollBy(0, 200)',
  },
  navigate: { support: 'supported', how: "page.goto(url, { waitUntil: 'domcontentloaded' })" },
  assert: { support: 'supported', how: 'visible within 5 s (polled, as a run does)' },
  assertTextContains: {
    support: 'supported',
    how: 'textContent includes the text (case-sensitive) within 5 s',
  },
  assertElementCount: { support: 'supported', how: 'count compared with the operator within 5 s' },
  assertState: { support: 'supported', how: 'checked/enabled/editable… polled within 5 s' },
  ensureState: {
    support: 'supported',
    how: 'reads isChecked, clicks only on a difference, then waits 5 s for the state',
  },
  waitForElement: {
    support: 'supported',
    how: "waitFor({ state: 'visible' | 'hidden', timeout: 15 s })",
  },
  waitForText: {
    support: 'supported',
    how: "filter({ hasText }).waitFor({ state: 'attached', timeout: 15 s })",
  },
  waitForNetworkIdle: { support: 'supported', how: "waitForLoadState('networkidle', 15 s)" },
  pressKey: { support: 'supported', how: 'on the element when it has one, else page.keyboard' },
  dragAndDrop: { support: 'supported', how: 'dragTo the destination in the same frame' },
  uploadFile: {
    support: 'supported',
    how: 'setInputFiles on a file input, else the file chooser the click opens; the name is a literal',
  },
  handleDialog: {
    support: 'supported',
    how: 'a queue of answers per tab; unanswered dialogs are dismissed',
  },
  switchTab: {
    support: 'supported',
    how: 'newest, number or text in address/title, waited for 15 s',
  },
  closeTab: { support: 'supported', how: 'back to the opener, else the first tab left' },
  storeText: { support: 'supported', how: 'field value or innerText, trimmed, into the variables' },
  setCookie: { support: 'supported', how: 'addCookies for the address the tab is on' },
  clearCookies: { support: 'supported', how: 'context.clearCookies()' },
  setLocalStorage: { support: 'supported', how: 'localStorage.setItem in the page' },
  executeScript: {
    support: 'supported',
    how: 'page.evaluate of the same expression (custom-action args and element included); false fails',
  },
  setVariable: { support: 'supported', how: 'into the variables; generators ({{$…}}) are refused' },
  assertCondition: {
    support: 'supported',
    how: 'the same comparison rules; non-numbers with > < fail',
  },
  mockRequest: {
    support: 'supported',
    how: 'context.route + fulfill, method filter, delay, CORS header',
  },
  blockRequests: { support: 'supported', how: "route.abort('blockedbyclient')" },
  clearMocks: { support: 'supported', how: 'unrouteAll (the file installs no other routes)' },
  setGeolocation: {
    support: 'supported',
    how: 'grantPermissions + setGeolocation; the point is a literal',
  },
  if: { support: 'supported', how: 'if/else; element conditions read now, without waiting' },
  else: { support: 'supported', how: '} else {' },
  endIf: { support: 'supported', how: '}' },
  repeat: { support: 'supported', how: 'for loop of 0…200, {{loopIndex}} from 1' },
  repeatWhile: {
    support: 'supported',
    how: 'for loop that fails after 200 rounds, {{loopIndex}} from 1',
  },
  endLoop: { support: 'supported', how: '} and {{loopIndex}} back to the outer loop' },
  waitForEmail: { support: 'unsupported', how: "reads the environment's test inbox (Mailpit)" },
  waitForSms: { support: 'unsupported', how: "reads the organization's SMS inbox" },
  queryDatabase: {
    support: 'unsupported',
    how: "queries the environment's database through WebFlowMaster",
  },
  assertAccessible: {
    support: 'unsupported',
    how: 'the axe-core scan and its thresholds run in WebFlowMaster',
  },
  measurePerformance: {
    support: 'unsupported',
    how: 'the Web Vitals collection runs in WebFlowMaster',
  },
  auditLighthouse: { support: 'unsupported', how: 'Lighthouse runs in WebFlowMaster' },
  expectDownload: {
    support: 'unsupported',
    how: 'the download checks and {{download.*}} run in WebFlowMaster',
  },
};

export type ConformanceArea =
  | 'action'
  | 'frame'
  | 'tab'
  | 'data'
  | 'group'
  | 'setup'
  | 'cleanup'
  | 'variables'
  | 'flow'
  | 'secrets';

/** The rest of a test, beyond its actions. */
export const FEATURE_CONFORMANCE: Record<string, ConformanceRow & { area: ConformanceArea }> = {
  frames: { area: 'frame', support: 'supported', how: 'frameLocator chain, outermost first' },
  tabs: { area: 'tab', support: 'supported', how: 'switchTab/closeTab, handleDialog per tab' },
  dataset: {
    area: 'data',
    support: 'supported',
    how: 'one Playwright test per row, values as strings',
  },
  datasetWithPreconditions: {
    area: 'data',
    support: 'partial',
    how: 'a run makes the preconditions once for all rows; the file makes them once per row',
  },
  groups: {
    area: 'group',
    support: 'supported',
    how: "expanded before export, from the exported version's own dependencies",
  },
  preconditions: {
    area: 'setup',
    support: 'supported',
    how: 'request fixture: check first, satisfiedStatuses, headers and body sent as written',
  },
  cleanups: {
    area: 'cleanup',
    support: 'supported',
    how: 'in finally, each call attempted, 404/410 count as done, never fails the test',
  },
  variables: {
    area: 'variables',
    support: 'supported',
    how: 'WFM_<NAME> environment variables; an unset one fails the step that needs it',
  },
  generators: {
    area: 'variables',
    support: 'unsupported',
    how: '{{$random…}} values are made by WebFlowMaster',
  },
  literalCredentials: {
    area: 'secrets',
    support: 'unsupported',
    how: 'a credential written in a header or body is never copied into the file',
  },
};

/** What a run does that a test file does not, whichever steps it has: settings of the run, not of the test. */
export const RUN_LEVEL_DIFFERENCES = [
  'AI healing of a selector that stopped matching',
  'visual comparison against a baseline',
  'retry of a failed step (plan setting)',
  'screenshots, video and evidence kept by WebFlowMaster',
  'the egress policy on the addresses a test may reach',
  'what a plan does when a precondition fails (continue/skip)',
  'page-load timeout; the element timeout is WFM_ELEMENT_TIMEOUT_MS (30 s by default)',
  'browser, device and viewport: the Playwright configuration decides them',
] as const;

const js = (value: string) => JSON.stringify(value);
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const GENERATOR = /\{\{\s*\$/;
const VARIABLE_NAME = /^[\w.]+$/;
const CREDENTIAL_HEADER =
  /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token)$/i;
const CREDENTIAL_KEY = /pass(word)?|secret|token|api[-_]?key|credential|private[-_]?key/i;
const ELEMENT_CONDITIONS = [
  'visible',
  'hidden',
  'exists',
  'missing',
  'checked',
  'unchecked',
  'enabled',
  'disabled',
];
const ASSERTABLE: Record<string, (e: string) => string> = {
  checked: (e) => `async () => await ${e}.isChecked()`,
  unchecked: (e) => `async () => !(await ${e}.isChecked())`,
  enabled: (e) => `async () => await ${e}.isEnabled()`,
  disabled: (e) => `async () => await ${e}.isDisabled()`,
  editable: (e) => `async () => await ${e}.isEditable()`,
  readonly: (e) => `async () => !(await ${e}.isEditable())`,
};
const COUNT_OPERATORS = ['==', '!=', '>=', '<=', '>', '<'];
const MAX_LOOP_ITERATIONS = 200;
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;
const ASSERTION_TIMEOUT_MS = 5_000;

const namesIn = (value: string) => [...value.matchAll(PLACEHOLDER)].map((m) => m[1]);
/** Takes its secret from a {{variable}} ("Bearer {{secret_token}}"), rather than writing one out. */
const fromVariable = (value: string) => namesIn(value).length > 0;

export function envName(variable: string): string {
  return `WFM_${variable.replace(/[^\w]/g, '_').toUpperCase()}`;
}

export function playwrightFileName(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'test';
  return `${base}.spec.ts`;
}

/** Code the generated file defines only when a step needs it; each lists what it calls. */
const HELPERS: Record<string, { needs: string[]; code: string[] }> = {
  placeholder: { needs: [], code: ['const PLACEHOLDER = /\\{\\{\\s*([\\w.]+)\\s*\\}\\}/g;'] },
  fill: {
    needs: ['placeholder'],
    code: [
      '/** {{name}} filled from the variables. A name with no value fails the step, as it does in a WebFlowMaster run. */',
      'function fill(vars: Record<string, string>, text: string): string {',
      '  const missing = [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].filter((name) => !(name in vars));',
      '  if (missing.length > 0) {',
      "    const keys = missing.map((name) => `WFM_${name.replace(/[^\\w]/g, '_').toUpperCase()}`);",
      "    throw new Error(`Unresolved variable(s): ${missing.join(', ')}. Set ${keys.join(', ')} in the environment.`);",
      '  }',
      '  return text.replace(PLACEHOLDER, (_match, name: string) => vars[name]);',
      '}',
    ],
  },
  fillLoose: {
    needs: ['placeholder'],
    code: [
      '/** The same, leaving an unknown {{name}} as written: what a run does with the start address and API calls. */',
      'function fillLoose(vars: Record<string, string>, text: string): string {',
      '  return text.replace(PLACEHOLDER, (match, name: string) => (name in vars ? vars[name] : match));',
      '}',
    ],
  },
  within: {
    needs: [],
    code: [
      '/** Polls a check until it holds or the time is up; a check that throws counts as not holding. */',
      'async function within(check: () => Promise<boolean>, ms: number): Promise<boolean> {',
      '  const deadline = Date.now() + ms;',
      '  for (;;) {',
      '    if (await check().catch(() => false)) return true;',
      '    if (Date.now() >= deadline) return false;',
      '    await new Promise((resolve) => setTimeout(resolve, 100));',
      '  }',
      '}',
    ],
  },
  holds: {
    needs: [],
    code: [
      '/** "a == b", "a > 3", "a contains b", true, false: the comparisons of an if or an Assert values step. */',
      'function holds(expression: string): boolean {',
      '  const text = expression.trim();',
      '  if (/^true$/i.test(text)) return true;',
      '  if (/^false$/i.test(text)) return false;',
      '  const words = /^(.*?)\\s+(not contains|contains)\\s+(.*)$/is.exec(text);',
      '  if (words) {',
      '    const found = words[1].trim().includes(words[3].trim());',
      "    return words[2].toLowerCase() === 'contains' ? found : !found;",
      '  }',
      '  const m = /^(.*?)\\s*(==|!=|>=|<=|>|<)\\s*(.*)$/s.exec(text);',
      '  if (!m) throw new Error(`"${expression}" is not a comparison.`);',
      '  const left = m[1].trim();',
      '  const op = m[2];',
      '  const right = m[3].trim();',
      "  if (op === '==') return left === right;",
      "  if (op === '!=') return left !== right;",
      '  const a = Number(left);',
      '  const b = Number(right);',
      "  if (left === '' || right === '' || Number.isNaN(a) || Number.isNaN(b))",
      '    throw new Error(`"${left}" ${op} "${right}" compares values that are not both numbers.`);',
      "  return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;",
      '}',
    ],
  },
  elementIs: {
    needs: [],
    code: [
      '/** A condition on an element, as it is now: no waiting, as in a run. */',
      'async function elementIs(all: Locator, condition: string): Promise<boolean> {',
      '  const wanted = condition.trim();',
      '  const present = (await all.count()) > 0;',
      '  const element = all.first();',
      '  const contains = /^(not\\s+)?contains:(.*)$/is.exec(wanted);',
      '  if (contains) {',
      "    const text = present ? ((await element.textContent().catch(() => null)) ?? '') : '';",
      '    const found = present && text.includes(contains[2]);',
      '    return contains[1] ? !found : found;',
      '  }',
      '  switch (wanted.toLowerCase()) {',
      "    case 'visible': return present && (await element.isVisible());",
      "    case 'hidden': return !present || !(await element.isVisible());",
      "    case 'exists': return present;",
      "    case 'missing': return !present;",
      "    case 'checked': return present && (await element.isChecked());",
      "    case 'unchecked': return present && !(await element.isChecked());",
      "    case 'enabled': return present && (await element.isEnabled());",
      "    case 'disabled': return present && (await element.isDisabled());",
      '    default: throw new Error(`Unknown condition "${wanted}".`);',
      '  }',
      '}',
    ],
  },
  times: {
    needs: [],
    code: [
      'function times(value: string): number {',
      '  const n = Number(value.trim());',
      `  if (!Number.isInteger(n) || n < 0 || n > ${MAX_LOOP_ITERATIONS}) throw new Error(\`"\${value}" is not a number of times between 0 and ${MAX_LOOP_ITERATIONS}.\`);`,
      '  return n;',
      '}',
    ],
  },
  dialogs: {
    needs: [],
    code: [
      '/** Answers for the dialogs a tab has not opened yet, in order; one nobody answered is dismissed. */',
      'const dialogAnswers = new WeakMap<Page, Array<{ accept: boolean; promptText?: string }>>();',
      'function answerNextDialog(p: Page, answer: { accept: boolean; promptText?: string }) {',
      '  let queue = dialogAnswers.get(p);',
      '  if (!queue) {',
      '    const answers: Array<{ accept: boolean; promptText?: string }> = [];',
      '    queue = answers;',
      '    dialogAnswers.set(p, answers);',
      "    p.on('dialog', (dialog) => {",
      '      const next = answers.shift();',
      '      (!next ? dialog.dismiss() : next.accept ? dialog.accept(next.promptText) : dialog.dismiss()).catch(() => {});',
      '    });',
      '  }',
      '  queue.push(answer);',
      '}',
    ],
  },
  tabs: {
    needs: ['within'],
    code: [
      '/** A tab by what the step says: empty or "new" for the newest, a number from 1, or text in its address or title. */',
      'async function switchTab(p: Page, wanted: string): Promise<Page> {',
      '  const open = () => p.context().pages().filter((tab) => !tab.isClosed());',
      '  const hit: { tab?: Page } = {};',
      "  if (wanted === '' || /^(new|newest|latest|last)$/i.test(wanted)) {",
      '    const others = () => open().filter((tab) => tab !== p);',
      `    if (await within(async () => others().length > 0, ${DEFAULT_WAIT_TIMEOUT_MS})) hit.tab = others().at(-1);`,
      '  } else if (/^\\d+$/.test(wanted)) {',
      '    const index = Number.parseInt(wanted, 10) - 1;',
      `    if (index >= 0 && (await within(async () => open().length > index, ${DEFAULT_WAIT_TIMEOUT_MS}))) hit.tab = open()[index];`,
      '  } else {',
      '    await within(async () => {',
      '      for (const tab of open()) {',
      "        const title = await tab.title().catch(() => '');",
      '        if (tab.url().includes(wanted) || title.includes(wanted)) {',
      '          hit.tab = tab;',
      '          return true;',
      '        }',
      '      }',
      '      return false;',
      `    }, ${DEFAULT_WAIT_TIMEOUT_MS});`,
      '  }',
      `  if (!hit.tab) throw new Error(\`No tab matching "\${wanted || 'the newest'}" within ${DEFAULT_WAIT_TIMEOUT_MS}ms.\`);`,
      "  await hit.tab.waitForLoadState('domcontentloaded').catch(() => {});",
      '  await hit.tab.bringToFront();',
      '  return hit.tab;',
      '}',
      '',
      '/** Closes the tab and goes back to the one that opened it, or to the first. */',
      'async function closeTab(p: Page): Promise<Page> {',
      '  const remaining = p.context().pages().filter((tab) => tab !== p && !tab.isClosed());',
      "  if (remaining.length === 0) throw new Error('This is the only open tab; closing it would leave the test nowhere to go.');",
      '  const opener = await p.opener().catch(() => null);',
      '  const next = opener && !opener.isClosed() ? opener : remaining[0];',
      '  await p.close();',
      '  await next.bringToFront();',
      '  return next;',
      '}',
    ],
  },
  upload: {
    needs: [],
    code: [
      '/** Hands the page a file: through the file input, or through the chooser a click on a styled button opens. */',
      'async function upload(p: Page, element: Locator, file: { name: string; mimeType: string; buffer: Buffer }) {',
      "  const isFileInput = await element.evaluate((node) => node instanceof HTMLInputElement && node.type === 'file').catch(() => false);",
      '  if (isFileInput) return element.setInputFiles(file);',
      `  const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: ${DEFAULT_WAIT_TIMEOUT_MS} }), element.click()]);`,
      '  await chooser.setFiles(file);',
      '}',
    ],
  },
  readText: {
    needs: [],
    code: [
      "/** A field's value, or the text a person reads on anything else, trimmed. */",
      'async function readText(element: Locator): Promise<string> {',
      `  await element.waitFor({ state: 'attached', timeout: ${DEFAULT_WAIT_TIMEOUT_MS} });`,
      '  const text = await element.evaluate((node) =>',
      '    node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement',
      '      ? node.value',
      "      : ((node as HTMLElement).innerText ?? node.textContent ?? ''),",
      '  );',
      '  return text.trim();',
      '}',
    ],
  },
  api: {
    needs: ['fillLoose'],
    code: [
      'interface ApiCall {',
      '  name: string;',
      '  method: string;',
      '  url: string;',
      '  query: Array<[string, string]>;',
      '  headers: Record<string, string>;',
      '  body?: string;',
      '  satisfiedStatuses?: number[];',
      '}',
      '',
      'function address(vars: Record<string, string>, url: string, query: Array<[string, string]>): string {',
      '  const filled = fillLoose(vars, url);',
      '  if (query.length === 0) return filled;',
      '  const u = new URL(filled);',
      '  for (const [key, value] of query) u.searchParams.set(key, fillLoose(vars, value));',
      '  return u.toString();',
      '}',
    ],
  },
  precondition: {
    needs: ['api'],
    code: [
      'interface ApiCheck {',
      '  method: string;',
      '  url: string;',
      '  query: Array<[string, string]>;',
      '  headers: Record<string, string>;',
      '  expectStatus?: number[];',
      '  bodyContains?: string;',
      '  jsonPath?: string;',
      '  equals?: string | number | boolean;',
      '}',
      '',
      '/** Whether the starting point is already there; a check that cannot be made says no. */',
      'async function alreadyThere(request: APIRequestContext, vars: Record<string, string>, check: ApiCheck): Promise<boolean> {',
      '  try {',
      '    const res = await request.fetch(address(vars, check.url, check.query), { method: check.method, headers: check.headers, failOnStatusCode: false });',
      '    if (!(check.expectStatus ? check.expectStatus.includes(res.status()) : res.ok())) return false;',
      '    if (!check.jsonPath && check.bodyContains === undefined) return true;',
      '    const text = await res.text();',
      '    if (check.bodyContains !== undefined) {',
      '      if (!text.includes(fillLoose(vars, check.bodyContains))) return false;',
      '      if (!check.jsonPath) return true;',
      '    }',
      "    const actual = check.jsonPath!.split('.').filter(Boolean).reduce<unknown>(",
      "      (node, key) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),",
      '      JSON.parse(text),',
      '    );',
      '    if (check.equals === undefined) return actual !== undefined && actual !== null && actual !== false;',
      "    const wanted = typeof check.equals === 'string' ? fillLoose(vars, check.equals) : check.equals;",
      '    return actual === wanted || String(actual) === String(wanted);',
      '  } catch {',
      '    return false;',
      '  }',
      '}',
      '',
      '/** A precondition: skipped when its check holds; a status in satisfiedStatuses counts as done. */',
      'async function precondition(request: APIRequestContext, vars: Record<string, string>, call: ApiCall & { check?: ApiCheck }) {',
      '  if (call.check && (await alreadyThere(request, vars, call.check))) return;',
      '  let url: string;',
      '  try {',
      '    url = address(vars, call.url, call.query);',
      '  } catch {',
      '    throw new Error(`Precondition "${call.name}" failed: invalid URL: ${fillLoose(vars, call.url)}`);',
      '  }',
      '  const res = await request',
      '    .fetch(url, { method: call.method, headers: call.headers, data: call.body, failOnStatusCode: false })',
      '    .catch((error: Error) => {',
      '      throw new Error(`Precondition "${call.name}" failed: request error: ${error.message}`);',
      '    });',
      '  if (!res.ok() && !(call.satisfiedStatuses ?? []).includes(res.status()))',
      '    throw new Error(`Precondition "${call.name}" failed: HTTP ${res.status()} from ${call.method} ${url}`);',
      '}',
    ],
  },
  cleanup: {
    needs: ['api'],
    code: [
      '/** A cleanup call: never fails the test. Not made when a {{variable}} it needs was never set; 404 and 410 mean already gone. */',
      'async function cleanup(request: APIRequestContext, vars: Record<string, string>, call: ApiCall) {',
      '  const url = fillLoose(vars, call.url);',
      '  const query = call.query.map(([key, value]) => [key, fillLoose(vars, value)] as const);',
      '  const headers = Object.fromEntries(Object.entries(call.headers).map(([key, value]) => [key, fillLoose(vars, value)]));',
      '  const body = call.body === undefined ? undefined : fillLoose(vars, call.body);',
      '  const missing = [url, body, ...query.map(([, value]) => value), ...Object.values(headers)]',
      '    .map((value) => (value ? /\\{\\{\\s*([\\w.]+)\\s*\\}\\}/.exec(value) : null))',
      '    .find(Boolean);',
      '  if (missing) return console.warn(`Cleanup "${call.name}" not called: {{${missing[1]}}} has no value in this run.`);',
      '  let target: string;',
      '  try {',
      '    const u = new URL(url);',
      '    for (const [key, value] of query) u.searchParams.set(key, value);',
      '    target = u.toString();',
      '  } catch {',
      '    return console.warn(`Cleanup "${call.name}" failed: invalid URL: ${url}`);',
      '  }',
      '  try {',
      '    const res = await request.fetch(target, { method: call.method, headers, data: body, timeout: 30000, failOnStatusCode: false });',
      '    if (!res.ok() && ![404, 410, ...(call.satisfiedStatuses ?? [])].includes(res.status()))',
      '      console.warn(`Cleanup "${call.name}" failed: HTTP ${res.status()} from ${call.method} ${target}. Data may have been left behind.`);',
      '  } catch (error) {',
      '    console.warn(`Cleanup "${call.name}" failed: request error: ${(error as Error).message}`);',
      '  }',
      '}',
    ],
  },
  notExported: {
    needs: [],
    code: [
      '/** A step this draft does not do. It fails the test where the step was, rather than letting it pass without it. */',
      'function notExported(what: string): never {',
      '  throw new Error(`Not exported from WebFlowMaster: ${what}. Finish this step by hand before relying on this file.`);',
      '}',
    ],
  },
};

type Block = { kind: 'if' | 'else' } | { kind: 'loop'; index: string };

/** Credential-looking entries written out in a body, by key: these never go into the file. */
function literalCredentials(body: unknown): string[] {
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return [...body.matchAll(/(?:^|[&\s])([\w.-]+)=([^&\s]+)/g)]
        .filter(([, key, value]) => CREDENTIAL_KEY.test(key) && !fromVariable(value))
        .map(([, key]) => key);
    }
  }
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object')
      for (const [key, value] of Object.entries(node)) {
        if (
          CREDENTIAL_KEY.test(key) &&
          typeof value === 'string' &&
          value !== '' &&
          !fromVariable(value)
        )
          found.push(key);
        else walk(value);
      }
  };
  walk(parsed);
  return found;
}

export function toPlaywright(
  test: ExportableTest,
  options: { mode?: ExportMode } = {},
): PlaywrightExport {
  const mode = options.mode ?? 'draft';
  const used = new Set<string>();
  const helpers = new Set<string>();
  const findings: ExportFinding[] = [];
  const body: string[] = [];
  const blocks: Block[] = [];
  let usesV = false;
  const emit = (line: string) => body.push(`${'  '.repeat(blocks.length)}${line}`);
  const need = (name: string) => {
    if (helpers.has(name)) return;
    for (const dep of HELPERS[name].needs) need(dep);
    helpers.add(name);
  };
  const find = (finding: ExportFinding) => findings.push(finding);
  /** A string literal, or v('…') when it holds {{variables}} to fill at run time. */
  const text = (value: string) => {
    const names = namesIn(value);
    if (names.length === 0) return js(value);
    for (const name of names) used.add(name);
    usesV = true;
    need('fill');
    return `v(${js(value)})`;
  };
  const loose = (value: string) => {
    for (const name of namesIn(value)) used.add(name);
    return value;
  };

  const rows = datasetRows({ dataset: test.dataset });
  const preconditions = test.preconditions ?? [];
  const cleanups = test.cleanups ?? [];

  // ── Setup and cleanup: the request fixture, with the run's rules ──
  const apiCall = (
    call: Precondition | Cleanup,
    area: 'setup' | 'cleanup',
    defaultMethod: string,
  ) => {
    const label = `${area === 'setup' ? 'precondition' : 'cleanup'} ${call.name}`;
    const method = (call.method || defaultMethod).toUpperCase();
    const problems: string[] = [];
    const headers: Record<string, string> = { ...(call.requestHeaders ?? {}) };
    for (const [key, value] of Object.entries(headers))
      if (CREDENTIAL_HEADER.test(key) && !fromVariable(value))
        problems.push(
          `the ${key} header is a credential written out; keep it in a {{secret_…}} variable`,
        );
    let bodyText: string | undefined;
    if (call.requestBody != null && method !== 'GET' && method !== 'HEAD') {
      bodyText =
        typeof call.requestBody === 'string' ? call.requestBody : JSON.stringify(call.requestBody);
      if (!headers['Content-Type'] && !headers['content-type'])
        headers['Content-Type'] = 'application/json';
      const keys = literalCredentials(call.requestBody);
      if (keys.length > 0)
        problems.push(
          `the body writes out ${keys.join(', ')}; keep credentials in {{secret_…}} variables`,
        );
    }
    const query = (call.queryParams ?? [])
      .filter((q) => q.enabled !== false && q.key)
      .map((q) => [q.key, q.value] as [string, string]);
    for (const [key, value] of query)
      if (CREDENTIAL_KEY.test(key) && !fromVariable(value))
        problems.push(`the ${key} parameter is a credential written out`);
    const strings = [
      call.url,
      bodyText ?? '',
      ...query.map(([, value]) => value),
      ...Object.values(headers),
    ];
    if (strings.some((s) => GENERATOR.test(s)))
      problems.push('generators ({{$…}}) are made by WebFlowMaster at run time');
    if (problems.length > 0) {
      for (const reason of problems)
        find({
          step: null,
          area: problems[0].includes('generator') ? 'variables' : 'secrets',
          support: 'unsupported',
          label,
          reason,
        });
      return null;
    }
    for (const s of strings) loose(s);
    const json: Record<string, unknown> = {
      name: call.name,
      method,
      url: call.url,
      query,
      headers,
    };
    if (bodyText !== undefined) json.body = bodyText;
    if (call.satisfiedStatuses?.length) json.satisfiedStatuses = call.satisfiedStatuses;
    if (area === 'setup' && 'check' in call && call.check) {
      const check = call.check;
      const checkHeaders = { ...(check.requestHeaders ?? {}) };
      for (const [key, value] of Object.entries(checkHeaders))
        if (CREDENTIAL_HEADER.test(key) && !fromVariable(value)) {
          find({
            step: null,
            area: 'secrets',
            support: 'unsupported',
            label,
            reason: `the check's ${key} header is a credential written out`,
          });
          return null;
        }
      const checkQuery = (check.queryParams ?? [])
        .filter((q) => q.enabled !== false && q.key)
        .map((q) => [q.key, q.value] as [string, string]);
      for (const s of [
        check.url,
        check.bodyContains ?? '',
        typeof check.equals === 'string' ? check.equals : '',
        ...checkQuery.map(([, v]) => v),
      ])
        loose(s);
      json.check = {
        method: (check.method || 'GET').toUpperCase(),
        url: check.url,
        query: checkQuery,
        headers: checkHeaders,
        ...(check.expectStatus ? { expectStatus: check.expectStatus } : {}),
        ...(check.bodyContains != null ? { bodyContains: check.bodyContains } : {}),
        ...(check.jsonPath ? { jsonPath: check.jsonPath } : {}),
        ...(check.equals != null ? { equals: check.equals } : {}),
      };
    }
    return JSON.stringify(json);
  };

  const setupCalls = preconditions.map((pc) => {
    const json = apiCall(pc, 'setup', 'GET');
    if (json) need('precondition');
    return { name: pc.name, json };
  });
  const cleanupCalls = cleanups.map((c) => {
    const json = apiCall(c, 'cleanup', 'DELETE');
    if (json) need('cleanup');
    return { name: c.name, json };
  });
  if (rows && preconditions.length > 0)
    find({
      step: null,
      area: 'data',
      support: 'partial',
      label: 'dataset with preconditions',
      reason: FEATURE_CONFORMANCE.datasetWithPreconditions.how,
    });
  let writtenRows = rows;
  if (rows) {
    for (const key of Object.keys(rows[0] ?? {})) used.add(key);
    const secretColumns = [
      ...new Set(
        rows.flatMap((row) =>
          Object.entries(row)
            .filter(
              ([key, value]) => CREDENTIAL_KEY.test(key) && value !== '' && !fromVariable(value),
            )
            .map(([key]) => key),
        ),
      ),
    ];
    if (secretColumns.length > 0) {
      find({
        step: null,
        area: 'secrets',
        support: 'unsupported',
        label: 'dataset',
        reason: `the column(s) ${secretColumns.join(', ')} hold credentials written out; keep them in {{secret_…}} variables`,
      });
      // Left out of a draft: the environment variable supplies them, or the step needing one fails.
      writtenRows = rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !secretColumns.includes(key))),
      );
    }
  }
  if (GENERATOR.test(test.url ?? ''))
    find({
      step: null,
      area: 'variables',
      support: 'unsupported',
      label: 'start address',
      reason: FEATURE_CONFORMANCE.generators.how,
    });
  else if (test.url) loose(test.url);

  // ── The steps ──
  test.sequence.forEach((step, index) => {
    const number = index + 1;
    const id = step.action?.id ?? '';
    const raw = step.value;
    const value = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
    const shown = value.replace(/\s+/g, ' ').slice(0, 80);
    const label = `${step.action?.name || id || 'step'}${shown ? ` (${shown})` : ''}`;
    const selector = step.targetElement?.selector || null;
    const frames = (step.targetElement?.frameSelector ?? '').split(' >> ').filter(Boolean);
    const scope = `p${frames.map((f) => `.frameLocator(${js(f)})`).join('')}`;
    const l = selector ? `${scope}.locator(${js(selector)})` : null;
    const first = l ? `${l}.first()` : null;
    const refuse = (reason: string, area: ConformanceArea = 'action') => {
      find({ step: number, area, support: 'unsupported', label, reason });
      if (mode === 'draft') {
        need('notExported');
        emit(`// Not exported — ${label}: ${reason.replace(/\n/g, ' ')}`);
        emit(`notExported(${js(`step ${number}, ${label}: ${reason}`)});`);
      }
    };
    const element = (): string | null => {
      if (!first) refuse('it has no element');
      return first;
    };
    /** A value the step parses: it must be written in full to be exported. */
    const literal = (what: string): boolean => {
      if (namesIn(value).length === 0 && !GENERATOR.test(value)) return true;
      refuse(
        `the ${what} is a {{variable}} decided at run time; write it in full to export this step`,
      );
      return false;
    };
    const assertion = (check: string, message: string) => {
      need('within');
      emit(`expect(await within(${check}, ${ASSERTION_TIMEOUT_MS}), ${js(message)}).toBe(true);`);
    };

    if (GENERATOR.test(value) || Object.values(step.args ?? {}).some((a) => GENERATOR.test(a))) {
      refuse(FEATURE_CONFORMANCE.generators.how, 'variables');
      return;
    }
    if (id === STEP_GROUP_ACTION_ID) {
      refuse('a step group left unexpanded: export the test with its dependencies', 'group');
      return;
    }
    const row = ACTION_CONFORMANCE[id as AdhocActionId];
    if (!row) {
      refuse(id ? `"${id}" is not an action WebFlowMaster runs` : 'no action');
      return;
    }
    if (row.support === 'unsupported') {
      refuse(`${row.how}, which only a WebFlowMaster run has`);
      return;
    }

    switch (id as AdhocActionId) {
      case 'click': {
        const e = element();
        if (e) emit(`await ${e}.click();`);
        break;
      }
      case 'doubleClick': {
        const e = element();
        if (e) emit(`await ${e}.dblclick();`);
        break;
      }
      case 'rightClick': {
        const e = element();
        if (e) emit(`await ${e}.click({ button: 'right' });`);
        break;
      }
      case 'hover': {
        const e = element();
        if (e) emit(`await ${e}.hover();`);
        break;
      }
      case 'input': {
        const e = element();
        if (!e) break;
        if (typeof raw !== 'string') refuse('it has no value to type');
        else emit(`await ${e}.fill(${text(raw)});`);
        break;
      }
      case 'select': {
        const e = element();
        if (!e) break;
        if (!value) refuse('it has no option to choose');
        else emit(`await ${e}.selectOption(${text(value)});`);
        break;
      }
      case 'selectByText': {
        const e = element();
        if (!e) break;
        if (!value) {
          refuse('it has no option text');
          break;
        }
        emit('{');
        emit(`  const wanted = ${text(value)};`);
        emit(`  await ${e}.click();`);
        emit(
          `  const option = ${scope}.getByRole('option', { name: wanted, exact: false }).or(${scope}.locator(${js('[role="option"], .mat-mdc-option, .mat-option, .ng-option')}).filter({ hasText: wanted })).first();`,
        );
        emit(`  await option.waitFor({ state: 'visible', timeout: ${DEFAULT_WAIT_TIMEOUT_MS} });`);
        emit('  await option.click();');
        emit('}');
        break;
      }
      case 'wait': {
        const ms = Number.parseInt(value, 10);
        if (Number.isNaN(ms)) refuse('the wait is not a number of milliseconds');
        else emit(`await p.waitForTimeout(${ms});`);
        break;
      }
      case 'scroll':
        emit(
          l
            ? `await ${l}.scrollIntoViewIfNeeded();`
            : 'await p.evaluate(() => window.scrollBy(0, 200));',
        );
        break;
      case 'navigate': {
        const url = value.trim();
        if (!url) refuse('it has no address');
        else emit(`await p.goto(${text(url)}, { waitUntil: 'domcontentloaded' });`);
        break;
      }
      case 'assert': {
        const e = element();
        if (e)
          assertion(
            `() => ${e}.isVisible()`,
            `Element ${js(selector!)} was not visible within ${ASSERTION_TIMEOUT_MS}ms.`,
          );
        break;
      }
      case 'assertTextContains': {
        const e = element();
        if (!e) break;
        if (!value) {
          refuse('it has no text to look for');
          break;
        }
        need('within');
        emit('{');
        emit(`  const expected = ${text(value)};`);
        emit(
          `  expect(await within(async () => ((await ${e}.textContent()) ?? null)?.includes(expected) === true, ${ASSERTION_TIMEOUT_MS}), \`Element ${js(selector!).slice(1, -1).replace(/[`$]/g, '\\$&')} did not contain "\${expected}" within ${ASSERTION_TIMEOUT_MS}ms.\`).toBe(true);`,
        );
        emit('}');
        break;
      }
      case 'assertElementCount': {
        if (!element()) break;
        const parsed = parseAssertionValue(value);
        if (!parsed || !COUNT_OPERATORS.includes(parsed.operator)) {
          refuse(`"${value}" is not a count such as ==5, >=2 or 3`);
          break;
        }
        const op =
          parsed.operator === '==' ? '===' : parsed.operator === '!=' ? '!==' : parsed.operator;
        assertion(
          `async () => (await ${l}.count()) ${op} ${parsed.count}`,
          `Element count for ${js(selector!)} was not ${parsed.operator} ${parsed.count} within ${ASSERTION_TIMEOUT_MS}ms.`,
        );
        break;
      }
      case 'assertState': {
        const e = element();
        if (!e || !literal('state')) break;
        const state = value.trim().toLowerCase();
        const read = ASSERTABLE[state];
        if (!read) refuse(`"${value}" is not a state: ${Object.keys(ASSERTABLE).join(', ')}`);
        else
          assertion(
            read(e),
            `Element ${js(selector!)} was not ${state} within ${ASSERTION_TIMEOUT_MS}ms.`,
          );
        break;
      }
      case 'ensureState': {
        const e = element();
        if (!e || !literal('state')) break;
        const state = value.trim().toLowerCase();
        if (state !== 'checked' && state !== 'unchecked') {
          refuse(`a test can set checked or unchecked, not "${value}"`);
          break;
        }
        const want = state === 'checked';
        need('within');
        emit(`if ((await ${e}.isChecked()) !== ${want}) {`);
        emit(`  await ${e}.click();`);
        emit(
          `  expect(await within(async () => (await ${e}.isChecked()) === ${want}, ${ASSERTION_TIMEOUT_MS}), ${js(`${selector} was still not ${state} ${ASSERTION_TIMEOUT_MS}ms after being clicked.`)}).toBe(true);`,
        );
        emit('}');
        break;
      }
      case 'waitForElement': {
        const e = element();
        if (e)
          emit(
            `await ${e}.waitFor({ state: ${js(value.trim().toLowerCase() === 'hidden' ? 'hidden' : 'visible')}, timeout: ${DEFAULT_WAIT_TIMEOUT_MS} });`,
          );
        break;
      }
      case 'waitForText': {
        if (!element()) break;
        if (!value) refuse('it has no text to wait for');
        else
          emit(
            `await ${l}.filter({ hasText: ${text(value)} }).first().waitFor({ state: 'attached', timeout: ${DEFAULT_WAIT_TIMEOUT_MS} });`,
          );
        break;
      }
      case 'waitForNetworkIdle':
        emit(`await p.waitForLoadState('networkidle', { timeout: ${DEFAULT_WAIT_TIMEOUT_MS} });`);
        break;
      case 'pressKey': {
        if (!value.trim()) {
          refuse('it has no key');
          break;
        }
        emit(
          first
            ? `await ${first}.press(${text(value.trim())});`
            : `await p.keyboard.press(${text(value.trim())});`,
        );
        break;
      }
      case 'dragAndDrop': {
        const e = element();
        if (!e) break;
        if (!value.trim()) refuse('it has no destination');
        else emit(`await ${e}.dragTo(${scope}.locator(${text(value.trim())}).first());`);
        break;
      }
      case 'uploadFile': {
        const e = element();
        if (!e) break;
        const bar = value.indexOf('|');
        const name = bar === -1 ? value : value.slice(0, bar);
        if (namesIn(name).length > 0) {
          refuse(
            'the file name is a {{variable}} decided at run time; write it in full to export this step',
          );
          break;
        }
        const file = parseUploadValue(bar === -1 ? value : `${name}|`);
        if ('error' in file) {
          refuse(file.error);
          break;
        }
        const content = bar === -1 ? file.buffer.toString('utf8') : value.slice(bar + 1);
        need('upload');
        emit(
          `await upload(p, ${e}, { name: ${js(file.name)}, mimeType: ${js(file.mimeType)}, buffer: Buffer.from(${text(content)}) });`,
        );
        break;
      }
      case 'handleDialog': {
        const answer = parseDialogAnswer(value);
        if (!answer || (answer.promptText === undefined && namesIn(value).length > 0)) {
          refuse(`"${value}" is not accept, dismiss or accept:text written in full`);
          break;
        }
        need('dialogs');
        emit(
          `answerNextDialog(p, { accept: ${answer.accept}${answer.promptText !== undefined ? `, promptText: ${text(answer.promptText)}` : ''} });`,
        );
        break;
      }
      case 'switchTab':
        need('tabs');
        emit(`p = await switchTab(p, ${text(value.trim())});`);
        break;
      case 'closeTab':
        need('tabs');
        emit('p = await closeTab(p);');
        break;
      case 'storeText': {
        const e = element();
        if (!e) break;
        const name = value.trim().replace(/^\{\{\s*|\s*\}\}$/g, '');
        if (!VARIABLE_NAME.test(name)) {
          refuse(`"${value}" is not a variable name`);
          break;
        }
        used.add(name);
        need('readText');
        emit(`vars[${js(name)}] = await readText(${e});`);
        break;
      }
      case 'setCookie': {
        const cookie = parseAssignment(value);
        if (!cookie || namesIn(cookie.name).length > 0) {
          refuse(`"${value}" is not name=value with the name written in full`);
          break;
        }
        emit('{');
        emit('  const url = p.url();');
        emit(
          "  if (!/^https?:/i.test(url)) throw new Error('Open a page first: a cookie is set for the address the tab is on.');",
        );
        emit(
          `  await p.context().addCookies([{ name: ${js(cookie.name)}, value: ${text(cookie.value)}, url }]);`,
        );
        emit('}');
        break;
      }
      case 'clearCookies':
        emit('await p.context().clearCookies();');
        break;
      case 'setLocalStorage': {
        const entry = parseAssignment(value);
        if (!entry || namesIn(entry.name).length > 0) {
          refuse(`"${value}" is not key=value with the key written in full`);
          break;
        }
        emit(
          `await p.evaluate(([key, value]) => window.localStorage.setItem(key, value), [${js(entry.name)}, ${text(entry.value)}] as const);`,
        );
        break;
      }
      case 'executeScript': {
        if (!value) {
          refuse('it has no script');
          break;
        }
        let expression: string;
        if (step.args) {
          const args = Object.entries(step.args)
            .map(([name, arg]) => `${js(name)}: ${text(arg)}`)
            .join(', ');
          const sel = JSON.stringify(selector ?? '');
          expression =
            `${js('(async () => {\nconst args = ')} + JSON.stringify({ ${args} }) + ` +
            `${js(`;\nconst element = (() => { try { return ${sel} ? document.querySelector(${sel}) : null; } catch { return null; } })();\n`)} + ` +
            `${text(value)} + ${js('\n})()')}`;
        } else {
          expression = text(/\breturn\b/.test(value) ? `(async () => {\n${value}\n})()` : value);
        }
        emit(
          `expect(await p.evaluate(${expression}), 'The script returned false.').not.toBe(false);`,
        );
        break;
      }
      case 'setVariable': {
        const assignment = parseAssignment(value);
        if (!assignment || !VARIABLE_NAME.test(assignment.name)) {
          refuse(`"${value}" is not name=value with a name of letters, digits, _ and .`);
          break;
        }
        used.add(assignment.name);
        emit(`vars[${js(assignment.name)}] = ${text(assignment.value)};`);
        break;
      }
      case 'assertCondition': {
        if (!value.trim()) {
          refuse('it has no comparison');
          break;
        }
        need('holds');
        emit(`expect(holds(${text(value)}), ${js(`${value.trim()} does not hold.`)}).toBe(true);`);
        break;
      }
      case 'mockRequest': {
        const spec = parseMockSpec(value);
        if ('error' in spec) {
          refuse(spec.error);
          break;
        }
        emit(`await p.context().route(${text(spec.pattern)}, async (route) => {`);
        if (spec.method)
          emit(`  if (route.request().method() !== ${js(spec.method)}) return route.fallback();`);
        if (spec.delayMs > 0)
          emit(`  await new Promise((resolve) => setTimeout(resolve, ${spec.delayMs}));`);
        emit(
          `  await route.fulfill({ status: ${spec.status}, contentType: ${js(spec.contentType)}, body: ${text(spec.body)}, headers: { 'access-control-allow-origin': '*' } }).catch(() => undefined);`,
        );
        emit('});');
        break;
      }
      case 'blockRequests':
        if (!value.trim()) refuse('it has no address to block');
        else
          emit(
            `await p.context().route(${text(value.trim())}, (route) => route.abort('blockedbyclient').catch(() => undefined));`,
          );
        break;
      case 'clearMocks':
        emit("await p.context().unrouteAll({ behavior: 'ignoreErrors' });");
        break;
      case 'setGeolocation': {
        if (!literal('position')) break;
        const point = parseGeolocation(value);
        if ('error' in point) {
          refuse(point.error);
          break;
        }
        emit(`await p.context().grantPermissions(['geolocation']);`);
        emit(
          `await p.context().setGeolocation(${JSON.stringify(point).replace(/"(\w+)":/g, '$1: ')});`,
        );
        break;
      }
      case 'if':
      case 'repeatWhile': {
        let condition: string | null = null;
        if (!value.trim()) refuse('it has no condition', 'flow');
        else if (!l) {
          need('holds');
          condition = `holds(${text(value)})`;
        } else {
          const plain = value.trim();
          if (
            namesIn(plain).length === 0 &&
            !/^(not\s+)?contains:/is.test(plain) &&
            !ELEMENT_CONDITIONS.includes(plain.toLowerCase())
          )
            refuse(
              `"${value}" is not a condition: ${ELEMENT_CONDITIONS.join(', ')} or contains:text`,
              'flow',
            );
          else {
            need('elementIs');
            condition = `await elementIs(${l}, ${text(value)})`;
          }
        }
        if (id === 'if') {
          emit(`if (${condition ?? 'notExported("an if without a condition it can export")'}) {`);
          blocks.push({ kind: 'if' });
        } else {
          const i = `i${blocks.filter((b) => b.kind === 'loop').length + 1}`;
          used.add('loopIndex');
          emit(`for (let ${i} = 1; ; ${i}++) {`);
          blocks.push({ kind: 'loop', index: i });
          emit(
            `if (!(${condition ?? 'notExported("a loop without a condition it can export")'})) break;`,
          );
          emit(
            `if (${i} > ${MAX_LOOP_ITERATIONS}) throw new Error(${js(`The loop at step ${number} was still going after ${MAX_LOOP_ITERATIONS} iterations; its condition never turned false.`)});`,
          );
          emit(`vars.loopIndex = String(${i});`);
        }
        break;
      }
      case 'repeat': {
        let count: string | null = null;
        if (namesIn(value).length > 0) {
          need('times');
          count = `times(${text(value)})`;
        } else {
          const n = Number(value.trim());
          if (!value.trim() || !Number.isInteger(n) || n < 0 || n > MAX_LOOP_ITERATIONS)
            refuse(
              `"${value}" is not a number of times between 0 and ${MAX_LOOP_ITERATIONS}`,
              'flow',
            );
          else count = String(n);
        }
        const i = `i${blocks.filter((b) => b.kind === 'loop').length + 1}`;
        used.add('loopIndex');
        emit(
          `for (let ${i} = 1, n${i.slice(1)} = ${count ?? '0'}; ${i} <= n${i.slice(1)}; ${i}++) {`,
        );
        blocks.push({ kind: 'loop', index: i });
        emit(`vars.loopIndex = String(${i});`);
        break;
      }
      case 'else': {
        const top = blocks.at(-1);
        if (top?.kind !== 'if') {
          refuse('an else without its if', 'flow');
          break;
        }
        blocks.pop();
        emit('} else {');
        blocks.push({ kind: 'else' });
        break;
      }
      case 'endIf': {
        const top = blocks.at(-1);
        if (top?.kind !== 'if' && top?.kind !== 'else') {
          refuse('an end if without its if', 'flow');
          break;
        }
        blocks.pop();
        emit('}');
        break;
      }
      case 'endLoop': {
        const top = blocks.at(-1);
        if (top?.kind !== 'loop') {
          refuse('an end loop without its loop', 'flow');
          break;
        }
        closeLoop();
        break;
      }
      default:
        refuse(`"${id}" has no Playwright equivalent here`);
    }
  });

  function closeLoop() {
    blocks.pop();
    emit('}');
    const outer = [...blocks]
      .reverse()
      .find((b): b is Extract<Block, { kind: 'loop' }> => b.kind === 'loop');
    emit(outer ? `vars.loopIndex = String(${outer.index});` : 'delete vars.loopIndex;');
  }

  if (blocks.length > 0) {
    find({
      step: null,
      area: 'flow',
      support: 'unsupported',
      label: 'blocks',
      reason: `${blocks.length} if/loop block(s) never closed`,
    });
    while (blocks.length > 0) {
      if (blocks.at(-1)!.kind === 'loop') closeLoop();
      else {
        blocks.pop();
        emit('}');
      }
    }
  }

  // Setup and cleanup calls refused for what they hold.
  const refusedCall = (kind: string, name: string) => {
    need('notExported');
    return [
      `// Not exported — ${kind} ${name.replace(/\n/g, ' ')}: see the findings in the header`,
      `notExported(${js(`${kind} ${name}`)});`,
    ];
  };

  if (mode === 'strict' && findings.length > 0) throw new ExportNotConformantError(findings);

  used.delete('loopIndex');
  const variables = [...used].sort();
  const source = test.source ?? null;
  const unsupported = findings.filter((f) => f.support === 'unsupported');
  const notExported = unsupported.map((f) => `${f.label}: ${f.reason}`);

  const sourceLine = !source
    ? ''
    : source.kind === 'published'
      ? ` — published version ${source.version}`
      : source.kind === 'version'
        ? ` — version ${source.version} (not the published one)`
        : ' — working copy, not a saved version';
  const header = [
    `// Exported from WebFlowMaster: ${test.name.replace(/\n/g, ' ')}${sourceLine}.`,
    findings.length === 0
      ? `// Conformance: complete — every step is done the way a WebFlowMaster run does it${mode === 'strict' ? ' (strict export)' : ''}.`
      : `// DRAFT — ${unsupported.length} step(s) could not be exported${findings.length > unsupported.length ? `, ${findings.length - unsupported.length} with a known difference` : ''}. Each step not exported throws where it stands, so this file fails until it is finished by hand.`,
    ...findings.map(
      (f) =>
        `//   ${f.support === 'partial' ? 'differs' : 'missing'}: ${f.step ? `step ${f.step}, ` : ''}${f.label.replace(/\n/g, ' ')} — ${f.reason}`,
    ),
    variables.length > 0
      ? `// Variables come from the environment: ${variables.map((n) => `${envName(n)} for {{${n}}}`).join(', ')}.`
      : '',
    '// Not part of a test file: AI healing, visual comparison, step retries, evidence and the egress policy stay with WebFlowMaster runs.',
  ].filter(Boolean);

  const testBody: string[] = [];
  const push = (line: string, depth: number) =>
    testBody.push(line ? `${'  '.repeat(depth)}${line}` : '');
  const hasCleanup = cleanupCalls.length > 0;
  const stepDepth = hasCleanup ? 2 : 1;
  if (usesV) push('const v = (text: string) => fill(vars, text);', 1);
  push('let p: Page = page;', 1);
  push('p.setDefaultTimeout(ELEMENT_TIMEOUT_MS);', 1);
  if (hasCleanup) push('try {', 1);
  if (setupCalls.length > 0) push('// Preconditions', stepDepth);
  for (const call of setupCalls) {
    if (call.json) push(`await precondition(request, vars, ${call.json});`, stepDepth);
    else for (const line of refusedCall('precondition', call.name)) push(line, stepDepth);
  }
  if (test.url && !GENERATOR.test(test.url)) {
    need('fillLoose');
    push(
      `await p.goto(fillLoose(vars, ${js(test.url)}), { waitUntil: 'domcontentloaded' });`,
      stepDepth,
    );
  } else if (test.url)
    for (const line of refusedCall('start address', test.url)) push(line, stepDepth);
  for (const line of body) push(line, stepDepth);
  if (hasCleanup) {
    push('} finally {', 1);
    push('// Cleanup, whatever happened: it never changes the result', 2);
    for (const call of cleanupCalls) {
      if (call.json) push(`await cleanup(request, vars, ${call.json});`, 2);
      else
        push(
          `// Not exported — cleanup ${call.name.replace(/\n/g, ' ')}: see the findings in the header`,
          2,
        );
    }
    push('}', 1);
  }

  const imports = ['test', 'expect', 'type Page'];
  if ([...helpers].some((h) => ['elementIs', 'upload', 'readText'].includes(h)))
    imports.push('type Locator');
  if (helpers.has('api')) imports.push('type APIRequestContext');
  const order = Object.keys(HELPERS).filter((name) => helpers.has(name));

  const code = [
    ...header,
    `import { ${imports.join(', ')} } from '@playwright/test';`,
    '',
    '/** Each {{variable}} and the environment variable it is read from. Secrets are read here at run time, never written in this file. */',
    'const ENVIRONMENT: Array<[string, string]> = [',
    ...variables.map((n) => `  [${js(n)}, ${js(envName(n))}],`),
    '];',
    'const env: Record<string, string> = Object.fromEntries(',
    '  ENVIRONMENT.flatMap(([name, key]) => (process.env[key] === undefined ? [] : [[name, process.env[key] as string]])),',
    ');',
    '/** How long an action waits for its element, as the run setting does (30 s by default). */',
    'const ELEMENT_TIMEOUT_MS = Number(process.env.WFM_ELEMENT_TIMEOUT_MS) || 30000;',
    '',
    ...order.flatMap((name) => [...HELPERS[name].code, '']),
    ...(rows
      ? [
          `const rows: Array<Record<string, string>> = ${JSON.stringify(writtenRows, null, 2)};`,
          '',
          'for (const [index, row] of rows.entries()) {',
          `  test(\`${test.name.replace(/[`\\$]/g, '\\$&')} — row \${index + 1}\`, async ({ page, request }) => {`,
          '    const vars: Record<string, string> = { ...env, ...row };',
          ...testBody.map((line) => (line ? `  ${line}` : line)),
          '  });',
          '}',
        ]
      : [
          `test(${js(test.name)}, async ({ page, request }) => {`,
          '  const vars: Record<string, string> = { ...env };',
          ...testBody,
          '});',
        ]),
    '',
  ].join('\n');

  return {
    fileName: playwrightFileName(test.name),
    code,
    mode,
    complete: findings.length === 0,
    findings,
    notExported,
    variables,
    source,
  };
}
