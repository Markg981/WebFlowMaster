import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { DataFixture, DataFixtureRef, TestDataFixture } from '@shared/schema';
import { aliasFor, DataFixturesPanel, fixtureProblems } from './DataFixturesPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/use-projects', () => ({
  useProjects: () => ({ data: [{ id: 7, name: 'Shop' }] }),
}));
vi.mock('@/hooks/use-data-fixture-library', async (actual) => ({
  ...(await actual<typeof import('@/hooks/use-data-fixture-library')>()),
  useFixtureLibrary: (projectId: number | null) => ({
    isLoading: false,
    data: projectId === 7 ? library : [],
  }),
}));

const library = [
  {
    id: 1,
    projectId: 7,
    key: 'customer',
    name: 'A customer',
    description: null,
    tags: [],
    currentVersion: 3,
    updatedAt: '2026-11-19T00:00:00Z',
    definition: {
      params: [{ name: 'code', type: 'string', value: 'C-1' }],
      check: 'SELECT id FROM customers WHERE code = {{params.code}}',
      apply: 'SELECT 1',
      outputs: ['id'],
      dependsOn: [],
    },
  },
];

/**
 * The data fixtures editor: it builds what the server accepts, and shows what the server would
 * refuse (a value inside quotes, an undeclared parameter) before the test is saved.
 */

const valid: DataFixture = {
  id: 'fx-1',
  name: 'Customer',
  alias: 'customer',
  connection: null,
  params: [{ name: 'email', type: 'string', value: '{{$randomEmail}}' }],
  check: 'SELECT id FROM customers WHERE email = {{params.email}}',
  apply: 'INSERT INTO customers (email) VALUES ({{params.email}})',
  outputs: ['id'],
  timeoutMs: null,
};

function Harness({
  initial,
  seen,
  projectId,
}: {
  initial: TestDataFixture[];
  seen: (f: TestDataFixture[]) => void;
  projectId?: number;
}) {
  const [fixtures, setFixtures] = useState(initial);
  return (
    <DataFixturesPanel
      fixtures={fixtures}
      onChange={(next) => {
        seen(next);
        setFixtures(next);
      }}
      library={projectId ? { projectId, onProjectChange: vi.fn() } : undefined}
    />
  );
}

describe('fixtureProblems', () => {
  it('finds nothing wrong with a valid fixture', () => {
    expect(fixtureProblems([valid]).size).toBe(0);
  });
  it('reports a value in quotes and an undeclared parameter, under the fixture', () => {
    const problems = fixtureProblems([
      { ...valid, check: "SELECT id FROM customers WHERE email = '{{params.email}}'" },
      { ...valid, id: 'fx-2', alias: 'other', apply: 'INSERT INTO t VALUES ({{params.nope}})' },
    ]);
    expect(problems.get(0)?.join(' ')).toMatch(/quote/i);
    expect(problems.get(1)?.join(' ')).toMatch(/params\.nope/);
  });
});

describe('DataFixturesPanel', () => {
  it('adds a fixture, edits its script and lists its outputs', () => {
    const seen = vi.fn();
    render(<Harness initial={[]} seen={seen} />);
    fireEvent.click(screen.getByRole('button', { name: /dataFixtures.add/ }));
    fireEvent.change(screen.getByLabelText('dataFixtures.check'), {
      target: { value: 'SELECT id FROM t' },
    });
    fireEvent.change(screen.getByLabelText('dataFixtures.outputs'), {
      target: { value: 'id, code' },
    });
    const last = seen.mock.calls.at(-1)![0] as DataFixture[];
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ check: 'SELECT id FROM t', outputs: ['id', 'code'] });
  });

  it('keeps the teardown script, and offers a policy only once there is a script', () => {
    const seen = vi.fn();
    render(<Harness initial={[valid]} seen={seen} />);
    expect(screen.queryByLabelText('dataFixtures.teardownPolicy')).toBeNull();
    fireEvent.change(screen.getByLabelText('dataFixtures.teardown'), {
      target: { value: 'DELETE FROM customers WHERE id = {{fx.customer.id}}' },
    });
    const last = seen.mock.calls.at(-1)![0] as DataFixture[];
    expect(last[0].teardown).toBe('DELETE FROM customers WHERE id = {{fx.customer.id}}');
    expect(screen.getByLabelText('dataFixtures.teardownPolicy')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('dataFixtures.teardown'), { target: { value: '' } });
    expect(screen.queryByLabelText('dataFixtures.teardownPolicy')).toBeNull();
  });

  it('shows what the server would refuse', () => {
    render(
      <Harness
        initial={[{ ...valid, apply: 'INSERT INTO t VALUES ({{params.nope}})' }]}
        seen={vi.fn()}
      />,
    );
    expect(screen.getByText(/does not declare/)).toBeInTheDocument();
  });
});

describe('a library reference', () => {
  const ref: DataFixtureRef = {
    kind: 'ref',
    id: 'r1',
    alias: 'customer',
    fixtureId: 1,
    version: 'latest',
    params: {},
  };

  it('is accepted beside written fixtures, with its own alias', () => {
    expect(fixtureProblems([valid, { ...ref, alias: 'buyer' }]).size).toBe(0);
    expect(fixtureProblems([valid, ref]).get(1)?.join(' ')).toMatch(/alias "customer"/);
  });

  it('keeps only the values the test changes', () => {
    const seen = vi.fn();
    render(<Harness initial={[ref]} seen={seen} projectId={7} />);
    expect(screen.getByText(/A customer/)).toBeInTheDocument();
    const value = screen.getByLabelText('dataFixtures.library.valueFor');
    expect(value).toHaveAttribute('placeholder', 'C-1');
    fireEvent.change(value, { target: { value: 'VIP-1' } });
    expect((seen.mock.calls.at(-1)![0] as DataFixtureRef[])[0].params).toEqual({ code: 'VIP-1' });
    fireEvent.change(value, { target: { value: '' } });
    expect((seen.mock.calls.at(-1)![0] as DataFixtureRef[])[0].params).toEqual({});
  });

  it('takes an alias from the key that is not already used', () => {
    expect(aliasFor('customer-order', [])).toBe('customer_order');
    expect(aliasFor('customer', ['customer', 'customer_2'])).toBe('customer_3');
    expect(aliasFor('9lives', [])).toBe('fx_9lives');
  });
});
