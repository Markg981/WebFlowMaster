/**
 * What makes a selector survive until tomorrow.
 *
 * Two pieces of code build selectors for the same application: element detection, which
 * runs inside `frame.evaluate`, and the recorder script, which is injected into the page as
 * a string. Neither can import the other at runtime — Playwright serialises the first, and
 * the second is deliberately plain browser JS — so what they share is this data, and each
 * builds its own regexes from it.
 *
 * They had already drifted. Detection rejected framework-generated ids; the recorder took
 * any unique id it found, and preferred it over `data-testid`. Recording a path through an
 * Angular Material application therefore produced steps anchored on `#cdk-overlay-0`,
 * `#mat-input-0` and `#mat-tab-content-4-2` — ids the framework hands out in the order
 * things happen to render, so the same walk through the same application produces different
 * ones, and the recorded test cannot be replayed even once.
 */

/**
 * Ids a framework generated rather than a developer chose.
 *
 * Angular Material stamps `mat-input-3`, `mat-tab-label-0-2` and `cdk-overlay-18` in render
 * order, so they shift as soon as anything above the element changes, or as soon as an
 * overlay opens a different number of times. Radix and React's `useId` produce `:r1a:`.
 * Bundlers and CSS-in-JS produce long hex.
 *
 * Held as pattern strings rather than RegExp objects because both consumers receive them
 * across a boundary that only carries data: detection as an argument to `frame.evaluate`,
 * the recorder as JSON interpolated into its script. Each side calls `new RegExp` on them —
 * no `eval`, so a page with a strict Content-Security-Policy is unaffected.
 */
export const VOLATILE_ID_PATTERNS: readonly string[] = [
  // A framework prefix followed by a number anywhere after it: mat-input-0, cdk-overlay-18,
  // mat-tab-content-4-2.
  '^(mat|mdc|cdk|ng|dx|p|ui|kendo)[-_].*\\d+$',
  // React useId / Radix: ":r1a:"
  '^:[a-z0-9]+:$',
  // A bare hash, from a bundler or CSS-in-JS.
  '^[0-9a-f]{12,}$',
  // Anything that is mostly a long number, whatever the prefix.
  '^[a-z-]*\\d{4,}$',
];

/** The predicate, for Node-side callers and tests. The browser sides rebuild it from the patterns. */
export function isVolatileId(id: string): boolean {
  return VOLATILE_ID_PATTERNS.some((pattern) => new RegExp(pattern, 'i').test(id));
}
