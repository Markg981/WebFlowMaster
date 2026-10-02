import type { Cleanup, Precondition } from '@shared/schema';
import { parseMockSpec } from './network-mocks';
import { parseAssertionValue, parseAssignment, parseDialogAnswer, parseUploadValue } from './step-executor';

/**
 * A web test as a Playwright Test file (`*.spec.ts`), to run without WebFlowMaster, to keep in a
 * repository beside the application, or to take further by hand.
 *
 * The steps are the ones a run executes: the caller expands step groups and custom actions and
 * resolves repository elements first (server/routes/tests.routes.ts). Each action becomes the
 * Playwright calls that do what the runner does (server/step-executor.ts). What has no portable
 * equivalent — the test inbox, a database query, the accessibility scan, AI healing — is written
 * as a comment saying so, and counted in the file's header, so the file never claims to do more
 * than it does.
 *
 * {{variables}} are filled at run time from environment variables, WFM_<NAME> (WFM_BASEURL for
 * {{baseUrl}}); values the steps store go into the same table, as in a run. Preconditions run
 * before the steps through Playwright's request fixture, and the cleanup after them, whatever
 * happened.
 */

export interface ExportableStep {
  action?: { id?: string; name?: string } | null;
  value?: unknown;
  targetElement?: { selector?: string; frameSelector?: string | null; text?: string } | null;
}

export interface ExportableTest {
  name: string;
  url: string;
  sequence: ExportableStep[];
  preconditions?: Precondition[] | null;
  cleanups?: Cleanup[] | null;
  /** Rows to run over: one test per row. */
  dataset?: Array<Record<string, unknown>> | null;
  version?: number | null;
}

export interface PlaywrightExport {
  fileName: string;
  code: string;
  /** Steps written as a comment because they have no equivalent outside WebFlowMaster. */
  notExported: string[];
  variables: string[];
}

const js = (value: string) => JSON.stringify(value);
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** A string literal, or v('…') when it holds {{variables}} to fill at run time. */
function text(value: string, used: Set<string>): string {
  const names = [...value.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => !n.startsWith('$'));
  if (names.length === 0 && !/\{\{\s*\$/.test(value)) return js(value);
  for (const name of names) used.add(name);
  return `v(${js(value)})`;
}

export function envName(variable: string): string {
  return `WFM_${variable.replace(/[^\w]/g, '_').toUpperCase()}`;
}

export function playwrightFileName(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'test';
  return `${base}.spec.ts`;
}

/** The locator for a step's element, inside its iframes when it has any (' >> ' separated, outermost first). */
function locatorOf(step: ExportableStep): string | null {
  const selector = step.targetElement?.selector;
  if (!selector) return null;
  const frames = (step.targetElement?.frameSelector ?? '').split(' >> ').filter(Boolean);
  return `p${frames.map((f) => `.frameLocator(${js(f)})`).join('')}.locator(${js(selector)})`;
}

function apiCall(call: Precondition | Cleanup, used: Set<string>): string {
  const method = (call.method || 'GET').toUpperCase();
  const params = (call.queryParams ?? []).filter((q) => q.enabled !== false && q.key);
  const options: string[] = [`method: ${js(method)}`];
  if (call.requestHeaders && Object.keys(call.requestHeaders).length > 0) {
    options.push(`headers: { ${Object.entries(call.requestHeaders).map(([k, value]) => `${js(k)}: ${text(value, used)}`).join(', ')} }`);
  }
  if (params.length > 0) options.push(`params: { ${params.map((q) => `${js(q.key)}: ${text(q.value, used)}`).join(', ')} }`);
  if (call.requestBody != null && method !== 'GET' && method !== 'HEAD') {
    const body = typeof call.requestBody === 'string' ? call.requestBody : JSON.stringify(call.requestBody);
    options.push(`data: ${text(body, used)}`);
  }
  return `request.fetch(${text(call.url, used)}, { ${options.join(', ')} })`;
}

const STATE_EXPECT: Record<string, string> = {
  checked: 'toBeChecked()',
  unchecked: 'not.toBeChecked()',
  enabled: 'toBeEnabled()',
  disabled: 'toBeDisabled()',
  editable: 'toBeEditable()',
  readonly: 'not.toBeEditable()',
};

const CONDITION_CODE: Record<string, (l: string) => string> = {
  visible: (l) => `await ${l}.first().isVisible().catch(() => false)`,
  hidden: (l) => `!(await ${l}.first().isVisible().catch(() => false))`,
  exists: (l) => `(await ${l}.count()) > 0`,
  missing: (l) => `(await ${l}.count()) === 0`,
  checked: (l) => `(await ${l}.count()) > 0 && (await ${l}.first().isChecked())`,
  unchecked: (l) => `(await ${l}.count()) > 0 && !(await ${l}.first().isChecked())`,
  enabled: (l) => `(await ${l}.count()) > 0 && (await ${l}.first().isEnabled())`,
  disabled: (l) => `(await ${l}.count()) > 0 && (await ${l}.first().isDisabled())`,
};

/** The condition of an `if` or `repeatWhile`, as an expression; null when it cannot be written. */
function conditionCode(step: ExportableStep, condition: string, used: Set<string>): string | null {
  const l = locatorOf(step);
  if (!l) return `holds(${text(condition, used)})`;
  const contains = /^(not\s+)?contains:(.*)$/is.exec(condition.trim());
  if (contains) {
    const found = `((await ${l}.first().textContent().catch(() => null)) ?? '').includes(${text(contains[2], used)})`;
    return contains[1] ? `!${found}` : found;
  }
  const state = CONDITION_CODE[condition.trim().toLowerCase()];
  return state ? state(l) : null;
}

export function toPlaywright(test: ExportableTest): PlaywrightExport {
  const used = new Set<string>();
  const notExported: string[] = [];
  const body: string[] = [];
  let depth = 1;
  const emit = (line: string) => body.push(`${'  '.repeat(depth)}${line}`);
  const skip = (step: ExportableStep, why: string) => {
    const label = `${step.action?.name ?? step.action?.id ?? 'step'}${typeof step.value === 'string' && step.value ? ` (${step.value})` : ''}`;
    notExported.push(`${label}: ${why}`);
    emit(`// Not exported — ${label.replace(/\n/g, ' ')}: ${why}`);
  };

  if (test.url) emit(`await p.goto(${text(test.url, used)});`);

  for (const step of test.sequence) {
    const id = step.action?.id ?? '';
    const value = typeof step.value === 'string' ? step.value : step.value == null ? '' : String(step.value);
    const l = locatorOf(step);
    const first = l ? `${l}.first()` : null;
    const needs = (what: string | null): what is string => {
      if (!what) skip(step, 'it has no element');
      return Boolean(what);
    };

    switch (id) {
      case 'click': if (needs(first)) emit(`await ${first}.click();`); break;
      case 'doubleClick': if (needs(first)) emit(`await ${first}.dblclick();`); break;
      case 'rightClick': if (needs(first)) emit(`await ${first}.click({ button: 'right' });`); break;
      case 'hover': if (needs(first)) emit(`await ${first}.hover();`); break;
      case 'input': if (needs(first)) emit(`await ${first}.fill(${text(value, used)});`); break;
      case 'select': if (needs(first)) emit(`await ${first}.selectOption(${text(value, used)});`); break;
      case 'selectByText':
        if (needs(first)) {
          emit(`await ${first}.click();`);
          emit(`await p.getByRole('option', { name: ${text(value, used)} }).first().click();`);
        }
        break;
      case 'wait': emit(`await p.waitForTimeout(${Number.parseInt(value, 10) || 0});`); break;
      case 'scroll': emit(first ? `await ${first}.scrollIntoViewIfNeeded();` : 'await p.mouse.wheel(0, 200);'); break;
      case 'navigate': emit(`await p.goto(${text(value.trim(), used)}, { waitUntil: 'domcontentloaded' });`); break;
      case 'assert': if (needs(first)) emit(`await expect(${first}).toBeVisible();`); break;
      case 'assertTextContains': if (needs(first)) emit(`await expect(${first}).toContainText(${text(value, used)});`); break;
      case 'assertElementCount': {
        if (!needs(l)) break;
        const parsed = parseAssertionValue(value);
        if (!parsed) { skip(step, 'the count is not readable'); break; }
        if (parsed.operator === '==') emit(`await expect(${l}).toHaveCount(${parsed.count});`);
        else {
          const matcher = { '>=': 'toBeGreaterThanOrEqual', '<=': 'toBeLessThanOrEqual', '>': 'toBeGreaterThan', '<': 'toBeLessThan', '!=': 'not.toBe' }[parsed.operator];
          if (matcher) emit(`await expect.poll(() => ${l}.count()).${matcher}(${parsed.count});`);
          else skip(step, `unknown operator ${parsed.operator}`);
        }
        break;
      }
      case 'waitForElement': if (needs(first)) emit(`await ${first}.waitFor({ state: ${js(value.trim().toLowerCase() === 'hidden' ? 'hidden' : 'visible')} });`); break;
      case 'waitForText': if (needs(l)) emit(`await ${l}.filter({ hasText: ${text(value, used)} }).first().waitFor({ state: 'attached' });`); break;
      case 'waitForNetworkIdle': emit(`await p.waitForLoadState('networkidle');`); break;
      case 'assertState': {
        const matcher = STATE_EXPECT[value.trim().toLowerCase()];
        if (needs(first)) {
          if (matcher) emit(`await expect(${first}).${matcher};`);
          else skip(step, `unknown state "${value}"`);
        }
        break;
      }
      case 'ensureState': {
        const state = value.trim().toLowerCase();
        if (needs(first)) {
          if (state === 'checked') emit(`await ${first}.check();`);
          else if (state === 'unchecked') emit(`await ${first}.uncheck();`);
          else skip(step, `a test cannot set "${value}"`);
        }
        break;
      }
      case 'pressKey': emit(first ? `await ${first}.press(${text(value.trim(), used)});` : `await p.keyboard.press(${text(value.trim(), used)});`); break;
      case 'dragAndDrop': if (needs(first)) emit(`await ${first}.dragTo(p.locator(${text(value, used)}).first());`); break;
      case 'uploadFile': {
        if (!needs(first)) break;
        const file = parseUploadValue(value);
        if ('error' in file) { skip(step, file.error); break; }
        emit(`await ${first}.setInputFiles({ name: ${js(file.name)}, mimeType: ${js(file.mimeType)}, buffer: Buffer.from(${js(file.buffer.toString('utf8'))}) });`);
        break;
      }
      case 'handleDialog': {
        const answer = parseDialogAnswer(value.trim() || 'accept');
        if (!answer) { skip(step, 'the answer is not readable'); break; }
        emit(`p.once('dialog', (dialog) => ${answer.accept ? `dialog.accept(${answer.promptText !== undefined ? text(answer.promptText, used) : ''})` : 'dialog.dismiss()'});`);
        break;
      }
      case 'switchTab': {
        const wanted = value.trim();
        if (!wanted) emit('p = p.context().pages().at(-1)!;');
        else if (/^\d+$/.test(wanted)) emit(`p = p.context().pages()[${Number(wanted) - 1}];`);
        else emit(`p = (await Promise.all(p.context().pages().map(async (tab) => ({ tab, title: await tab.title() })))).find(({ tab, title }) => tab.url().includes(${text(wanted, used)}) || title.includes(${text(wanted, used)}))!.tab;`);
        emit(`await p.bringToFront();`);
        break;
      }
      case 'closeTab': emit('{ const context = p.context(); await p.close(); p = context.pages().at(-1)!; }'); break;
      case 'storeText': {
        if (!needs(first)) break;
        used.add(value.trim());
        emit(`vars[${js(value.trim())}] = await ${first}.inputValue().catch(async () => (await ${first}.innerText()).trim());`);
        break;
      }
      case 'setCookie': {
        const cookie = parseAssignment(value);
        if (!cookie) { skip(step, 'not name=value'); break; }
        emit(`await p.context().addCookies([{ name: ${js(cookie.name)}, value: ${text(cookie.value, used)}, url: p.url() }]);`);
        break;
      }
      case 'clearCookies': emit('await p.context().clearCookies();'); break;
      case 'setLocalStorage': {
        const entry = parseAssignment(value);
        if (!entry) { skip(step, 'not key=value'); break; }
        emit(`await p.evaluate(([key, value]) => window.localStorage.setItem(key, value), [${js(entry.name)}, ${text(entry.value, used)}] as const);`);
        break;
      }
      case 'executeScript': {
        const script = /\breturn\b/.test(value) ? `(async () => { ${value} })()` : value;
        emit(`expect(await p.evaluate(${text(script, used)})).not.toBe(false);`);
        break;
      }
      case 'setVariable': {
        const assignment = parseAssignment(value);
        if (!assignment) { skip(step, 'not name=value'); break; }
        used.add(assignment.name);
        if (/\{\{\s*\$/.test(assignment.value)) notExported.push(`${assignment.name}: generators such as {{$randomEmail}} are not filled outside WebFlowMaster`);
        emit(`vars[${js(assignment.name)}] = ${text(assignment.value, used)};`);
        break;
      }
      case 'assertCondition': emit(`expect(holds(${text(value, used)}), ${js(value)}).toBe(true);`); break;
      case 'mockRequest': {
        const spec = parseMockSpec(value);
        if ('error' in spec) { skip(step, spec.error); break; }
        emit(`await p.context().route(${text(spec.pattern, used)}, async (route) => {`);
        if (spec.method) emit(`  if (route.request().method() !== ${js(spec.method)}) return route.fallback();`);
        if (spec.delayMs) emit(`  await new Promise((resolve) => setTimeout(resolve, ${spec.delayMs}));`);
        emit(`  await route.fulfill({ status: ${spec.status}, contentType: ${js(spec.contentType)}, body: ${text(spec.body, used)} });`);
        emit('});');
        break;
      }
      case 'blockRequests': emit(`await p.context().route(${text(value.trim(), used)}, (route) => route.abort('blockedbyclient'));`); break;
      case 'clearMocks': emit('await p.context().unrouteAll({ behavior: \'ignoreErrors\' });'); break;
      case 'if': {
        const condition = conditionCode(step, value, used);
        if (!condition) { skip(step, `unknown condition "${value}"`); emit('if (false) {'); }
        else emit(`if (${condition}) {`);
        depth++;
        break;
      }
      case 'else': depth = Math.max(1, depth - 1); emit('} else {'); depth++; break;
      case 'endIf': case 'endLoop': depth = Math.max(1, depth - 1); emit('}'); break;
      case 'repeat': {
        used.add('loopIndex');
        emit(`for (let i = 1; i <= ${Number.parseInt(value, 10) || 0}; i++) {`);
        depth++;
        emit('vars.loopIndex = String(i);');
        break;
      }
      case 'repeatWhile': {
        const condition = conditionCode(step, value, used);
        used.add('loopIndex');
        if (!condition) { skip(step, `unknown condition "${value}"`); emit('for (let i = 1; false; i++) {'); }
        else emit(`for (let i = 1; i <= 200 && (${condition}); i++) {`);
        depth++;
        emit('vars.loopIndex = String(i);');
        break;
      }
      case 'waitForEmail': skip(step, 'it reads the environment\'s test inbox (Mailpit), which only a WebFlowMaster run has'); break;
      case 'queryDatabase': skip(step, 'it queries the environment\'s database through WebFlowMaster'); break;
      case 'assertAccessible': skip(step, 'add @axe-core/playwright and check AxeBuilder results here'); break;
      default: skip(step, id ? `"${id}" has no Playwright equivalent here` : 'no action'); break;
    }
  }

  const setup = (test.preconditions ?? []).map((pc) => `  expect((await ${apiCall(pc, used)}).ok(), ${js(`precondition ${pc.name}`)}).toBe(true);`);
  const cleanup = (test.cleanups ?? []).map((c) => `    await ${apiCall(c, used)}.catch(() => undefined); // ${c.name.replace(/\n/g, ' ')}`);
  const rows = Array.isArray(test.dataset) && test.dataset.length > 0 ? test.dataset : null;
  if (rows) for (const key of Object.keys(rows[0] ?? {})) used.add(key);
  used.delete('loopIndex');
  const variables = [...used].sort();

  const header = [
    `// Exported from WebFlowMaster: ${test.name.replace(/\n/g, ' ')}${test.version ? ` (version ${test.version})` : ''}.`,
    variables.length > 0 ? `// Variables come from the environment: ${variables.map((n) => `${envName(n)} for {{${n}}}`).join(', ')}.` : '',
    notExported.length > 0 ? `// ${notExported.length} step(s) could not be exported and are comments below.` : '',
  ].filter(Boolean);

  const inner = [
    ...(setup.length ? ['  // Preconditions', ...setup] : []),
    ...(cleanup.length ? ['  try {'] : []),
    ...body.map((line) => (cleanup.length ? `  ${line}` : line)),
    ...(cleanup.length ? ['  } finally {', '    // Cleanup, whatever happened', ...cleanup, '  }'] : []),
  ];

  const code = [
    ...header,
    "import { test, expect, type Page } from '@playwright/test';",
    '',
    'const vars: Record<string, string> = {',
    ...variables.map((n) => `  ${js(n)}: process.env.${envName(n)} ?? '',`),
    '};',
    '',
    '/** Fills {{name}} from vars, as a WebFlowMaster run does. */',
    "const v = (text: string) => text.replace(/\\{\\{\\s*([\\w.]+)\\s*\\}\\}/g, (match, name) => (name in vars ? vars[name] : match));",
    '',
    '/** "a == b", "a > 3", "a contains b", true, false: the comparisons of an if or an Assert values step. */',
    'function holds(expression: string): boolean {',
    '  const text = expression.trim();',
    "  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';",
    '  const words = /^(.*?)\\s+(not contains|contains)\\s+(.*)$/is.exec(text);',
    "  if (words) return words[1].trim().includes(words[3].trim()) === (words[2].toLowerCase() === 'contains');",
    '  const m = /^(.*?)\\s*(==|!=|>=|<=|>|<)\\s*(.*)$/s.exec(text);',
    "  if (!m) throw new Error(`Not a comparison: ${expression}`);",
    '  const [, left, op, right] = m.map((s) => s.trim());',
    "  if (op === '==') return left === right;",
    "  if (op === '!=') return left !== right;",
    '  const a = Number(left), b = Number(right);',
    "  return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;",
    '}',
    '',
    ...(rows
      ? [
          `const rows: Array<Record<string, string>> = ${JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, value]) => [k, value == null ? '' : String(value)]))), null, 2)};`,
          '',
          'for (const [index, row] of rows.entries()) {',
          `  test(\`${test.name.replace(/[`\\$]/g, '\\$&')} — row \${index + 1}\`, async ({ page, request }) => {`,
          '    Object.assign(vars, row);',
          '    let p: Page = page;',
          ...inner.map((line) => `  ${line}`),
          '  });',
          '}',
        ]
      : [
          `test(${js(test.name)}, async ({ page, request }) => {`,
          '  let p: Page = page;',
          ...inner,
          '});',
        ]),
    '',
  ].join('\n');

  return { fileName: playwrightFileName(test.name), code, notExported, variables };
}
