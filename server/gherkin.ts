import { dialects } from '@cucumber/gherkin';
import { PickleStepType, type Pickle } from '@cucumber/messages';
import { toSequence } from '@shared/manual-tests';
import { bddTestSchema, gherkinImportOptionsSchema, BDD_MAX_PERSISTED_BYTES, type BddTest, type GherkinImportOptions } from '@shared/bdd';
import { compileGherkinSource, contextOfPickle, exampleLineOfPickle, GherkinError, type CompiledGherkin } from './gherkin-source';
export { GherkinError, validateBddTest, autodetectGherkin, compileGherkinSource } from './gherkin-source';

const clean = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
type ReadableStep = { line: string; docString?: { content: string; mediaType?: string }; dataTable?: { rows: readonly { cells: readonly { value: string }[] }[] } };

function pickleSteps(compiled: CompiledGherkin, pickle: Pickle) {
  const context = contextOfPickle(compiled, pickle);
  return pickle.steps.map(step => {
    const astStep = step.astNodeIds.map(id => compiled.steps.get(id)).find(Boolean)!;
    const gherkin = {
      keyword: astStep.keyword.trim(), keywordType: astStep.keywordType, location: astStep.location,
      tags: pickle.tags.map(tag => tag.name), ...(context.rule ? { rule: context.rule.name } : {}),
      ...(step.argument?.docString ? { docString: step.argument.docString } : {}),
      ...(step.argument?.dataTable ? { dataTable: step.argument.dataTable } : {}),
    };
    return { text: step.text, keyword: astStep.keyword.trim(), expected: step.type === PickleStepType.OUTCOME, gherkin };
  });
}

/** Official multilingual Gherkin. Only explicit metadata restores executable browser actions. */
export function parseGherkin(content: string, options?: GherkinImportOptions): { project: string; tests: Record<string, unknown>[]; apiTests: Record<string, unknown>[] } {
  const execution = gherkinImportOptionsSchema.parse(options ?? {});
  const compiled = compileGherkinSource(content, 'import.feature', true);
  const feature = compiled.document.feature!;
  const metadata = new Map<string, Record<string, unknown>>();
  const scenarios = [...compiled.contexts.values()].map(context => context.scenario).sort((a, b) => a.location.line - b.location.line);
  for (const comment of compiled.document.comments) {
    if (!/^\s*#\s*wfm-test:/.test(comment.text)) continue;
    const scenario = scenarios.find(item => item.location.line > comment.location.line);
    if (!scenario || metadata.has(scenario.id)) throw new GherkinError(`Line ${comment.location.line}: Dangling or duplicate WFM metadata.`);
    let parsed: any;
    try { parsed = JSON.parse(comment.text.replace(/^\s*#\s*wfm-test:\s*/, '')); }
    catch { throw new GherkinError(`Line ${comment.location.line}: Invalid WFM metadata JSON.`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.name !== 'string' || !Array.isArray(parsed.sequence)) throw new GherkinError(`Line ${comment.location.line}: Invalid WFM metadata.`);
    if (scenario.examples.reduce((total, examples) => total + examples.tableBody.length, 0) > 1) throw new GherkinError('WFM metadata requires a concrete Scenario or exactly one Examples row.');
    metadata.set(scenario.id, parsed);
  }
  const tests: Record<string, unknown>[] = [], names = new Set<string>(), rowIndices = new Map<string, number>();
  const sourceCache = new Map<string, CompiledGherkin>();
  let bytes = 0;
  for (const pickle of compiled.pickles) {
    const context = contextOfPickle(compiled, pickle), steps = pickleSteps(compiled, pickle);
    const rowIndex = (rowIndices.get(context.scenario.id) ?? 0) + 1;
    rowIndices.set(context.scenario.id, rowIndex);
    const exampleLine = exampleLineOfPickle(context, pickle);
    const name = `${feature.name}${context.rule ? ` / ${context.rule.name}` : ''} / ${pickle.name}${exampleLine ? ` [${rowIndex}]` : ''}`;
    const bdd: BddTest = bddTestSchema.parse({ language: feature.language, source: content, uri: 'import.feature', scenarioLine: context.scenario.location.line, ...(exampleLine ? { exampleLine } : {}), mode: execution.mode ?? 'manual', ...(execution.binding ? { binding: execution.binding } : {}) });
    let test: Record<string, unknown>;
    const saved = metadata.get(context.scenario.id);
    if (saved) {
      const actual = steps.map(step => ({ line: `${step.keyword} ${step.text}`, ...(step.gherkin.docString ? { docString: step.gherkin.docString } : {}), ...(step.gherkin.dataTable ? { dataTable: step.gherkin.dataTable } : {}) }));
      if (context.scenario.name !== clean(saved.name) || JSON.stringify(actual) !== JSON.stringify(readableSteps(saved))) throw new GherkinError('Scenario differs from WFM metadata. Remove the metadata comment to import edited prose as manual steps.');
      if (saved.bdd) {
        const original = selectedBdd(saved.bdd, sourceCache);
        if (JSON.stringify(actual) !== JSON.stringify(sourceReadable(original.compiled, original.pickle)) || JSON.stringify(pickle.tags.map(tag => tag.name)) !== JSON.stringify(original.pickle.tags.map(tag => tag.name)) || context.rule?.name !== contextOfPickle(original.compiled, original.pickle).rule?.name) throw new GherkinError('Scenario differs from WFM BDD metadata source.');
      }
      test = saved.bdd && (execution.mode || execution.binding) ? { ...saved, bdd: bddTestSchema.parse({ ...(saved.bdd as BddTest), mode: execution.mode ?? (saved.bdd as BddTest).mode, ...(execution.binding ? { binding: execution.binding } : {}) }) } : saved;
    } else {
      test = { name, url: '', featureArea: feature.name, scenario: pickle.name, bdd, sequence: toSequence(steps.map(step => ({ action: `${step.keyword} ${step.text}`, expected: step.expected ? step.text : '' }))).map((step, i) => ({ ...step, gherkin: steps[i].gherkin })) };
    }
    if (names.has(String(test.name))) throw new GherkinError(`Duplicate scenario name: ${String(test.name)}.`);
    names.add(String(test.name)); tests.push(test);
    bytes += Buffer.byteLength(JSON.stringify(test));
    if (bytes > BDD_MAX_PERSISTED_BYTES) throw new GherkinError('Feature exceeds 64 MiB of persisted source and argument expansion.');
  }
  return { project: feature.name, tests, apiTests: [] };
}

function readableSteps(test: Record<string, unknown>): ReadableStep[] {
  const sequence = test.sequence;
  if (!Array.isArray(sequence) || !sequence.length) throw new GherkinError(`Test ${String(test.name)} needs a nonempty step array to export.`);
  return sequence.flatMap((step: any): ReadableStep[] => {
    if (!step || typeof step !== 'object' || !step.action) throw new GherkinError(`Test ${String(test.name)} has invalid steps.`);
    if (step.action.id === 'manualStep') {
      const value = test.bdd ? String(step.value ?? '') : clean(step.value);
      if (!value) throw new GherkinError(`Test ${String(test.name)} has an empty manual step.`);
      const expected = test.bdd ? String(step.expected ?? '') : clean(step.expected);
      const keyword = step.gherkin?.keyword;
      const line = keyword ? `${keyword} ${value.startsWith(`${keyword} `) ? value.slice(keyword.length + 1) : value}` : /^(Given|When|Then|And|But|\*)\s+/.test(value) ? value : `When ${value}`;
      const args = { ...(step.gherkin?.docString ? { docString: step.gherkin.docString } : {}), ...(step.gherkin?.dataTable ? { dataTable: step.gherkin.dataTable } : {}) };
      return [{ line, ...args }, ...(expected && !value.endsWith(` ${expected}`) ? [{ line: `Then ${expected}` }] : [])];
    }
    return [{ line: `When ${clean(step.action.name || step.action.id)}${step.value == null || step.value === '' ? '' : `: ${clean(step.value)}`}` }];
  });
}

function renderStep(step: ReadableStep, indent: string): string[] {
  const lines = [`${indent}${step.line}`];
  if (step.docString) {
    const contentLines = step.docString.content.split('\n');
    // The official matcher unescapes the first delimiter sequence on each content line.
    const escaped = (delimiter: string) => delimiter.split('').map(char => `\\${char}`).join('');
    const delimiter = ['"""', '```'].find(candidate => contentLines.every(line => line.indexOf(escaped(candidate)) < 0 || (line.indexOf(candidate) >= 0 && line.indexOf(candidate) < line.indexOf(escaped(candidate)))))!;
    if (!delimiter) throw new GherkinError('Doc string cannot be exported with an unambiguous delimiter.');
    lines.push(`${indent}  ${delimiter}${step.docString.mediaType ?? ''}`, ...contentLines.map(line => `${indent}  ${line.replace(delimiter, escaped(delimiter))}`), `${indent}  ${delimiter}`);
  }
  if (step.dataTable) for (const row of step.dataTable.rows) lines.push(`${indent}  | ${row.cells.map(cell => cell.value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\|/g, '\\|')).join(' | ')} |`);
  return lines;
}

function sourceReadable(compiled: CompiledGherkin, pickle: Pickle): ReadableStep[] {
  return pickleSteps(compiled, pickle).map(step => ({ line: `${step.keyword} ${step.text}`, ...(step.gherkin.docString ? { docString: step.gherkin.docString } : {}), ...(step.gherkin.dataTable ? { dataTable: step.gherkin.dataTable } : {}) }));
}

function selectedBdd(value: unknown, cache: Map<string, CompiledGherkin>) {
  const bdd = bddTestSchema.parse(value);
  let compiled = cache.get(bdd.source);
  if (!compiled) { compiled = compileGherkinSource(bdd.source, bdd.uri); cache.set(bdd.source, compiled); }
  if (compiled.document.feature!.language !== bdd.language) throw new GherkinError('BDD language does not match the source dialect.');
  const selected = compiled.pickles.filter(item => { const context = contextOfPickle(compiled!, item); return context.scenario.location.line === bdd.scenarioLine && exampleLineOfPickle(context, item) === bdd.exampleLine; });
  if (selected.length !== 1) throw new GherkinError('BDD selector must select exactly one scenario or Examples row.');
  const pickle = selected[0];
  return { bdd, compiled, pickle };
}

/** A single-row Outline retains newline substitutions which concrete step syntax cannot express. */
function selectedOutline(selection: ReturnType<typeof selectedBdd>) {
  const context = contextOfPickle(selection.compiled, selection.pickle);
  const examples = context.scenario.examples.find(item => item.tableBody.some(row => row.location.line === selection.bdd.exampleLine))!;
  const row = examples.tableBody.find(item => item.location.line === selection.bdd.exampleLine)!;
  const keys = examples.tableHeader!.cells.map(cell => cell.value);
  let prefix = 'wfm_selected_';
  while (selection.bdd.source.includes(`<${prefix}`)) prefix += '_';
  const names = keys.map((_, index) => `${prefix}${index + 1}`);
  const remap = (value: string, after = -1) => value.replace(/<([^>]+)>/g, (token, key: string) => { const index = keys.indexOf(key); return index > after ? `<${names[index]}>` : token; });
  const backgroundCount = context.steps.length - context.scenario.steps.length;
  const steps = [
    ...sourceReadable(selection.compiled, selection.pickle).slice(0, backgroundCount),
    ...context.scenario.steps.map(step => ({
      line: `${step.keyword.trim()} ${remap(step.text)}`,
      ...(step.docString ? { docString: { content: remap(step.docString.content), ...(step.docString.mediaType ? { mediaType: remap(step.docString.mediaType) } : {}) } } : {}),
      ...(step.dataTable ? { dataTable: { rows: step.dataTable.rows.map(item => ({ cells: item.cells.map(cell => ({ value: remap(cell.value) })) })) } } : {}),
    })),
  ];
  const literals = [...new Set(steps.slice(0, backgroundCount).flatMap(step => [step.line, step.docString?.content ?? '', step.docString?.mediaType ?? '', ...(step.dataTable?.rows.flatMap(item => item.cells.map(cell => cell.value)) ?? [])]).flatMap(value => [...value.matchAll(/<([^>]+)>/g)].map(match => match[1])))];
  return { steps, table: { rows: [{ cells: [...names, ...literals].map(value => ({value})) }, { cells: [...row.cells.map((cell, index) => ({ value: remap(cell.value, index) })), ...literals.map(key => ({value:`<${key}>`}))] }] } };
}

/** Concrete selected scenarios preserve arguments and dialect; metadata restores the original selector. */
export function exportGherkin(input: { project: string | null; tests: Record<string, unknown>[] }): { content: string; fileName: string } {
  if (!input.tests.length) throw new GherkinError('No web tests to export. Gherkin does not include API tests.');
  const languages = new Set(input.tests.filter(test => test.bdd).map(test => (test.bdd as BddTest).language));
  if (languages.size > 1 || (languages.size && input.tests.some(test => !test.bdd) && !languages.has('en'))) throw new GherkinError('Export one Gherkin dialect at a time.');
  const language = [...languages][0] ?? 'en', dialect = dialects[language];
  if (!dialect) throw new GherkinError(`Unsupported Gherkin dialect: ${language}.`);
  const keyword = (values: readonly string[]) => values.find(value => value !== '*')!.trim();
  const lines = ['# WebFlowMaster metadata restores web tests; prose alone imports as manual steps.', `# language: ${language}`, `${keyword(dialect.feature)}: ${clean(input.project) || 'WebFlowMaster tests'}`, ''];
  const sourceCache = new Map<string, CompiledGherkin>();
  const selectedTests = input.tests.map(test => ({ test, selected: test.bdd ? selectedBdd(test.bdd, sourceCache) : undefined }));
  // Gherkin has no end-Rule marker: top-level scenarios must precede Rules.
  selectedTests.sort((a, b) => Number(!!(a.selected && contextOfPickle(a.selected.compiled, a.selected.pickle).rule)) - Number(!!(b.selected && contextOfPickle(b.selected.compiled, b.selected.pickle).rule)));
  for (const { test, selected: selection } of selectedTests) {
    let rule: string | undefined, tags: string[] = [];
    if (test.bdd) {
      const { compiled, pickle: selected } = selection!;
      rule = contextOfPickle(compiled, selected).rule?.name;
      tags = selected.tags.map(tag => tag.name);
      // The stored sequence is part of the source contract, even for manual BDD tests.
      const actual = sourceReadable(compiled, selected);
      if (JSON.stringify(actual) !== JSON.stringify(readableSteps(test))) throw new GherkinError('BDD steps differ from the selected source scenario.');
    }
    if (rule) lines.push(`  ${keyword(dialect.rule)}: ${clean(rule)}`);
    const indent = rule ? '    ' : '  ';
    if (tags.length) lines.push(`${indent}${tags.join(' ')}`);
    const readable = readableSteps(test);
    let outline: ReturnType<typeof selectedOutline> | undefined;
    let rendered: string[];
    try {
      if (readable.some(step => /[\r\n]/.test(step.line) || /[\r\n]/.test(step.docString?.mediaType ?? ''))) throw new GherkinError('Multiline Examples require a single-row Outline.');
      rendered = readable.flatMap(step => renderStep(step, `${indent}  `));
    } catch (error) {
      if (!selection?.bdd.exampleLine) throw error;
      outline = selectedOutline(selection);
      rendered = outline.steps.flatMap(step => renderStep(step, `${indent}  `));
      rendered.push(`${indent}  ${keyword(dialect.examples)}:`, ...renderStep({ line: '', dataTable: outline.table }, `${indent}  `).slice(1));
    }
    const scenarioKeyword = outline ? keyword(dialect.scenarioOutline) : dialect.scenario.includes('Scenario') ? 'Scenario' : keyword(dialect.scenario);
    lines.push(`${indent}# wfm-test: ${JSON.stringify(test)}`, `${indent}${scenarioKeyword}: ${clean(test.name)}`, ...rendered, '');
  }
  const content = lines.join('\n');
  if (Buffer.byteLength(content) > 20 * 1024 * 1024) throw new GherkinError('Feature file exceeds 20 MiB. Export fewer tests.');
  return { content, fileName: `${(input.project || 'tests').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.feature` };
}
