/**
 * Accessibility checks, as a step records them and the report reads them.
 *
 * A test drove the application through a flow and said nothing about whether someone using a
 * screen reader or a keyboard could have done the same. Accessibility was a separate audit, run
 * once before a release by somebody else, against pages the tests had already stopped visiting.
 * `assertAccessible` checks the page where the test is, at the point in the flow the author chose:
 * behind the login, with the dialog open, after the grid has loaded. It uses axe-core, the engine
 * most accessibility tooling is built on, so its findings match what an auditor would see.
 */

/** axe-core's impact levels, least to most severe. */
export const ACCESSIBILITY_IMPACTS = ['minor', 'moderate', 'serious', 'critical'] as const;
export type AccessibilityImpact = (typeof ACCESSIBILITY_IMPACTS)[number];

/**
 * Where a step fails when its value is left empty.
 *
 * Serious and critical are the violations that stop someone from using the page at all (no
 * accessible name on a button, a form field nobody can label). Failing on "minor" by default
 * would make the first run of the check on an existing application red for things nobody will
 * fix this week, and a check that is always red is one that gets deleted.
 */
export const DEFAULT_ACCESSIBILITY_THRESHOLD: AccessibilityImpact = 'serious';

/** At most this many offending elements are kept per rule: enough to find them, not a page dump. */
export const MAX_TARGETS_PER_RULE = 5;

export interface AccessibilityViolation {
  /** The axe rule, e.g. "image-alt". */
  id: string;
  impact: AccessibilityImpact | null;
  /** One line on what is wrong, from axe. */
  help: string;
  /** axe's page on the rule: what it means and how to fix it. */
  helpUrl: string;
  /** WCAG criteria and other tags axe files the rule under, e.g. "wcag2a", "wcag111". */
  tags: string[];
  /** How many elements break it. */
  count: number;
  /** Selectors for the first few of them. */
  targets: string[];
  /** Whether this violation is at or above the step's threshold, i.e. one that failed it. */
  blocking: boolean;
}

export interface AccessibilityFinding {
  url: string;
  threshold: AccessibilityImpact;
  violations: AccessibilityViolation[];
  /** Violations at or above the threshold. */
  blocking: number;
  /** Rules axe checked that the page passed. */
  passes: number;
  /** Rules axe could not decide without a person, e.g. contrast over a background image. */
  incomplete: number;
}

export function isAccessibilityImpact(value: unknown): value is AccessibilityImpact {
  return typeof value === 'string' && (ACCESSIBILITY_IMPACTS as readonly string[]).includes(value);
}

const rank = (impact: AccessibilityImpact | null) => (impact ? ACCESSIBILITY_IMPACTS.indexOf(impact) : -1);

/** The raw result of axe.run, as far as this reads it. */
export interface AxeRunResult {
  url?: string;
  violations: Array<{
    id: string;
    impact?: string | null;
    help: string;
    helpUrl: string;
    tags?: string[];
    nodes: Array<{ target: unknown }>;
  }>;
  passes?: unknown[];
  incomplete?: unknown[];
}

/**
 * What a step keeps of an axe run: every violation, marked blocking or not, most severe first.
 *
 * A violation with no impact (axe leaves it null for some rules) is never blocking: failing a
 * build on a level axe itself did not assign would be failing it on a guess.
 */
export function summariseAxe(result: AxeRunResult, threshold: AccessibilityImpact, url?: string): AccessibilityFinding {
  const violations = result.violations
    .map((violation): AccessibilityViolation => {
      const impact = isAccessibilityImpact(violation.impact) ? violation.impact : null;
      return {
        id: violation.id,
        impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        tags: violation.tags ?? [],
        count: violation.nodes.length,
        targets: violation.nodes.slice(0, MAX_TARGETS_PER_RULE).map((node) => targetText(node.target)),
        blocking: impact !== null && rank(impact) >= rank(threshold),
      };
    })
    .sort((a, b) => rank(b.impact) - rank(a.impact) || b.count - a.count);
  return {
    url: url ?? result.url ?? '',
    threshold,
    violations,
    blocking: violations.filter((v) => v.blocking).length,
    passes: result.passes?.length ?? 0,
    incomplete: result.incomplete?.length ?? 0,
  };
}

/** axe gives a target as a list of selectors, one per frame or shadow root it crosses. */
function targetText(target: unknown): string {
  if (Array.isArray(target)) return target.map((part) => (Array.isArray(part) ? part.join(' ') : String(part))).join(' >> ');
  return String(target);
}

/** The sentence a step reports: what failed it, or that nothing did. */
export function describeFinding(finding: AccessibilityFinding): string {
  const atOrAbove = finding.threshold === 'critical' ? 'critical' : `${finding.threshold} or worse`;
  if (finding.blocking > 0) {
    const worst = finding.violations
      .filter((v) => v.blocking)
      .slice(0, 3)
      .map((v) => `${v.id} (${v.impact}, ${v.count} element${v.count === 1 ? '' : 's'})`)
      .join(', ');
    return `${finding.blocking} accessibility violation${finding.blocking === 1 ? '' : 's'} ${atOrAbove}: ${worst}` +
      (finding.blocking > 3 ? `, and ${finding.blocking - 3} more` : '') + '.';
  }
  const below = finding.violations.length;
  return `No accessibility violations ${atOrAbove}` + (below > 0 ? ` (${below} below the threshold).` : '.');
}
