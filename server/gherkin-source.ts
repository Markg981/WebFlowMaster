import { AstBuilder, compile, dialects, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument, type Pickle, type Rule, type Scenario, type Step } from '@cucumber/messages';
import { bddTestSchema, BDD_MAX_SOURCE_BYTES, BDD_MAX_TESTS, BDD_MAX_STEPS, BDD_MAX_PERSISTED_BYTES, type BddTest } from '@shared/bdd';

export class GherkinError extends Error {}
export type ScenarioContext = { scenario: Scenario; rule?: Rule; steps: Step[]; rowLines: Map<string, number> };
export type CompiledGherkin = { document: GherkinDocument; pickles: readonly Pickle[]; contexts: Map<string, ScenarioContext>; steps: Map<string, Step>; source: string; uri: string };

/** Uses the complete official dialect catalogue; an unsupported directive is still Gherkin. */
export function autodetectGherkin(content: string): boolean {
  const source = content.replace(/^\uFEFF/, '');
  if (/^\s*#\s*language\s*:/m.test(source)) return true;
  const keywords = Object.values(dialects).flatMap(dialect => dialect.feature);
  return source.split(/\r?\n/).some(line => keywords.some(keyword => line.trimStart().startsWith(`${keyword}:`)));
}

/** Parse and bound expansion before allocating compiler-expanded pickles. No support code is loaded. */
export function compileGherkinSource(content: string, uri = 'import.feature', restoreMetadata = false): CompiledGherkin {
  if (Buffer.byteLength(content) > BDD_MAX_SOURCE_BYTES) throw new GherkinError('Feature file exceeds 20 MiB.');
  const source = content.replace(/^\uFEFF/, '');
  const newId = IdGenerator.incrementing();
  let document: GherkinDocument;
  try { document = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher()).parse(source); }
  catch (error: any) {
    const errors = error.errors ?? [error];
    throw new GherkinError(errors.map((item: any) => `${item.location ? `Line ${item.location.line}, column ${item.location.column}: ` : ''}${item.message}`).join('\n'));
  }
  const feature = document.feature;
  // Imports that restore metadata persist the original source, not this whole export.
  // Their actual total is checked after restoring each test in parseGherkin.
  const sourceBytes = restoreMetadata && document.comments.some(comment => /^\s*#\s*wfm-test:/.test(comment.text)) ? 0 : Buffer.byteLength(content);
  if (!feature?.name.trim()) throw new GherkinError('A named Feature with at least one Scenario is required.');
  const contexts = new Map<string, ScenarioContext>(), steps = new Map<string, Step>();
  let count = 0, stepCount = 0, argumentBytes = 0;
  const featureBackground = feature.children.find(child => child.background)?.background?.steps ?? [];
  const addScenario = (scenario: Scenario, rule?: Rule, ruleBackground: readonly Step[] = []) => {
    if (!scenario.name.trim() || !scenario.steps.length) throw new GherkinError(`Line ${scenario.location.line}: Scenario needs a name and at least one step.`);
    const inherited = [...featureBackground, ...ruleBackground, ...scenario.steps];
    const rowLines = new Map<string, number>();
    const outline = dialects[feature.language].scenarioOutline.some(keyword => keyword.trim() === scenario.keyword.trim());
    if (outline && !scenario.examples.length) throw new GherkinError(`Line ${scenario.location.line}: Scenario Outline requires Examples rows.`);
    for (const examples of scenario.examples) {
      const keys = examples.tableHeader?.cells.map(cell => cell.value) ?? [];
      if (!keys.length || keys.some(key => !key) || new Set(keys).size !== keys.length || !examples.tableBody.length) throw new GherkinError(`Line ${examples.location.line}: Examples need distinct nonempty headers and at least one row.`);
      for (const row of examples.tableBody) {
        if (row.cells.length !== keys.length) throw new GherkinError(`Line ${row.location.line}: Examples row has the wrong number of cells.`);
        rowLines.set(row.id, row.location.line);
        const projectedCount = count + rowLines.size;
        if (projectedCount > BDD_MAX_TESTS) throw new GherkinError(`Feature exceeds ${BDD_MAX_TESTS} expanded scenarios.`);
        if (stepCount + inherited.length * rowLines.size > BDD_MAX_STEPS) throw new GherkinError(`Feature exceeds ${BDD_MAX_STEPS} expanded steps.`);
        if (sourceBytes * projectedCount > BDD_MAX_PERSISTED_BYTES) throw new GherkinError('Feature exceeds 64 MiB of persisted source expansion.');
      }
      const values = [scenario.name, ...scenario.steps.flatMap(step => [step.text, step.docString?.content ?? '', step.docString?.mediaType ?? '', ...(step.dataTable?.rows.flatMap(row => row.cells.map(cell => cell.value)) ?? [])])];
      for (const value of values) for (const match of value.matchAll(/<([^>]+)>/g)) if (!keys.includes(match[1])) throw new GherkinError(`Line ${examples.location.line}: Missing Examples parameter <${match[1]}>.`);
      // Cucumber substitutes keys sequentially. Check each intermediate allocation before the
      // official compiler runs, including values containing another Examples placeholder.
      for (const row of examples.tableBody) for (const template of values) {
        let value = template;
        for (const [index, key] of keys.entries()) {
          const token = `<${key}>`, replacement = row.cells[index].value;
          let occurrences = 0, cursor = 0;
          while ((cursor = value.indexOf(token, cursor)) !== -1) { occurrences++; cursor += token.length; }
          const projected = Buffer.byteLength(value) + occurrences * (Buffer.byteLength(replacement) - Buffer.byteLength(token));
          if (projected + argumentBytes > BDD_MAX_PERSISTED_BYTES) throw new GherkinError('Feature exceeds 64 MiB of argument expansion.');
          if (occurrences) value = value.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), () => replacement);
        }
        argumentBytes += Buffer.byteLength(value);
      }
    }
    const expansion = scenario.examples.length ? rowLines.size : 1;
    count += expansion;
    stepCount += inherited.length * expansion;
    if (count > BDD_MAX_TESTS) throw new GherkinError(`Feature exceeds ${BDD_MAX_TESTS} expanded scenarios.`);
    if (stepCount > BDD_MAX_STEPS) throw new GherkinError(`Feature exceeds ${BDD_MAX_STEPS} expanded steps.`);
    if (sourceBytes * count > BDD_MAX_PERSISTED_BYTES) throw new GherkinError('Feature exceeds 64 MiB of persisted source expansion.');
    inherited.forEach(step => steps.set(step.id, step));
    contexts.set(scenario.id, { scenario, rule, steps: inherited, rowLines });
  };
  for (const child of feature.children) {
    if (child.scenario) addScenario(child.scenario);
    if (child.rule) {
      const background = child.rule.children.find(item => item.background)?.background?.steps ?? [];
      for (const item of child.rule.children) if (item.scenario) addScenario(item.scenario, child.rule, background);
    }
  }
  if (!count) throw new GherkinError('A Feature with at least one Scenario is required.');
  const pickles = compile(document, uri, newId);
  let bytes = sourceBytes * pickles.length;
  for (const pickle of pickles) {
    bytes += Buffer.byteLength(JSON.stringify(pickle));
    if (bytes > BDD_MAX_PERSISTED_BYTES) throw new GherkinError('Feature exceeds 64 MiB of persisted source and argument expansion.');
  }
  return { document, pickles, contexts, steps, source: content, uri };
}

export function contextOfPickle(compiled: CompiledGherkin, pickle: Pickle): ScenarioContext {
  const context = pickle.astNodeIds.map(id => compiled.contexts.get(id)).find(Boolean);
  if (!context) throw new GherkinError('Compiled scenario has no source location.');
  return context;
}

export function exampleLineOfPickle(context: ScenarioContext, pickle: Pickle): number | undefined {
  return pickle.astNodeIds.map(id => context.rowLines.get(id)).find(line => line !== undefined);
}

/** Return the schema-validated binding after proving it selects exactly one compiled scenario. */
export function validateBddTest(value: unknown): BddTest {
  const bdd = bddTestSchema.parse(value);
  const compiled = compileGherkinSource(bdd.source, bdd.uri);
  if (compiled.document.feature!.language !== bdd.language) throw new GherkinError('BDD language does not match the source dialect.');
  const selected = compiled.pickles.filter(pickle => {
    const context = contextOfPickle(compiled, pickle);
    return context.scenario.location.line === bdd.scenarioLine && exampleLineOfPickle(context, pickle) === bdd.exampleLine;
  });
  if (selected.length !== 1) throw new GherkinError('BDD selector must select exactly one scenario or Examples row.');
  return bdd;
}
