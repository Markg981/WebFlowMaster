/**
 * The data fixture library, expanded (docs/superpowers/specs/2026-11-19-data-fixtures-design.md).
 *
 * A test names library fixtures (DataFixtureRefSchema); the runner only knows plain fixtures
 * (server/runtime/data-setup/fixture-runner.ts). When a run is queued, every reference becomes
 * the plain fixtures it stands for, so the run executes what the library held at that moment:
 *
 *   - its dependencies first, depth first, in the order the fixture declares them;
 *   - each with its parameters bound: the defaults, replaced by what the test (or the fixture
 *     that depends on it) passes, where `{{params.x}}` of the caller is written in as text;
 *   - a dependency already expanded with the same version and the same values is run once and
 *     shared, so two fixtures needing the same customer get the same customer;
 *   - a fixture that needs itself, through any chain, is refused by name (also when it is saved).
 *
 * A dependency's outputs are {{fx.<as>.<column>}} in the SQL of the fixture that declares it.
 * Expanded, the dependency runs under a unique alias (`<caller>__<as>`), and the caller's SQL is
 * rewritten to read that alias: the values stay bound parameters, only their names change.
 */

import { and, eq } from 'drizzle-orm';
import {
  dataFixtureLibrary,
  dataFixtureVersions,
  isDataFixtureRef,
  LibraryFixtureDefinitionSchema,
  type DataFixture,
  type LibraryFixtureDefinition,
  type TestDataFixture,
} from '@shared/schema';
import { withTenantTransaction, type TenantTx } from '../platform/middleware/tenancy';

/** How deep dependencies may go, and how many fixtures one test may expand to. */
export const FIXTURE_GRAPH_MAX_DEPTH = 8;
export const FIXTURE_GRAPH_MAX_NODES = 60;

export class FixtureGraphError extends Error {}

export interface LoadedLibraryFixture {
  id: number;
  projectId: number;
  key: string;
  name: string;
  currentVersion: number;
}

export interface FixtureLoader {
  byId(id: number): Promise<LoadedLibraryFixture | null>;
  byKey(projectId: number, key: string): Promise<LoadedLibraryFixture | null>;
  definition(fixtureId: number, version: number): Promise<LibraryFixtureDefinition | null>;
}

const FX_NAME = /\{\{(\s*)fx\.(\w+)\./g;
const PARAM_NAME = /\{\{\s*params\.(\w+)\s*\}\}/g;

/** The SQL (or a value) with every {{fx.<old>.…}} read from the alias it was expanded under. */
function renameFixtureReads(text: string, aliases: Map<string, string>): string {
  return text.replace(FX_NAME, (whole, space: string, alias: string) => {
    const renamed = aliases.get(alias);
    return renamed ? `{{${space}fx.${renamed}.` : whole;
  });
}

interface Expansion {
  nodes: DataFixture[];
  /** `<fixture id>@<version>:<values>` → the alias the node runs under. */
  shared: Map<string, string>;
}

interface Override {
  fixtureId: number;
  definition: LibraryFixtureDefinition;
}

async function expandNode(
  load: FixtureLoader,
  out: Expansion,
  fixture: LoadedLibraryFixture,
  version: number,
  passed: Record<string, string>,
  place: { id: string; alias: string; top: boolean },
  chain: LoadedLibraryFixture[],
  override?: Override,
): Promise<string> {
  if (chain.some((f) => f.id === fixture.id))
    throw new FixtureGraphError(
      `the fixture "${fixture.key}" needs itself: ${[...chain, fixture].map((f) => f.key).join(' → ')}`,
    );
  if (chain.length >= FIXTURE_GRAPH_MAX_DEPTH)
    throw new FixtureGraphError(
      `the dependencies go deeper than ${FIXTURE_GRAPH_MAX_DEPTH} levels: ${[...chain, fixture].map((f) => f.key).join(' → ')}`,
    );
  const definition =
    override && override.fixtureId === fixture.id
      ? override.definition
      : await load.definition(fixture.id, version);
  if (!definition)
    throw new FixtureGraphError(`the fixture "${fixture.key}" has no version ${version}`);

  for (const name of Object.keys(passed))
    if (!definition.params.some((p) => p.name === name))
      throw new FixtureGraphError(
        `the fixture "${fixture.key}" has no parameter "${name}" (it has ${definition.params.map((p) => p.name).join(', ') || 'none'})`,
      );
  const params = definition.params.map((p) => ({ ...p, value: passed[p.name] ?? p.value }));
  const valueOf = new Map(params.map((p) => [p.name, p.value]));

  const sharedKey = `${fixture.id}@${version}:${JSON.stringify(params.map((p) => [p.name, p.value]))}`;
  if (!place.top) {
    const existing = out.shared.get(sharedKey);
    if (existing) return existing;
  }

  // Dependencies first. Their aliases, as this fixture's SQL names them → as they will run.
  const aliases = new Map<string, string>();
  for (const dependency of definition.dependsOn) {
    const target = await load.byKey(fixture.projectId, dependency.fixture);
    if (!target)
      throw new FixtureGraphError(
        `the fixture "${fixture.key}" needs "${dependency.fixture}", which is not in the project's library`,
      );
    const values: Record<string, string> = {};
    for (const [name, raw] of Object.entries(dependency.params)) {
      let unknown: string | null = null;
      const text = raw.replace(PARAM_NAME, (_whole, param: string) => {
        if (!valueOf.has(param)) unknown ??= param;
        return valueOf.get(param) ?? '';
      });
      if (unknown)
        throw new FixtureGraphError(
          `the fixture "${fixture.key}" passes {{params.${unknown}}} to "${dependency.fixture}", but declares no such parameter`,
        );
      values[name] = renameFixtureReads(text, aliases);
    }
    const ran = await expandNode(
      load,
      out,
      target,
      target.currentVersion,
      values,
      {
        id: `${place.id}/${dependency.as}`.slice(0, 100),
        alias: `${place.alias}__${dependency.as}`,
        top: false,
      },
      [...chain, fixture],
      override,
    );
    aliases.set(dependency.as, ran);
  }

  if (out.nodes.length >= FIXTURE_GRAPH_MAX_NODES)
    throw new FixtureGraphError(
      `the test's fixtures expand to more than ${FIXTURE_GRAPH_MAX_NODES} with their dependencies`,
    );
  out.nodes.push({
    id: place.id,
    name: fixture.name,
    alias: place.alias,
    connection: definition.connection ?? null,
    params: params.map((p) => ({ ...p, value: renameFixtureReads(p.value, aliases) })),
    check: renameFixtureReads(definition.check, aliases),
    apply: renameFixtureReads(definition.apply, aliases),
    outputs: definition.outputs,
    timeoutMs: definition.timeoutMs ?? null,
    source: { fixtureId: fixture.id, key: fixture.key, version },
  });
  if (!out.shared.has(sharedKey)) out.shared.set(sharedKey, place.alias);
  return place.alias;
}

/**
 * A test's fixtures as the runner takes them: plain ones as written, references expanded with
 * their dependencies. `projectId` is the test's: a test uses its own project's library only.
 */
export async function expandDataFixtures(
  fixtures: readonly TestDataFixture[] | null | undefined,
  projectId: number | null | undefined,
  load: FixtureLoader,
): Promise<DataFixture[] | null> {
  if (!fixtures) return null;
  if (!fixtures.some(isDataFixtureRef)) return fixtures as DataFixture[];
  const out: Expansion = { nodes: [], shared: new Map() };
  for (const entry of fixtures) {
    if (!isDataFixtureRef(entry)) {
      out.nodes.push(entry);
      continue;
    }
    const fixture = await load.byId(entry.fixtureId);
    if (!fixture || (projectId != null && fixture.projectId !== projectId))
      throw new FixtureGraphError(
        `the data fixture "${entry.alias}" names a library fixture (${entry.fixtureId}) that is not in this test's project`,
      );
    if (projectId == null)
      throw new FixtureGraphError(
        `the data fixture "${entry.alias}" comes from a library, and the test belongs to no project`,
      );
    const version = entry.version === 'latest' ? fixture.currentVersion : entry.version;
    await expandNode(
      load,
      out,
      fixture,
      version,
      entry.params,
      { id: entry.id, alias: entry.alias, top: true },
      [],
    );
  }
  return out.nodes;
}

/**
 * Before a library fixture is saved: its dependencies exist, its values reach them, and nothing
 * it needs needs it back. `definition` is the version about to be written.
 */
export async function checkLibraryFixture(
  fixture: LoadedLibraryFixture,
  definition: LibraryFixtureDefinition,
  load: FixtureLoader,
): Promise<void> {
  const out: Expansion = { nodes: [], shared: new Map() };
  await expandNode(
    load,
    out,
    fixture,
    fixture.currentVersion,
    {},
    { id: fixture.key, alias: 'self', top: true },
    [],
    {
      fixtureId: fixture.id,
      definition,
    },
  );
}

/** The library as the tenant transaction sees it, each row read once. */
export function libraryLoader(tx: TenantTx): FixtureLoader {
  const byId = new Map<number, Promise<LoadedLibraryFixture | null>>();
  const byKey = new Map<string, Promise<LoadedLibraryFixture | null>>();
  const definitions = new Map<string, Promise<LibraryFixtureDefinition | null>>();
  const columns = {
    id: dataFixtureLibrary.id,
    projectId: dataFixtureLibrary.projectId,
    key: dataFixtureLibrary.key,
    name: dataFixtureLibrary.name,
    currentVersion: dataFixtureLibrary.currentVersion,
  };
  return {
    byId(id) {
      if (!byId.has(id))
        byId.set(
          id,
          tx
            .select(columns)
            .from(dataFixtureLibrary)
            .where(eq(dataFixtureLibrary.id, id))
            .limit(1)
            .then((rows) => rows[0] ?? null),
        );
      return byId.get(id)!;
    },
    byKey(projectId, key) {
      const k = `${projectId}:${key}`;
      if (!byKey.has(k))
        byKey.set(
          k,
          tx
            .select(columns)
            .from(dataFixtureLibrary)
            .where(
              and(eq(dataFixtureLibrary.projectId, projectId), eq(dataFixtureLibrary.key, key)),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null),
        );
      return byKey.get(k)!;
    },
    definition(fixtureId, version) {
      const k = `${fixtureId}@${version}`;
      if (!definitions.has(k))
        definitions.set(
          k,
          tx
            .select({ definition: dataFixtureVersions.definition })
            .from(dataFixtureVersions)
            .where(
              and(
                eq(dataFixtureVersions.fixtureId, fixtureId),
                eq(dataFixtureVersions.version, version),
              ),
            )
            .limit(1)
            .then((rows) => {
              if (!rows[0]) return null;
              // Read through the schema, so a version written before a default was added gets it.
              const parsed = LibraryFixtureDefinitionSchema.safeParse(rows[0].definition);
              if (!parsed.success)
                throw new FixtureGraphError(
                  `the version ${version} of a library fixture (${fixtureId}) cannot be read: ${parsed.error.issues[0]?.message}`,
                );
              return parsed.data;
            }),
        );
      return definitions.get(k)!;
    },
  };
}

/** The library fixtures a set of tests names, for the "used by" list and the delete check. */
export function referencedFixtureIds(fixtures: unknown): number[] {
  if (!Array.isArray(fixtures)) return [];
  return fixtures.filter(isDataFixtureRef).map((f) => f.fixtureId);
}

/**
 * At enqueue: a test's fixtures with every library reference expanded, as the run will execute
 * them. A reference that cannot be expanded (the fixture was deleted, a version is missing) is
 * left as it is, so the run fails that test by name when it reaches it instead of refusing the
 * whole plan here.
 */
export async function freezeDataFixtures(
  tx: TenantTx,
  fixtures: unknown,
  projectId: number | null | undefined,
): Promise<unknown> {
  if (!Array.isArray(fixtures) || !fixtures.some(isDataFixtureRef)) return fixtures ?? null;
  try {
    return await expandDataFixtures(fixtures as TestDataFixture[], projectId, libraryLoader(tx));
  } catch (error) {
    if (error instanceof FixtureGraphError) return fixtures;
    throw error;
  }
}

/** For the runner (FixtureRunOptions.expand): the library as it is now, in the test's project. */
export function expandFromLibrary(projectId: number | null | undefined) {
  return (fixtures: TestDataFixture[]): Promise<DataFixture[]> =>
    withTenantTransaction(
      async (tx) => (await expandDataFixtures(fixtures, projectId, libraryLoader(tx))) ?? [],
    );
}
