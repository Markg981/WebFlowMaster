import { toSequence } from '@shared/manual-tests';

export class GherkinError extends Error {}
type Step = { keyword: string; text: string; expected: boolean };
type Scenario = { name: string; outline: boolean; steps: Step[]; tags: string[]; examples: string[][][]; metadata?: Record<string, unknown> };
const MAX_TESTS = 2000;
const clean = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

/** English Gherkin subset. Prose becomes manual steps; executable actions require WFM export metadata. */
export function parseGherkin(content: string): { project: string; tests: Record<string, unknown>[]; apiTests: Record<string, unknown>[] } {
  if (Buffer.byteLength(content) > 20 * 1024 * 1024) throw new GherkinError('Feature file exceeds 20 MiB.');
  const background: Step[] = [];
  let feature = '', current: Scenario | undefined, inBackground = false;
  let pendingTags: string[] = [], featureTags: string[] = [], table: string[][] | undefined;
  let metadata: Record<string, unknown> | undefined, lastExpected = false;
  const scenarios: Scenario[] = [];
  const fail = (line: number, reason: string): never => { throw new GherkinError(`Line ${line}: ${reason}`); };
  for (const [index, raw] of content.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim(), number = index + 1;
    if (!line) continue;
    if (/^#\s*language:/.test(line)) {
      if (!/^#\s*language:\s*en\s*$/.test(line)) fail(number, 'Only English Gherkin is supported.');
      continue;
    }
    if (line.startsWith('# wfm-test: ')) {
      if (metadata) fail(number, 'Duplicate WFM metadata.');
      try {
        const parsed = JSON.parse(line.slice(12));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.name !== 'string' || !Array.isArray(parsed.sequence)) fail(number, 'Invalid WFM metadata.');
        metadata = parsed;
      } catch { fail(number, 'Invalid WFM metadata JSON.'); }
      continue;
    }
    if (line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      const tags = line.split(/\s+/);
      if (tags.some(tag => !/^@[^\s@]+$/.test(tag))) fail(number, 'Invalid tags.');
      pendingTags.push(...tags);
      continue;
    }
    const header = /^(Feature|Background|Scenario Outline|Scenario|Examples):\s*(.*)$/.exec(line);
    if (header) {
      const [, kind, name] = header;
      table = undefined; lastExpected = false;
      if (kind === 'Feature') {
        if (feature || !name) fail(number, 'Exactly one named Feature is required.');
        feature = name; featureTags = pendingTags; pendingTags = [];
      } else if (!feature) fail(number, 'Feature must appear first.');
      else if (kind === 'Background') {
        if (scenarios.length || inBackground || pendingTags.length) fail(number, 'One untagged Background must precede scenarios.');
        inBackground = true; current = undefined;
      } else if (kind === 'Examples') {
        if (!current?.outline || pendingTags.length) fail(number, 'Examples require a Scenario Outline; Examples tags are unsupported.');
        table = []; current!.examples.push(table); inBackground = false;
      } else {
        if (!name) fail(number, 'Scenario needs a name.');
        current = { name, outline: kind === 'Scenario Outline', steps: [], tags: [...featureTags, ...pendingTags], examples: [], metadata };
        if (metadata && current.outline) fail(number, 'WFM metadata requires a concrete Scenario.');
        scenarios.push(current); pendingTags = []; metadata = undefined; inBackground = false;
        if (scenarios.length > MAX_TESTS) fail(number, `Feature exceeds ${MAX_TESTS} scenarios.`);
      }
      continue;
    }
    if (line.startsWith('|')) {
      if (!table || !line.endsWith('|')) fail(number, 'Only Examples tables are supported; step data tables are unsupported.');
      if (/\\/.test(line)) fail(number, 'Escaped Examples cells are unsupported.');
      table!.push(line.slice(1, -1).split('|').map(cell => cell.trim()));
      continue;
    }
    const step = /^(Given|When|Then|And|But|\*)\s+(.+)$/.exec(line);
    if (step) {
      if ((!current && !inBackground) || table || pendingTags.length) fail(number, 'Step must belong to Background or Scenario.');
      const expected: boolean = step[1] === 'Then' || (['And', 'But', '*'].includes(step[1]) && lastExpected);
      (inBackground ? background : current!.steps).push({ keyword: step[1], text: step[2], expected });
      if ((inBackground ? background : current!.steps).length > 10000) fail(number, 'Too many steps (maximum 10000 per section).');
      lastExpected = expected;
      continue;
    }
    fail(number, 'Unsupported syntax. Descriptions, Rule, doc strings and step data tables are not supported.');
  }
  if (!feature || !scenarios.length || pendingTags.length || metadata) throw new GherkinError('A Feature with at least one Scenario is required; dangling tags or metadata are invalid.');
  const tests: Record<string, unknown>[] = [], names = new Set<string>();
  let totalSteps = 0;
  for (const scenario of scenarios) {
    if (!scenario.steps.length) throw new GherkinError(`Scenario ${scenario.name} has no steps.`);
    let rows: Record<string, string>[] = [{}];
    if (scenario.outline) {
      rows = [];
      for (const example of scenario.examples) {
        const [keys, ...values] = example;
        if (!keys?.length || keys.some(key => !key) || new Set(keys).size !== keys.length || !values.length) throw new GherkinError('Examples need distinct nonempty headers and at least one row.');
        for (const valuesRow of values) {
          if (valuesRow.length !== keys.length) throw new GherkinError('Examples row has the wrong number of cells.');
          rows.push(Object.fromEntries(keys.map((key, index) => [key, valuesRow[index]])));
          if (rows.length > MAX_TESTS) throw new GherkinError(`Feature exceeds ${MAX_TESTS} expanded scenarios.`);
        }
      }
      if (!rows.length) throw new GherkinError('Scenario Outline requires Examples rows.');
    }
    for (const [index, row] of rows.entries()) {
      const substitute = (value: string) => scenario.outline ? value.replace(/<([^>]+)>/g, (_, key: string) => {
        if (!Object.hasOwn(row, key)) throw new GherkinError(`Missing Examples parameter <${key}>.`);
        return row[key];
      }) : value;
      const name = `${feature} / ${substitute(scenario.name)}${scenario.outline ? ` [${index + 1}]` : ''}`;
      const steps = [...background, ...scenario.steps].map(step => ({ ...step, text: substitute(step.text) }));
      totalSteps += steps.length;
      if (totalSteps > 100000) throw new GherkinError('Feature exceeds 100000 expanded steps.');
      let test: Record<string, unknown>;
      if (scenario.metadata) {
        if (background.length || scenario.name !== clean(scenario.metadata.name) || JSON.stringify(steps.map(s => `${s.keyword} ${s.text}`)) !== JSON.stringify(readableSteps(scenario.metadata))) throw new GherkinError('Scenario differs from WFM metadata. Remove the metadata comment to import edited prose as manual steps.');
        test = scenario.metadata;
      } else {
        test = { name, url: '', featureArea: feature, scenario: substitute(scenario.name), sequence: toSequence(steps.map(step => ({ action: `${step.keyword} ${step.text}`, expected: step.expected ? step.text : '' }))).map((step, i) => ({ ...step, gherkin: { keyword: steps[i].keyword, tags: scenario.tags } })) };
      }
      if (names.has(String(test.name))) throw new GherkinError(`Duplicate scenario name: ${String(test.name)}.`);
      names.add(String(test.name)); tests.push(test);
      if (tests.length > MAX_TESTS) throw new GherkinError(`Feature exceeds ${MAX_TESTS} expanded scenarios.`);
    }
  }
  return { project: feature, tests, apiTests: [] };
}

function readableSteps(test: Record<string, unknown>): string[] {
  const sequence = test.sequence;
  if (!Array.isArray(sequence) || !sequence.length) throw new GherkinError(`Test ${String(test.name)} needs a nonempty step array to export.`);
  return sequence.flatMap((step: any) => {
    if (!step || typeof step !== 'object' || !step.action) throw new GherkinError(`Test ${String(test.name)} has invalid steps.`);
    if (step.action.id === 'manualStep') {
      const value = clean(step.value);
      if (!value) throw new GherkinError(`Test ${String(test.name)} has an empty manual step.`);
      const expected = clean(step.expected);
      return [ /^(Given|When|Then|And|But|\*)\s+/.test(value) ? value : `When ${value}`, ...(expected && !value.endsWith(` ${expected}`) ? [`Then ${expected}`] : []) ];
    }
    return `When ${clean(step.action.name || step.action.id)}${step.value == null || step.value === '' ? '' : `: ${clean(step.value)}`}`;
  });
}

/** Metadata carries original actions/fields; the prose alone is not executable Cucumber glue. */
export function exportGherkin(input: { project: string | null; tests: Record<string, unknown>[] }): { content: string; fileName: string } {
  const lines = ['# WebFlowMaster metadata restores web tests; prose alone imports as manual steps.', `Feature: ${clean(input.project) || 'WebFlowMaster tests'}`, ''];
  if (!input.tests.length) throw new GherkinError('No web tests to export. Gherkin does not include API tests.');
  for (const test of input.tests) {
    lines.push(`  # wfm-test: ${JSON.stringify(test)}`, `  Scenario: ${clean(test.name)}`, ...readableSteps(test).map(step => `    ${step}`), '');
  }
  return { content: lines.join('\n'), fileName: `${(input.project || 'tests').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.feature` };
}
