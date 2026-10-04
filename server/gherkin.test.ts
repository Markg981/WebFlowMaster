import { describe, expect, it } from 'vitest';
import { parseGherkin, exportGherkin, validateBddTest, autodetectGherkin } from './gherkin';
import { BddTestSchema } from '@shared/bdd';
import { dialects } from '@cucumber/gherkin';

describe('Gherkin files', () => {
  it('expands backgrounds, outlines and examples into manual tests, retaining tags', () => {
    const result = parseGherkin(`@smoke
Feature: Login
  Background:
    Given a browser
  @auth
  Scenario Outline: Login as <user>
    When I sign in as <user>
    Then I see <user>
    Examples:
      | user |
      | Alice |
      | Bob |`);
    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].name).toBe('Login / Login as Alice [1]');
    const sequence = result.tests[0].sequence as any[];
    expect(sequence.map(s => s.value)).toEqual(['Given a browser', 'When I sign in as Alice', 'Then I see Alice']);
    expect(sequence.every(s => s.action.id === 'manualStep')).toBe(true);
    expect(sequence[2].expected).toBe('I see Alice');
    expect(sequence[0].gherkin.tags).toEqual(['@smoke', '@auth']);
  });
  it('compiles Italian Rule backgrounds, descriptions and typed doc strings', () => {
    const result = parseGherkin('# language: it\n@feature\nFunzionalità: Accesso\n Descrizione\n Contesto:\n  Dato comune\n Regola: Clienti\n  Contesto:\n   Dato richiesta\n    """json\n    payload\n    """\n  @scenario\n  Scenario: Salva\n   Allora salvato\n   E visibile');
    expect(result.tests[0].bdd).toMatchObject({ language: 'it', mode: 'manual', scenarioLine: 14 });
    const steps = result.tests[0].sequence as any[];
    expect(steps[1].gherkin.docString).toMatchObject({ mediaType: 'json', content: 'payload' });
    expect(steps[3].expected).toBe('visibile');
    expect(steps[0].gherkin.tags).toEqual(['@feature', '@scenario']);
    expect(result.tests[0].name).toBe('Accesso / Clienti / Salva');
  });
  it('compiles tagged multiple Examples and substitutes escaped arguments', () => {
    const source = '@feature\nFeature: F\nScenario Outline: S <x>\n Given payload <x>\n  """\n  <x>\n  """\n Then table\n  | a\\|b | <x> | back\\\\slash | line\\nbreak |\n @first\n Examples:\n | x |\n | Alice |\n @second\n Examples:\n | x |\n | Bob |';
    const tests = parseGherkin(source).tests;
    expect(tests).toHaveLength(2);
    expect(tests[1].bdd).toMatchObject({ scenarioLine: 3, exampleLine: 17 });
    expect((tests[0].sequence as any[])[0].gherkin.docString.content).toBe('Alice');
    expect((tests[1].sequence as any[])[1].gherkin.dataTable.rows[0].cells.map((c: any) => c.value)).toEqual(['a|b', 'Bob', 'back\\slash', 'line\nbreak']);
    expect((tests[1].sequence as any[])[0].gherkin.tags).toEqual(['@feature', '@second']);
  });
  it.each([
    ['fr', 'Fonctionnalité', 'Scénario', 'Soit', 'Alors'],
    ['de', 'Funktionalität', 'Szenario', 'Angenommen', 'Dann'],
    ['ja', '機能', 'シナリオ', '前提', 'ならば'],
  ])('supports the official %s dialect and expected semantics', (language, feature, scenario, given, then) => {
    const test = parseGherkin(`# language: ${language}\n${feature}: F\n${scenario}: S\n ${given} a\n ${then} b`).tests[0];
    expect(test.bdd).toMatchObject({ language });
    expect((test.sequence as any[])[1].expected).toBe('b');
  });
  it('rejects missing examples and unresolved parameters', () => {
    expect(() => parseGherkin('Feature: F\nScenario Outline: S\nGiven <x>')).toThrow(/Examples/);
    expect(() => parseGherkin('Feature: F\nScenario Outline: S\nGiven <x>\nExamples:\n| y |\n| a |')).toThrow(/parameter/);
  });
  it('round trips actual automated actions and web-test fields through explicit metadata', () => {
    const test = { name: 'Save', url: 'https://example.test', sequence: [{ id: 'a', action: { id: 'click', name: 'Click' }, value: '#save' }], dataset: [{ user: 'Alice' }] };
    const exported = exportGherkin({ project: 'App', tests: [test] });
    expect(exported.content).toContain('Scenario: Save');
    expect(parseGherkin(exported.content).tests[0]).toEqual(test);
    expect(() => parseGherkin(exported.content.replace('When Click: #save', 'When changed'))).toThrow(/metadata/);
  });
  it('rejects duplicate scenario names rather than overwriting a test', () => {
    expect(() => parseGherkin('Feature: F\nScenario: S\nGiven a\nScenario: S\nGiven b')).toThrow(/Duplicate/);
  });
  it('requires a UUID/revision binding only for Cucumber execution', () => {
    const source = 'Feature: F\nScenario: S\n Given a';
    expect(() => parseGherkin(source, { mode: 'cucumber' })).toThrow(/binding/);
    expect(() => parseGherkin(source, { mode: 'cucumber', binding: { id: 'path/to/support.js', revision: 'one' } })).toThrow();
    const binding = { id: '72f83bc2-f246-4fa2-8aa1-824374226c0f', revision: 'one' };
    const bdd = parseGherkin(source, { mode: 'cucumber', binding }).tests[0].bdd;
    expect(bdd).toMatchObject({ mode: 'cucumber', binding });
    expect(validateBddTest(bdd)).toEqual(bdd);
    expect(BddTestSchema.safeParse({ ...(bdd as object), mode: 'manual', binding: undefined }).success).toBe(true);
  });
  it('validates exact source selectors and dialect instead of names', () => {
    const bdd = parseGherkin('Feature: F\nScenario Outline: S\n Given <x>\n Examples:\n | x |\n | a |\n | b |').tests[0].bdd as any;
    expect(() => validateBddTest({ ...bdd, exampleLine: undefined })).toThrow(/exactly one/);
    expect(() => validateBddTest({ ...bdd, exampleLine: 5 })).toThrow(/exactly one/);
    expect(() => validateBddTest({ ...bdd, scenarioLine: 3 })).toThrow(/exactly one/);
    expect(() => validateBddTest({ ...bdd, language: 'it' })).toThrow(/dialect/);
    expect(validateBddTest({ ...bdd, exampleLine: 7 }).exampleLine).toBe(7);
  });
  it('exports only the selected Outline row, preserving arguments, tags and original selector', () => {
    const source = '# language: it\n@feature\nFunzionalità: F\n Regola: R\n  Schema dello scenario: S <x>\n   Dato payload\n    """json\n    <x>\n    """\n   Allora tabella\n    | a\\|b | <x> |\n  @example\n  Esempi:\n   | x |\n   | Alice |\n   | Bob |\n  Scenario: Non selezionato\n   Dato altro';
    const test = parseGherkin(source).tests[1];
    const exported = exportGherkin({ project: 'F', tests: [test] });
    const roundTrip = parseGherkin(exported.content);
    expect(roundTrip.tests).toEqual([test]);
    const withoutMetadata = parseGherkin(exported.content.replace(/^.*# wfm-test:.*$/m, ''));
    expect(withoutMetadata.tests).toHaveLength(1);
    expect((withoutMetadata.tests[0].sequence as any[])[0].gherkin.docString.content).toBe('Bob');
    expect(exported.content).toContain('# language: it');
    expect(exported.content).toContain('Regola: R');
    expect(() => parseGherkin(exported.content.replace('    Bob\n', '    changed\n'))).toThrow(/metadata/);
    expect(() => parseGherkin(exported.content.replace('| a\\|b | Bob |', '| different | Bob |'))).toThrow(/metadata/);
    expect(() => parseGherkin(exported.content.replace('@feature @example', '@edited @example'))).toThrow(/metadata/);
  });
  it('disambiguates identical names in distinct Rules and rejects duplicate final names', () => {
    const source = 'Feature: F\n Rule: A\n  Scenario: S\n   Given a\n Rule: B\n  Scenario: S\n   Given b';
    expect(parseGherkin(source).tests.map(test => test.name)).toEqual(['F / A / S', 'F / B / S']);
    expect(() => parseGherkin(source.replace('Rule: B', 'Rule: A'))).toThrow(/Duplicate/);
  });
  it('reports dialect and grammar errors with source locations', () => {
    expect(() => parseGherkin('# language: imaginary\nFeature: F\nScenario: S\n Given a')).toThrow(/imaginary|language/i);
    expect(() => parseGherkin('Feature: F\nScenario: S\n Given a\n  | x |\n  | x | y |')).toThrow(/Line 5|\(5:/);
    expect(() => parseGherkin('Feature: F\nScenario: S\n Given a\n  """\n unfinished')).toThrow(/Line|\(/);
  });
  it('detects every official Feature dialect and unknown language directives', () => {
    expect(autodetectGherkin('# language: unknown\nwhatever')).toBe(true);
    expect(autodetectGherkin('\uFEFF@tag\nFonctionnalité: F')).toBe(true);
    expect(autodetectGherkin('Funktionalität: F')).toBe(true);
    expect(autodetectGherkin('project: app\ntests: []')).toBe(false);
  });
  it('enforces input, expanded scenario, step and persisted source limits', () => {
    expect(() => parseGherkin('x'.repeat(20 * 1024 * 1024 + 1))).toThrow(/20 MiB/);
    const outline = 'Feature: F\nScenario Outline: S\n Given <x>\n Examples:\n | x |\n';
    expect(() => parseGherkin(outline + ' | a |\n'.repeat(2001))).toThrow(/2000/);
    const steps = ' Given <x>\n'.repeat(51);
    expect(() => parseGherkin('Feature: F\nScenario Outline: S\n' + steps + ' Examples:\n | x |\n' + ' | a |\n'.repeat(2000))).toThrow(/100000/);
    expect(() => parseGherkin('# ' + 'x'.repeat(100_000) + '\n' + outline + ' | a |\n'.repeat(700))).toThrow(/64 MiB/);
  });
  it('rejects malformed, duplicate and dangling metadata and ignores doc string comments', () => {
    expect(() => parseGherkin('Feature: F\n # wfm-test: {}\nScenario: S\n Given a')).toThrow(/metadata/);
    expect(() => parseGherkin('Feature: F\nScenario: S\n Given a\n # wfm-test: {}')).toThrow(/metadata/);
    const source = 'Feature: F\nScenario: S\n Given a\n  """\n  # wfm-test: {}\n  """';
    expect((parseGherkin(source).tests[0].sequence as any[])[0].gherkin.docString.content).toBe('# wfm-test: {}');
  });
  it('accepts every dialect in the official catalogue', () => {
    for (const [language, dialect] of Object.entries(dialects)) {
      const pick = (words: readonly string[]) => words.find(word => word.trim() !== '*')!;
      const source = `# language: ${language}\n${pick(dialect.feature)}: F\n${pick(dialect.scenario)}: S\n ${pick(dialect.given)}a\n ${pick(dialect.then)}b`;
      expect(parseGherkin(source).tests[0].bdd).toMatchObject({ language });
    }
  });
  it('retains Rule tags and escaped Examples values without interpreting braces', () => {
    const source = '@feature\nFeature: F\n @rule\n Rule: R\n  @scenario\n  Scenario Outline: S\n   Given payload {{user}}\n    """<kind>\n    <x>\n    """\n  @example\n  Examples:\n   | x | kind |\n   | a\\|b\\nline | json |';
    const test = parseGherkin(source).tests[0];
    const steps = test.sequence as any[];
    expect(steps[0].value).toBe('Given payload {{user}}');
    expect(steps[0].gherkin.docString).toEqual({ content: 'a|b\nline', mediaType: 'json' });
    expect(steps[0].gherkin.tags).toEqual(['@feature', '@rule', '@scenario', '@example']);
    expect(parseGherkin(exportGherkin({project:'F', tests:[test]}).content).tests[0]).toEqual(test);
  });
  it('exports unruled scenarios before Rules so they cannot inherit an unrelated Rule', () => {
    const ruled = parseGherkin('Feature: F\n Rule: R\n  Scenario: In Rule\n   Given a').tests[0];
    const plain = parseGherkin('Feature: F\n Scenario: Outside\n  Given b').tests[0];
    const source = exportGherkin({ project: 'F', tests: [ruled, plain] }).content.replace(/^.*# wfm-test:.*$/gm, '');
    const tests = parseGherkin(source).tests;
    const outside = tests.find(test => test.scenario === plain.name)!;
    expect((outside.sequence as any[])[0].gherkin.rule).toBeUndefined();
  });
  it('bounds substitution amplification and forbids filesystem URI metadata', () => {
    const source = 'Feature: F\nScenario Outline: S\n Given payload\n  """\n  ' + '<x>'.repeat(70_000) + '\n  """\n Examples:\n | x |\n | ' + 'a'.repeat(1024) + ' |';
    expect(() => parseGherkin(source)).toThrow(/64 MiB/);
    const bdd = parseGherkin('Feature: F\nScenario: S\n Given a').tests[0].bdd as any;
    expect(() => validateBddTest({ ...bdd, uri: '../secret.feature' })).toThrow(/logical/);
    expect(() => validateBddTest({ ...bdd, uri: 'C:\\support\\x.feature' })).toThrow(/logical/);
  });
  it('round trips doc strings containing both delimiters and literal escapes', () => {
    const source = ['Feature: F', 'Scenario: S', ' Given payload', '  """', String.raw`  \"\"\"`, String.raw`  \"\"\" and literal \\"""`, '  ```', '  """'].join('\n');
    const test = parseGherkin(source).tests[0];
    expect(parseGherkin(exportGherkin({ project: 'F', tests: [test] }).content).tests).toEqual([test]);
  });
  it('exports only one Examples row when escaped values produce multiline step text', () => {
    const source = 'Feature: F\nBackground:\n Given literal <x>\nScenario Outline: S\n Given value <x>\n Then done\n Examples:\n | x |\n | a\\nb |\n | other |';
    const test = parseGherkin(source).tests[0];
    const exported = exportGherkin({project:'F',tests:[test]}).content;
    expect(parseGherkin(exported).tests).toEqual([test]);
    const portable = parseGherkin(exported.replace(/^.*# wfm-test:.*$/m, '')).tests;
    expect(portable).toHaveLength(1);
    expect((portable[0].sequence as any[]).map(step => step.value)).toEqual(['Given literal <x>', 'Given value a\nb', 'Then done']);
  });
  it('counts restored metadata source bytes rather than duplicating the entire export per test', () => {
    const source = '# ' + 'x'.repeat(100_000) + '\nFeature: F\nScenario Outline: S\n Given <x>\n Examples:\n | x |\n' + ' | a |\n'.repeat(30);
    const tests = parseGherkin(source).tests;
    expect(parseGherkin(exportGherkin({project:'F',tests}).content).tests).toEqual(tests);
  });
  it('preserves Examples-generated DataTable edge spaces with only the selected row', () => {
    const source = 'Feature: F\nScenario Outline: S\n Given table\n  | <x> a | a <x> |\n Examples:\n | x |\n | |\n | other |';
    const test = parseGherkin(source).tests[0];
    const exported = exportGherkin({ project: 'F', tests: [test] }).content;
    expect(parseGherkin(exported).tests).toEqual([test]);
    const portable = parseGherkin(exported.replace(/^.*# wfm-test:.*$/m, '')).tests;
    expect(portable).toHaveLength(1);
    expect((portable[0].sequence as any[])[0].gherkin.dataTable.rows[0].cells.map((cell: any) => cell.value)).toEqual([' a', 'a ']);
  });
  it('preserves an unnamed Rule in metadata and independently runnable export', () => {
    const test = parseGherkin('Feature: F\n Rule:\n  Scenario: S\n   Given a').tests[0];
    const exported = exportGherkin({ project: 'F', tests: [test] }).content;
    expect(exported).toContain('Rule: ');
    expect(parseGherkin(exported).tests).toEqual([test]);
    const portable = parseGherkin(exported.replace(/^.*# wfm-test:.*$/m, '')).tests;
    expect((portable[0].sequence as any[])[0].gherkin.rule).toBe('');
  });
  it('preserves earlier literal placeholders in names after sequential Examples substitution', () => {
    const source = 'Feature: F\nScenario Outline: S <y>\n Given value <y>\n Examples:\n | x | y |\n | a | <x>\\nb |\n | other | another |';
    const test = parseGherkin(source).tests[0];
    expect(test.name).toBe('F / S <x>\nb [1]');
    const exported = exportGherkin({ project: 'F', tests: [test] }).content;
    expect(parseGherkin(exported).tests).toEqual([test]);
    const portable = parseGherkin(exported.replace(/^.*# wfm-test:.*$/m, '')).tests;
    expect(portable).toHaveLength(1);
    expect((portable[0].sequence as any[])[0].value).toBe('Given value <x>\nb');
    expect(portable[0].scenario).toContain('<x>');
  });
});
