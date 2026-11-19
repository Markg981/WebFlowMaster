import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { DataFixture } from '@shared/schema';
import { DataFixturesPanel, fixtureProblems } from './DataFixturesPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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

function Harness({ initial, seen }: { initial: DataFixture[]; seen: (f: DataFixture[]) => void }) {
  const [fixtures, setFixtures] = useState(initial);
  return (
    <DataFixturesPanel
      fixtures={fixtures}
      onChange={(next) => {
        seen(next);
        setFixtures(next);
      }}
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
