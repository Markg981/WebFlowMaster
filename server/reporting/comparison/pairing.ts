import { canonicalCoordinates, type UnitCoordinates } from '@shared/execution-identity';

/** The columns of a stored result that pairing reads. */
export interface PairableResult {
  testType: string;
  uiTestId: number | null;
  apiTestId: number | null;
  mobileTestId: number | null;
  browser: string | null;
  executionUnitId: string | null;
}

export interface ResultPair<R> {
  key: string;
  baseline: R | null;
  candidate: R | null;
}

/**
 * What a result is the same test as on the other side.
 *
 * A result of a unit is keyed by the unit's coordinates — test, occurrence, browser, locale,
 * device and dataset row — and not by its unit id, which includes the run's own id. A result
 * without a unit (recorded before the manifest) falls back to test and browser.
 */
export function baseKeyOf(
  result: PairableResult,
  coordinates: UnitCoordinates | undefined,
): string {
  if (coordinates) return `unit:${canonicalCoordinates(coordinates)}`;
  const testId = result.uiTestId ?? result.apiTestId ?? result.mobileTestId ?? null;
  return `test:${result.testType}:${testId ?? '-'}:${result.browser ?? '-'}`;
}

function keyed<R extends PairableResult>(
  results: R[],
  coordinatesOf: (unitId: string) => UnitCoordinates | undefined,
): Map<string, R> {
  const seen = new Map<string, number>();
  const out = new Map<string, R>();
  for (const result of results) {
    const base = baseKeyOf(
      result,
      result.executionUnitId ? coordinatesOf(result.executionUnitId) : undefined,
    );
    // Two results with one key (only possible without a manifest) pair in the order they came.
    const repeat = seen.get(base) ?? 0;
    seen.set(base, repeat + 1);
    out.set(repeat ? `${base}#${repeat}` : base, result);
  }
  return out;
}

/**
 * Pairs the results of two runs. Each run keeps at most one result per unit, the one of its
 * deciding attempt, so pairing is by key alone. A result with no partner pairs with null and
 * becomes `not_comparable`.
 */
export function pairResults<R extends PairableResult>(
  baseline: R[],
  candidate: R[],
  baselineCoordinates: (unitId: string) => UnitCoordinates | undefined,
  candidateCoordinates: (unitId: string) => UnitCoordinates | undefined,
): ResultPair<R>[] {
  const left = keyed(baseline, baselineCoordinates);
  const right = keyed(candidate, candidateCoordinates);
  const pairs: ResultPair<R>[] = [];
  for (const [key, result] of left)
    pairs.push({ key, baseline: result, candidate: right.get(key) ?? null });
  for (const [key, result] of right)
    if (!left.has(key)) pairs.push({ key, baseline: null, candidate: result });
  return pairs;
}
