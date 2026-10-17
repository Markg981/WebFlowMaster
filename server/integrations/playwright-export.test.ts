import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { ADHOC_ACTION_IDS } from '@shared/recording';
import { compareValues } from '../runtime/value-comparison';
import {
  ACTION_CONFORMANCE,
  ExportNotConformantError,
  FEATURE_CONFORMANCE,
  toPlaywright,
  type ExportableStep,
  type ExportableTest,
} from './playwright-export';

/**
 * The exportable subset, certified (P15, M04): every action has a verdict, the supported ones come
 * out without findings and as valid TypeScript, the generated helpers decide what the runner's own
 * functions decide, strict never returns a file with a gap, and secrets stay placeholders.
 */

const step = (
  id: string,
  value?: string,
  selector?: string,
  frameSelector?: string,
): ExportableStep => ({
  action: { id, name: id },
  value,
  targetElement: selector ? { selector, ...(frameSelector ? { frameSelector } : {}) } : undefined,
});
const web = (sequence: ExportableStep[], extra: Partial<ExportableTest> = {}): ExportableTest => ({
  name: 'Conformance',
  url: '{{baseUrl}}/',
  sequence,
  ...extra,
});

/** One step per supported action, written the way a tester would. */
const SUPPORTED: ExportableStep[] = [
  step('click', undefined, '#a'),
  step('doubleClick', undefined, '#a'),
  step('rightClick', undefined, '#a'),
  step('hover', undefined, '#a'),
  step('input', '{{user}}', '#u'),
  step('select', 'IT', '#country'),
  step('selectByText', 'Italy', '#country-picker'),
  step('wait', '250'),
  step('scroll'),
  step('scroll', undefined, '#footer'),
  step('navigate', '{{baseUrl}}/next'),
  step('assert', undefined, '#done'),
  step('assertTextContains', 'Total', '#total'),
  step('assertElementCount', '>=2', 'li'),
  step('assertState', 'enabled', '#go'),
  step('ensureState', 'checked', '#terms'),
  step('waitForElement', 'hidden', '#spinner'),
  step('waitForText', 'Saved', '.toast'),
  step('waitForNetworkIdle'),
  step('pressKey', 'Enter'),
  step('pressKey', 'Tab', '#u'),
  step('dragAndDrop', '#to', '#from'),
  step('uploadFile', 'invoice.csv|a,b', '#file'),
  step('handleDialog', 'accept:{{reason}}'),
  step('switchTab', 'new'),
  step('closeTab'),
  step('storeText', 'orderId', '#order'),
  step('setCookie', 'session={{sessionId}}'),
  step('clearCookies'),
  step('setLocalStorage', 'theme=dark'),
  step('executeScript', 'return document.title !== ""'),
  step('setVariable', 'total={{orderId}}'),
  step('assertCondition', '{{total}} != 0'),
  step('mockRequest', 'POST **/api/pay|500|{"error":"down"}'),
  step('blockRequests', '**/analytics/**'),
  step('clearMocks'),
  step('setGeolocation', '45.46,9.19'),
  step('if', 'visible', '#banner'),
  step('click', undefined, '#banner .close'),
  step('else'),
  step('repeat', '3'),
  step('click', undefined, '#more'),
  step('repeatWhile', 'exists', '#next'),
  step('click', undefined, '#next'),
  step('endLoop'),
  step('endLoop'),
  step('endIf'),
];

/** TypeScript syntax errors in a generated file: none means it parses. */
function syntaxErrors(code: string): string[] {
  const out = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return (out.diagnostics ?? []).map(
    (d) =>
      `${ts.flattenDiagnosticMessageText(d.messageText, '\n')} at: ${code.slice(Math.max(0, (d.start ?? 0) - 120), (d.start ?? 0) + 40)}`,
  );
}

/** A helper function out of a generated file, as JavaScript to call. */
function helper<T>(code: string, name: string, extra = ''): T {
  const start = code.indexOf(`function ${name}(`);
  const end = code.indexOf('\n}\n', start);
  expect(start).toBeGreaterThan(-1);
  const js = ts.transpileModule(`${extra}\n${code.slice(start, end + 2)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(`${js}\nreturn ${name};`)() as T;
}

describe('the conformance matrix', () => {
  it('has a verdict for every action the runner knows, and only those', () => {
    expect(Object.keys(ACTION_CONFORMANCE).sort()).toEqual([...ADHOC_ACTION_IDS].sort());
  });

  it('is the table the documentation publishes, in English and Italian', () => {
    for (const language of ['en', 'it']) {
      const page = readFileSync(
        join(__dirname, '..', '..', 'docs', language, 'guide', 'playwright-export.md'),
        'utf8',
      );
      for (const [id, row] of Object.entries(ACTION_CONFORMANCE))
        expect(page, `${language}: ${id}`).toMatch(
          new RegExp(`\\| \`${id}\` +\\| ${row.support} +\\|`),
        );
      for (const [key, row] of Object.entries(FEATURE_CONFORMANCE))
        expect(page, `${language}: ${key}`).toMatch(
          new RegExp(`\\| ${key} +\\| ${row.support} +\\|`),
        );
    }
  });
});

describe('the supported subset', () => {
  it('exports every supported action without a finding, as a file that parses', () => {
    const covered = new Set(SUPPORTED.map((s) => s.action!.id));
    for (const [id, row] of Object.entries(ACTION_CONFORMANCE))
      if (row.support === 'supported') expect(covered.has(id), id).toBe(true);

    const out = toPlaywright(web(SUPPORTED), { mode: 'strict' });
    expect(out.findings).toEqual([]);
    expect(out.complete).toBe(true);
    expect(out.code).toContain('// Conformance: complete');
    expect(out.code).not.toContain('notExported');
    expect(syntaxErrors(out.code)).toEqual([]);
  });

  it('nests loops with their own counters and gives {{loopIndex}} back to the outer loop', () => {
    const { code } = toPlaywright(web(SUPPORTED));
    expect(code).toContain('for (let i1 = 1, n1 = 3; i1 <= n1; i1++) {');
    expect(code).toContain('for (let i2 = 1; ; i2++) {');
    expect(code).toContain('if (i2 > 200) throw new Error(');
    expect(code).toMatch(/\n\s+}\n\s+vars\.loopIndex = String\(i1\);\n/);
    expect(code).toMatch(/\n\s+}\n\s+delete vars\.loopIndex;\n/);
  });

  it('runs steps inside frames through the frame chain', () => {
    const { code } = toPlaywright(
      web([step('assertTextContains', 'Paid', '#status', 'iframe#pay >> iframe.inner')]),
    );
    expect(code).toContain(
      'p.frameLocator("iframe#pay").frameLocator("iframe.inner").locator("#status").first()',
    );
  });

  it('passes custom-action arguments and the element the way the runner wraps the script', () => {
    const custom: ExportableStep = {
      ...step('executeScript', 'return args.amount > 0', '#cart'),
      args: { amount: '{{amount}}' },
    };
    const { code, findings } = toPlaywright(web([custom]));
    expect(findings).toEqual([]);
    expect(code).toContain('JSON.stringify({ "amount": v("{{amount}}") })');
    expect(code).toContain('document.querySelector(\\"#cart\\")');
  });

  it('one test per dataset row, values as strings', () => {
    const { code, findings } = toPlaywright(
      web([step('input', '{{user}}', '#u')], {
        dataset: [
          { user: 'ada', age: 36 },
          { user: 'bob', age: null },
        ],
      }),
      { mode: 'strict' },
    );
    expect(findings).toEqual([]);
    expect(code).toContain('for (const [index, row] of rows.entries()) {');
    expect(code).toContain('"age": "36"');
    expect(code).toContain('"age": ""');
    expect(syntaxErrors(code)).toEqual([]);
  });
});

describe('the generated helpers decide what the runner decides', () => {
  const { code } = toPlaywright(
    web([step('assertCondition', '{{a}} == {{b}}'), step('input', '{{x}}', '#x')]),
  );
  const holds = helper<(e: string) => boolean>(code, 'holds');
  const fill = helper<(vars: Record<string, string>, t: string) => string>(
    code,
    'fill',
    'const PLACEHOLDER = /\\{\\{\\s*([\\w.]+)\\s*\\}\\}/g;',
  );

  it.each([
    'true',
    'FALSE',
    '3 > 2',
    ' 10 <= 9 ',
    '2.5 >= 2.50',
    'abc == abc',
    'abc != abd',
    'Total: 12 contains 12',
    'Hello not contains bye',
    '1 contains',
    'a > 2',
    ' > 3',
    'no operator here',
    '007 == 7',
  ])('%s', (expression) => {
    const expected = compareValues(expression);
    if ('error' in expected) expect(() => holds(expression)).toThrow();
    else expect(holds(expression)).toBe(expected.value);
  });

  it('fails a step on a {{variable}} with no value and names its environment variable', () => {
    expect(fill({ user: 'ada' }, 'hi {{ user }}')).toBe('hi ada');
    expect(fill({ empty: '' }, '[{{empty}}]')).toBe('[]');
    expect(() => fill({}, '{{secret_password}}')).toThrow(
      /Unresolved variable\(s\): secret_password\. Set WFM_SECRET_PASSWORD/,
    );
  });
});

describe('strict and draft', () => {
  it.each([
    ['an action only a run has', [step('waitForEmail', 'ada@example.com')]],
    ['a step group left unexpanded', [step('callGroup', 'g-1')]],
    ['an unknown action', [step('teleport')]],
    ['a click with no element', [step('click')]],
    ['a generator', [step('input', '{{$randomEmail}}', '#e')]],
    ['a wait that is not a number', [step('wait', 'soon')]],
    ['a count that is not one', [step('assertElementCount', 'many', 'li')]],
    ['a state decided at run time', [step('assertState', '{{state}}', '#x')]],
    ['an unknown condition', [step('if', 'shiny', '#x'), step('endIf')]],
    ['an else without its if', [step('else')]],
    ['a loop never closed', [step('repeat', '2'), step('click', undefined, '#a')]],
    ['a dialog answer given as a variable', [step('handleDialog', '{{answer}}')]],
  ])('strict refuses %s, with the list', (_what, sequence) => {
    let error: unknown;
    try {
      toPlaywright(web(sequence), { mode: 'strict' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ExportNotConformantError);
    expect((error as ExportNotConformantError).findings.length).toBeGreaterThan(0);
  });

  it('a draft writes the file, failing where each missing step was, never skipping', () => {
    const out = toPlaywright(
      web([step('click', undefined, '#a'), step('queryDatabase', 'select 1'), step('repeat', '2')]),
    );
    expect(out.complete).toBe(false);
    expect(out.findings.map((f) => f.step)).toEqual([2, null]);
    expect(out.code).toContain('// DRAFT — 2 step(s) could not be exported');
    expect(out.code).toContain('notExported("step 2, queryDatabase (select 1)');
    expect(out.code).toContain('function notExported(what: string): never {');
    expect(out.code).not.toMatch(/test\.(skip|fixme)/);
    // The open loop is closed, so the draft still parses.
    expect(syntaxErrors(out.code)).toEqual([]);
  });

  it('runs the setup once per row where a run makes it once: a known difference strict refuses', () => {
    const test = web([step('input', '{{user}}', '#u')], {
      dataset: [{ user: 'ada' }],
      preconditions: [{ id: 'p', name: 'Seed', method: 'POST', url: '{{api}}/seed' } as never],
    });
    expect(() => toPlaywright(test, { mode: 'strict' })).toThrow(ExportNotConformantError);
    const draft = toPlaywright(test);
    expect(draft.findings).toEqual([expect.objectContaining({ support: 'partial', area: 'data' })]);
    expect(draft.notExported).toEqual([]);
    expect(draft.code).toContain('differs: dataset with preconditions');
  });
});

describe('secrets', () => {
  it('reads secrets from the environment and never writes their value', () => {
    const { code, variables } = toPlaywright(
      web([step('input', '{{secret_password}}', '#pw')], {
        preconditions: [
          {
            id: 'p',
            name: 'Login',
            method: 'POST',
            url: '{{api}}/login',
            requestHeaders: { Authorization: 'Bearer {{secret_token}}' },
            requestBody: { user: 'ada', password: '{{secret_password}}' },
          } as never,
        ],
      }),
      { mode: 'strict' },
    );
    expect(variables).toEqual(expect.arrayContaining(['secret_password', 'secret_token']));
    expect(code).toContain('["secret_password", "WFM_SECRET_PASSWORD"]');
    expect(code).toContain('"Authorization":"Bearer {{secret_token}}"');
  });

  it.each([
    ['an Authorization header', { requestHeaders: { Authorization: 'Bearer abc123' } }],
    ['an API key header', { requestHeaders: { 'X-Api-Key': 'k-123' } }],
    [
      'a password in the body',
      { method: 'POST', requestBody: { user: 'ada', password: 'hunter2' } },
    ],
    ['a token in a form body', { method: 'POST', requestBody: 'user=ada&token=abc' }],
    [
      'a password in the query',
      { queryParams: [{ key: 'password', value: 'hunter2', enabled: true }] },
    ],
  ])('refuses %s written out, and leaves it out of a draft', (_what, call) => {
    const test = web([step('click', undefined, '#a')], {
      preconditions: [
        {
          id: 'p',
          name: 'Login',
          method: 'GET',
          url: 'https://api.example/login',
          ...call,
        } as never,
      ],
    });
    expect(() => toPlaywright(test, { mode: 'strict' })).toThrow(ExportNotConformantError);
    const draft = toPlaywright(test);
    expect(draft.findings[0]).toMatchObject({ area: 'secrets', support: 'unsupported' });
    for (const secret of ['abc123', 'k-123', 'hunter2', 'token=abc'])
      expect(draft.code).not.toContain(secret);
    expect(draft.code).toContain('notExported("precondition Login")');
  });

  it('refuses a dataset column of credentials written out', () => {
    const test = web([step('input', '{{password}}', '#pw')], {
      dataset: [{ password: 'hunter2' }],
    });
    expect(() => toPlaywright(test, { mode: 'strict' })).toThrow(/password/);
    const draft = toPlaywright(test);
    expect(draft.code).not.toContain('hunter2');
    expect(draft.code).toContain('["password", "WFM_PASSWORD"]');
  });
});
