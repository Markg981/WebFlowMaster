import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { impactRules, reportTestCaseResults, tags, testPlanExecutions, testTags } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';
import type { TestReference } from './test-suites';

/**
 * Running the tests a change affects, not all of them.
 *
 * The organization keeps an impact map: rules from a file pattern to a tag — `src/checkout/**` to
 * `checkout`. A run asked for with the files a commit changed (the CLI's `--changed-since`) runs:
 *
 * - the tests carrying a tag a changed file maps to;
 * - the tests the map does not cover — none of their tags appears in any rule — because nothing
 *   says a change cannot break them;
 * - the tests that failed or errored in the plan's last finished run, so the run that should
 *   show a fix does.
 *
 * It errs towards running more. A changed file no rule matches could affect anything, so the
 * whole plan runs, and the run says which file decided it. A rule without a tag marks files that
 * affect no test (`docs/**`, `*.md`). With no rules at all, the whole plan runs.
 *
 * What was decided is kept on the run (the snapshot's `selection`) and written in its log, so a
 * test that did not run is a choice somebody can read, not a gap.
 */

export interface RunSelection {
  /** 'affected' when the run is narrowed to what the change affects; 'all' when it is not, and why. */
  mode: 'affected' | 'all';
  reason: string;
  changedFiles: number;
  /** The first of them, for the report. */
  files: string[];
  affectedTags: string[];
  /** Changed files no rule matches; any one of them means the whole plan runs. */
  unmappedFiles: string[];
  selected: number;
  total: number;
  previouslyFailed: number;
}

export const MAX_CHANGED_FILES = 5000;
const LISTED = 50;

/** A git-style glob as a regular expression: `**` any path, `*` and `?` within a segment, `{a,b}` either. */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (p.endsWith('/')) p += '**';
  // A pattern without a slash names a file anywhere, as in .gitignore.
  if (!p.includes('/')) p = `**/${p}`;
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        i++;
        if (p[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') out += '[^/]';
    else if (c === '{') {
      const end = p.indexOf('}', i);
      if (end === -1) out += '\\{';
      else {
        out += `(?:${p.slice(i + 1, end).split(',').map((part) => part.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
        i = end;
      }
    } else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function normalizePath(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Refused at save time: a pattern people cannot read back is a rule nobody can check. */
export function validatePattern(pattern: string): string | null {
  const p = pattern.trim();
  if (!p) return 'A pattern is required.';
  if (p.length > 300) return 'A pattern is at most 300 characters.';
  if (/[\n\r]/.test(p)) return 'A pattern is one line.';
  try {
    globToRegExp(p);
  } catch {
    return 'Not a pattern this installation can read.';
  }
  return null;
}

const refKey = (ref: TestReference) =>
  ref.testType === 'ui' ? `ui:${ref.testId}` : ref.testType === 'api' ? `api:${ref.apiTestId}` : `mobile:${ref.mobileTestId}`;

/** Narrows a run's tests to those the changed files affect. Returns them in plan order, with what was decided. */
export async function selectForChanges(
  tx: TenantTx,
  planId: string,
  refs: TestReference[],
  changedFiles: string[],
): Promise<{ refs: TestReference[]; selection: RunSelection }> {
  const files = [...new Set(changedFiles.map(normalizePath).filter(Boolean))];
  const base = { changedFiles: files.length, files: files.slice(0, LISTED), total: refs.length, previouslyFailed: 0 };
  const all = (reason: string, extra: Partial<RunSelection> = {}) => ({
    refs,
    selection: { mode: 'all' as const, reason, affectedTags: [], unmappedFiles: [], selected: refs.length, ...base, ...extra },
  });

  const rules = await tx
    .select({ pattern: impactRules.pattern, tagId: impactRules.tagId, tagName: tags.name })
    .from(impactRules)
    .leftJoin(tags, eq(tags.id, impactRules.tagId));
  if (rules.length === 0) return all('No impact map: every test runs. Map file patterns to tags in Settings → Impact map.');

  const compiled = rules.map((rule) => ({ ...rule, re: globToRegExp(rule.pattern) }));
  const affectedTagIds = new Set<string>();
  const affectedTags = new Set<string>();
  const unmapped: string[] = [];
  for (const file of files) {
    const hits = compiled.filter((rule) => rule.re.test(file));
    if (hits.length === 0) unmapped.push(file);
    for (const hit of hits) {
      if (hit.tagId) {
        affectedTagIds.add(hit.tagId);
        if (hit.tagName) affectedTags.add(hit.tagName);
      }
    }
  }
  if (unmapped.length > 0) {
    return all(
      `${unmapped.length} changed file(s) match no rule of the impact map, so any test could be affected: every test runs. First: ${unmapped[0]}.`,
      { unmappedFiles: unmapped.slice(0, LISTED), affectedTags: [...affectedTags].sort() },
    );
  }

  const mappedTagIds = new Set(rules.map((rule) => rule.tagId).filter((id): id is string => !!id));
  const uiIds = refs.filter((r) => r.testType === 'ui' && r.testId).map((r) => r.testId as number);
  const apiIds = refs.filter((r) => r.testType === 'api' && r.apiTestId).map((r) => r.apiTestId as number);
  const mobileIds = refs.filter((r) => r.testType === 'mobile' && r.mobileTestId).map((r) => r.mobileTestId as number);
  const byType = [
    uiIds.length ? inArray(testTags.testId, uiIds) : undefined,
    apiIds.length ? inArray(testTags.apiTestId, apiIds) : undefined,
    mobileIds.length ? inArray(testTags.mobileTestId, mobileIds) : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c);
  const tagRows = byType.length
    ? await tx
        .select({ tagId: testTags.tagId, testId: testTags.testId, apiTestId: testTags.apiTestId, mobileTestId: testTags.mobileTestId, testType: testTags.testType })
        .from(testTags)
        .where(or(...byType))
    : [];
  const tagsOf = new Map<string, string[]>();
  for (const row of tagRows) {
    const key = row.testType === 'ui' ? `ui:${row.testId}` : row.testType === 'api' ? `api:${row.apiTestId}` : `mobile:${row.mobileTestId}`;
    tagsOf.set(key, [...(tagsOf.get(key) ?? []), row.tagId]);
  }

  const failedLastTime = await failedInLastRun(tx, planId);
  const kept = refs.filter((ref) => {
    const key = refKey(ref);
    const own = tagsOf.get(key) ?? [];
    if (own.some((tag) => affectedTagIds.has(tag))) return true;
    if (!own.some((tag) => mappedTagIds.has(tag))) return true; // not covered by the map
    return failedLastTime.has(key);
  });
  const previouslyFailed = kept.filter((ref) => {
    const own = tagsOf.get(refKey(ref)) ?? [];
    return failedLastTime.has(refKey(ref)) && !own.some((tag) => affectedTagIds.has(tag)) && own.some((tag) => mappedTagIds.has(tag));
  }).length;
  const names = [...affectedTags].sort();
  return {
    refs: kept,
    selection: {
      mode: 'affected',
      reason:
        `${files.length} changed file(s)` +
        (names.length ? ` affect the tags ${names.join(', ')}` : ' affect no mapped tag') +
        `: ${kept.length} of ${refs.length} tests run (the affected ones, those the impact map does not cover` +
        `${previouslyFailed ? `, and ${previouslyFailed} that failed last time` : ''}).`,
      affectedTags: names,
      unmappedFiles: [],
      selected: kept.length,
      ...base,
      previouslyFailed,
    },
  };
}

/** The tests that failed or errored in the plan's most recent finished run. */
async function failedInLastRun(tx: TenantTx, planId: string): Promise<Set<string>> {
  const [last] = await tx
    .select({ id: testPlanExecutions.id })
    .from(testPlanExecutions)
    .where(and(eq(testPlanExecutions.testPlanId, planId), inArray(testPlanExecutions.status, ['completed', 'failed', 'error']), isNotNull(testPlanExecutions.completedAt)))
    .orderBy(desc(testPlanExecutions.completedAt))
    .limit(1);
  if (!last) return new Set();
  const rows = await tx
    .select({ uiTestId: reportTestCaseResults.uiTestId, apiTestId: reportTestCaseResults.apiTestId, mobileTestId: reportTestCaseResults.mobileTestId, testType: reportTestCaseResults.testType })
    .from(reportTestCaseResults)
    .where(and(eq(reportTestCaseResults.testPlanExecutionId, last.id), inArray(reportTestCaseResults.status, ['Failed', 'Error'])));
  return new Set(rows.map((r) => (r.testType === 'ui' ? `ui:${r.uiTestId}` : r.testType === 'api' ? `api:${r.apiTestId}` : `mobile:${r.mobileTestId}`)));
}
