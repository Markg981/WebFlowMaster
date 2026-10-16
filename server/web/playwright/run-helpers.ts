import { Page } from 'playwright';

import type { StepResult } from './types';

/**
 * A screenshot taken as evidence, or nothing.
 *
 * Chromium sometimes cannot capture one ("Unable to capture screenshot") — right after a
 * navigation, or on a runner under load — and that used to throw out of the step and fail it,
 * so a step that did exactly what it was asked was reported as broken because its picture was
 * missing. The picture is evidence of the step, not part of it: it is tried again once the page
 * has settled, and when it still cannot be had the step keeps its own result and says so in
 * the log.
 */
export async function evidenceScreenshot(
  page: Page,
  onMissing: (reason: string) => void = () => {},
): Promise<Buffer | undefined> {
  try {
    return await page.screenshot({ type: 'png' });
  } catch (first: any) {
    if (page.isClosed()) {
      onMissing(first?.message ?? String(first));
      return undefined;
    }
    await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => {});
    try {
      return await page.screenshot({ type: 'png' });
    } catch (second: any) {
      onMissing(second?.message ?? String(second));
      return undefined;
    }
  }
}

/**
 * Where a selector should be looked up: the page, or a chain of iframes within it.
 *
 * page.locator() does not cross an iframe boundary, so an element inside one needs both
 * halves — which frame, and where in it. The chain is ' >> ' separated and outermost first,
 * which is how frameChainFor writes it.
 */
export function scopeFor(page: Page, frameSelector?: string | null) {
  if (!frameSelector) return page;
  return frameSelector
    .split(' >> ')
    .filter(Boolean)
    .reduce<any>((scope, step) => scope.frameLocator(step), page);
}

/**
 * The rows a test runs over, or null when it runs once.
 *
 * An empty array counts as none: it is a dataset someone started and did not fill in, and
 * running zero times while reporting success would be a green result for a test that never
 * executed. Values are coerced to strings because that is what `{{variable}}` substitution
 * puts into a URL or a form field.
 */
export function datasetRows(test: { dataset?: unknown }): Array<Record<string, string>> | null {
  const raw = (test as { dataset?: unknown }).dataset;
  const parsed = typeof raw === 'string' ? safeParseJson(raw) : raw;
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  return parsed
    .filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === 'object' && !Array.isArray(row),
    )
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : String(value ?? ''),
        ]),
      ),
    );
}

/** One row's own result, as `once` returned it, with where it sits in the dataset. */
export interface DatasetRowRun<T> {
  /** The row's index, from 0: its evidence directory is `row_<index>` (shared/execution-identity.ts). */
  index: number;
  label: string;
  result: T;
}

/** What a run over a dataset produced: each row's own result, and the merged view of all of them. */
export interface DatasetRun<T> {
  /** Every row passed. */
  success: boolean;
  /** Every row's steps, in row order, each named after its row. */
  steps: StepResult[];
  /** The first row's error that had one, named after its row: what used to be lost in the merge. */
  error?: string;
  rows: Array<DatasetRowRun<T>>;
}

/**
 * Runs `once` for each row, labelling and merging the results — and keeping each row's own, so
 * its evidence and its error stay with it rather than being folded into one list of steps.
 *
 * Shared by the saved-test path and the builder preview so the two cannot disagree about how
 * many times a test runs — which is precisely how the two step executors drifted.
 */
export async function runOverDataset<
  T extends { success: boolean; steps?: StepResult[]; error?: string },
>(
  rows: Array<Record<string, string>>,
  once: (row: Record<string, string>, index: number) => Promise<T>,
): Promise<DatasetRun<T>> {
  const allSteps: StepResult[] = [];
  const runs: Array<DatasetRowRun<T>> = [];
  let allPassed = true;
  let error: string | undefined;

  for (const [index, row] of rows.entries()) {
    const label = `Row ${index + 1} of ${rows.length}`;
    const result = await once(row, index);
    runs.push({ index, label, result });

    // Prefixed, because "assertion failed" repeated twenty times says nothing about which
    // input broke it — and finding that out by rerunning the set by hand is the cost this
    // feature exists to remove.
    for (const step of result.steps ?? []) {
      allSteps.push({ ...step, name: `${label} — ${step.name}` });
    }
    if (!result.success) allPassed = false;
    if (result.error && error === undefined) error = `${label}: ${result.error}`;
    // Deliberately no early exit: stopping at the first bad row would hide whatever else is
    // broken, and the next run would find it one row at a time.
  }

  return { success: allPassed, steps: allSteps, ...(error ? { error } : {}), rows: runs };
}

export function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
