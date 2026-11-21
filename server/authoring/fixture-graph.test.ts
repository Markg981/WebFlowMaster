import { describe, expect, it } from 'vitest';
import {
  LibraryFixtureDefinitionSchema,
  type DataFixture,
  type DataFixtureRef,
  type LibraryFixtureDefinition,
} from '@shared/schema';
import {
  checkLibraryFixture,
  expandDataFixtures,
  FixtureGraphError,
  type FixtureLoader,
  type LoadedLibraryFixture,
} from './fixture-graph';

interface Entry {
  fixture: LoadedLibraryFixture;
  versions: Record<number, LibraryFixtureDefinition>;
}

function library(entries: Entry[]): FixtureLoader & { reads: number } {
  const loader = {
    reads: 0,
    async byId(id: number) {
      return entries.find((e) => e.fixture.id === id)?.fixture ?? null;
    },
    async byKey(projectId: number, key: string) {
      return (
        entries.find((e) => e.fixture.projectId === projectId && e.fixture.key === key)?.fixture ??
        null
      );
    },
    async definition(fixtureId: number, version: number) {
      loader.reads++;
      return entries.find((e) => e.fixture.id === fixtureId)?.versions[version] ?? null;
    },
  };
  return loader;
}

const def = (over: Partial<LibraryFixtureDefinition>): LibraryFixtureDefinition =>
  LibraryFixtureDefinitionSchema.parse({
    check: 'SELECT 1 AS one',
    apply: 'SELECT 1',
    ...over,
  });

const entry = (
  id: number,
  key: string,
  versions: Record<number, LibraryFixtureDefinition>,
  current = 1,
): Entry => ({
  fixture: { id, projectId: 7, key, name: `Fixture ${key}`, currentVersion: current },
  versions,
});

const ref = (over: Partial<DataFixtureRef>): DataFixtureRef => ({
  kind: 'ref',
  id: 'r1',
  alias: 'contract',
  fixtureId: 2,
  version: 'latest',
  params: {},
  ...over,
});

const customer = entry(1, 'customer', {
  1: def({
    params: [{ name: 'code', type: 'string', value: 'C-1' }],
    check: 'SELECT CustomerId AS customerId FROM Customer WHERE Code = {{params.code}}',
    apply: 'INSERT INTO Customer (Code) VALUES ({{params.code}})',
    outputs: ['customerId'],
  }),
});
const contract = entry(
  2,
  'customer-with-contract',
  {
    1: def({ check: 'SELECT 1 AS old' }),
    2: def({
      params: [
        { name: 'customerCode', type: 'string', value: 'WFM-{{run.tag}}' },
        { name: 'type', type: 'string', value: 'STD' },
      ],
      dependsOn: [
        { fixture: 'customer', as: 'customer', params: { code: '{{params.customerCode}}' } },
      ],
      check:
        'SELECT ContractId AS contractId FROM Contract WHERE CustomerId = {{fx.customer.customerId}} AND Type = {{params.type}}',
      apply:
        'INSERT INTO Contract (CustomerId, Type) VALUES ({{ fx.customer.customerId }}, {{params.type}})',
      outputs: ['contractId'],
    }),
  },
  2,
);

describe('teardown in the expansion', () => {
  const withTeardown = entry(5, 'tidy', {
    1: def({
      params: [{ name: 'code', type: 'string', value: 'T-1' }],
      check: 'SELECT Id AS id FROM T WHERE Code = {{params.code}}',
      apply: 'INSERT INTO T (Code) VALUES ({{params.code}})',
      teardown: 'DELETE FROM T WHERE Id = {{fx.self.id}} AND Code = {{params.code}}',
      outputs: ['id'],
    }),
  });
  it('carries the teardown with the alias renamed, and the policy of the entry that asked', async () => {
    const nodes = (await expandDataFixtures(
      [ref({ alias: 'top', fixtureId: 5, teardownPolicy: 'onSuccess' })],
      7,
      library([withTeardown]),
    ))!;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].teardown).toBe('DELETE FROM T WHERE Id = {{fx.top.id}} AND Code = {{params.code}}');
    expect(nodes[0].teardownPolicy).toBe('onSuccess');
  });
  it('refuses a teardown with a generator, an undeclared parameter, or a later alias', () => {
    const parse = (teardown: string) =>
      LibraryFixtureDefinitionSchema.safeParse({
        check: 'SELECT 1 AS one',
        apply: 'SELECT 1',
        teardown,
      });
    expect(parse('DELETE FROM t WHERE c = {{$uuid}}').success).toBe(false);
    expect(parse('DELETE FROM t WHERE c = {{params.nope}}').success).toBe(false);
    expect(parse('DELETE FROM t WHERE c = {{fx.other.id}}').success).toBe(false);
    expect(parse('DELETE FROM t').success).toBe(true);
  });
});

describe('expandDataFixtures', () => {
  it('leaves a list without references as it is', async () => {
    const inline = [
      {
        id: 'a',
        name: 'A',
        alias: 'a',
        params: [],
        check: 'SELECT 1',
        apply: 'SELECT 1',
        outputs: [],
      },
    ];
    expect(await expandDataFixtures(inline as DataFixture[], 7, library([]))).toBe(inline);
    expect(await expandDataFixtures(null, 7, library([]))).toBeNull();
  });

  it('runs the dependencies first, with the values passed down and the SQL reading their alias', async () => {
    const nodes = (await expandDataFixtures(
      [ref({ params: { type: 'PREMIUM' } })],
      7,
      library([customer, contract]),
    ))!;
    expect(nodes.map((n) => n.alias)).toEqual(['contract__customer', 'contract']);
    const [dep, top] = nodes;
    expect(dep.params).toEqual([{ name: 'code', type: 'string', value: 'WFM-{{run.tag}}' }]);
    expect(dep.source).toEqual({ fixtureId: 1, key: 'customer', version: 1 });
    expect(dep.id).toBe('r1/customer');
    expect(top.check).toContain('{{fx.contract__customer.customerId}}');
    expect(top.apply).toContain('{{ fx.contract__customer.customerId }}');
    expect(top.params.find((p) => p.name === 'type')?.value).toBe('PREMIUM');
    expect(top.source).toEqual({ fixtureId: 2, key: 'customer-with-contract', version: 2 });
  });

  it('runs a pinned version rather than the current one', async () => {
    const nodes = (await expandDataFixtures(
      [ref({ version: 1 })],
      7,
      library([customer, contract]),
    ))!;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].check).toBe('SELECT 1 AS old');
  });

  it('shares a dependency two fixtures need with the same values', async () => {
    const nodes = (await expandDataFixtures(
      [ref({}), ref({ id: 'r2', alias: 'second', params: { type: 'GOLD' } })],
      7,
      library([customer, contract]),
    ))!;
    expect(nodes.map((n) => n.alias)).toEqual(['contract__customer', 'contract', 'second']);
    expect(nodes[2].check).toContain('{{fx.contract__customer.customerId}}');
  });

  it('runs a dependency again when the values differ', async () => {
    const nodes = (await expandDataFixtures(
      [ref({}), ref({ id: 'r2', alias: 'other', params: { customerCode: 'X' } })],
      7,
      library([customer, contract]),
    ))!;
    expect(nodes.map((n) => n.alias)).toEqual([
      'contract__customer',
      'contract',
      'other__customer',
      'other',
    ]);
  });

  it('refuses a fixture of another project, an unknown parameter and a missing dependency', async () => {
    const elsewhere = { ...customer, fixture: { ...customer.fixture, id: 9, projectId: 8 } };
    await expect(
      expandDataFixtures([ref({ fixtureId: 9 })], 7, library([elsewhere])),
    ).rejects.toThrow(/not in this test's project/);
    await expect(
      expandDataFixtures([ref({ params: { nope: '1' } })], 7, library([customer, contract])),
    ).rejects.toThrow(/has no parameter "nope"/);
    await expect(expandDataFixtures([ref({})], 7, library([contract]))).rejects.toThrow(
      /needs "customer", which is not in the project's library/,
    );
    await expect(
      expandDataFixtures([ref({ version: 5 })], 7, library([customer, contract])),
    ).rejects.toThrow(/has no version 5/);
  });

  it('names the chain of a fixture that needs itself', async () => {
    const a = entry(1, 'a', { 1: def({ dependsOn: [{ fixture: 'b', as: 'b', params: {} }] }) });
    const b = entry(2, 'b', { 1: def({ dependsOn: [{ fixture: 'a', as: 'a', params: {} }] }) });
    const error = await expandDataFixtures([ref({ fixtureId: 1 })], 7, library([a, b])).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(FixtureGraphError);
    expect(error.message).toBe('the fixture "a" needs itself: a → b → a');
  });
});

describe('checkLibraryFixture', () => {
  it('refuses a new version that would close a cycle', async () => {
    const a = entry(1, 'a', { 1: def({}) });
    const b = entry(2, 'b', { 1: def({ dependsOn: [{ fixture: 'a', as: 'a', params: {} }] }) });
    await expect(
      checkLibraryFixture(
        a.fixture,
        def({ dependsOn: [{ fixture: 'b', as: 'b', params: {} }] }),
        library([a, b]),
      ),
    ).rejects.toThrow('the fixture "a" needs itself: a → b → a');
  });

  it('refuses a value passed from a parameter the fixture does not declare', async () => {
    await expect(
      checkLibraryFixture(
        contract.fixture,
        def({
          dependsOn: [
            { fixture: 'customer', as: 'customer', params: { code: '{{params.missing}}' } },
          ],
        }),
        library([customer, contract]),
      ),
    ).rejects.toThrow(/passes \{\{params.missing\}\} to "customer"/);
  });

  it('accepts a fixture whose dependencies resolve', async () => {
    await expect(
      checkLibraryFixture(contract.fixture, contract.versions[2], library([customer, contract])),
    ).resolves.toBeUndefined();
  });
});

describe('LibraryFixtureDefinitionSchema', () => {
  it('refuses SQL reading a fixture that is not a dependency', () => {
    const parsed = LibraryFixtureDefinitionSchema.safeParse({
      check: 'SELECT 1 WHERE x = {{fx.other.id}}',
      apply: 'SELECT 1',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toMatch(/not one of this fixture's dependencies/);
  });
});
