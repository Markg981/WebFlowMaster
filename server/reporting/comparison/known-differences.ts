import type { ComparisonDifference, DifferenceKind } from '@shared/comparison';
import { pathPatternMatcher } from '@shared/patterns';

/** A recorded known difference, as the engine needs it (a `comparison_known_differences` row). */
export interface KnownDifferenceRule {
  id: string;
  projectId: number | null;
  uiTestId: number | null;
  checkpointName: string | null;
  kind: DifferenceKind;
  pathPattern: string | null;
  expiresAt: Date | null;
}

/** Where a compared test lives, which a rule's scope is set against. */
export interface KnownDifferenceScope {
  projectId: number | null;
  uiTestId: number | null;
}

/**
 * Marks each difference a rule covers with the rule's id: same kind, a scope that contains the
 * test (no project or the test's project, no test or this test), the same checkpoint or none, a
 * path the pattern matches, and not expired. The first matching rule wins. Unmatched differences
 * come back as they were.
 */
export function markKnownDifferences(
  rules: readonly KnownDifferenceRule[],
  now: Date = new Date(),
): (differences: ComparisonDifference[], scope: KnownDifferenceScope) => ComparisonDifference[] {
  const live = rules
    .filter((rule) => rule.expiresAt === null || rule.expiresAt.getTime() > now.getTime())
    .map((rule) => ({ rule, path: pathPatternMatcher(rule.pathPattern) }));
  return (differences, scope) => {
    if (live.length === 0) return differences;
    const inScope = live.filter(
      ({ rule }) =>
        (rule.projectId === null || rule.projectId === scope.projectId) &&
        (rule.uiTestId === null || rule.uiTestId === scope.uiTestId),
    );
    return differences.map((difference) => {
      const match = inScope.find(
        ({ rule, path }) =>
          rule.kind === difference.kind &&
          (rule.checkpointName === null || rule.checkpointName === difference.checkpoint) &&
          path(difference.path),
      );
      return match ? { ...difference, knownDifferenceId: match.rule.id } : difference;
    });
  };
}
