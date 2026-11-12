import { describe, it, expect } from 'vitest';
import type { UnitCoordinates } from '@shared/execution-identity';
import { pairResults, type PairableResult } from './pairing';

const result = (overrides: Partial<PairableResult & { id: string }>) => ({
  id: 'r',
  testType: 'ui',
  uiTestId: 1,
  apiTestId: null,
  mobileTestId: null,
  browser: 'chromium',
  executionUnitId: null,
  ...overrides,
});

const coords = (bddRow: number | null): UnitCoordinates => ({
  testType: 'ui',
  testId: 1,
  occurrence: 0,
  browser: { name: 'chromium', channel: null, device: null },
  locale: null,
  device: null,
  bddRow,
});

describe('pairResults', () => {
  it('pairs units by their coordinates, not by unit ids that differ per run', () => {
    const baseline = [
      result({ id: 'b0', executionUnitId: 'u_base_row0' }),
      result({ id: 'b1', executionUnitId: 'u_base_row1' }),
    ];
    const candidate = [
      result({ id: 'c1', executionUnitId: 'u_cand_row1' }),
      result({ id: 'c0', executionUnitId: 'u_cand_row0' }),
    ];
    const units = new Map([
      ['u_base_row0', coords(0)],
      ['u_base_row1', coords(1)],
      ['u_cand_row0', coords(0)],
      ['u_cand_row1', coords(1)],
    ]);
    const pairs = pairResults(
      baseline,
      candidate,
      (u) => units.get(u),
      (u) => units.get(u),
    );
    expect(pairs.map((p) => [p.baseline?.id, p.candidate?.id])).toEqual([
      ['b0', 'c0'],
      ['b1', 'c1'],
    ]);
  });

  it('falls back to test and browser without a manifest, and leaves an unpaired side null', () => {
    const none = () => undefined;
    const pairs = pairResults(
      [result({ id: 'b-chromium' }), result({ id: 'b-firefox', browser: 'firefox' })],
      [
        result({ id: 'c-chromium' }),
        result({ id: 'c-api', testType: 'api', uiTestId: null, apiTestId: 9 }),
      ],
      none,
      none,
    );
    expect(pairs.map((p) => [p.baseline?.id ?? null, p.candidate?.id ?? null])).toEqual([
      ['b-chromium', 'c-chromium'],
      ['b-firefox', null],
      [null, 'c-api'],
    ]);
  });

  it('pairs two results with one legacy key in the order they came', () => {
    const none = () => undefined;
    const pairs = pairResults(
      [result({ id: 'b1' }), result({ id: 'b2' })],
      [result({ id: 'c1' }), result({ id: 'c2' })],
      none,
      none,
    );
    expect(pairs.map((p) => [p.baseline?.id, p.candidate?.id])).toEqual([
      ['b1', 'c1'],
      ['b2', 'c2'],
    ]);
  });
});
