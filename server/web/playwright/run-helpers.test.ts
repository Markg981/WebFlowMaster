import { describe, expect, it } from 'vitest';
import { runOverDataset } from './run-helpers';
import type { StepResult } from './types';

/**
 * A dataset run used to come back as one list of steps and one boolean: each row's error, video
 * and trace were dropped in the merge (P08). Each row's own result now comes back beside it.
 */
describe('runOverDataset', () => {
  const step = (name: string, status: 'passed' | 'failed'): StepResult =>
    ({ name, type: 'click', status }) as StepResult;

  it('keeps each row’s own result, and still merges the steps and the verdict', async () => {
    const outcomes = [
      { success: true, steps: [step('Pay', 'passed')], evidence: { tracePath: 'row_0/t.zip' } },
      { success: false, steps: [step('Pay', 'failed')], error: 'Sold out', evidence: {} },
      { success: true, steps: [step('Pay', 'passed')], evidence: { tracePath: 'row_2/t.zip' } },
    ];
    const run = await runOverDataset([{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }], async (_r, i) =>
      structuredClone(outcomes[i]),
    );

    expect(run.success).toBe(false);
    expect(run.steps.map((s) => s.name)).toEqual([
      'Row 1 of 3 — Pay',
      'Row 2 of 3 — Pay',
      'Row 3 of 3 — Pay',
    ]);
    expect(run.error).toBe('Row 2 of 3: Sold out');
    expect(run.rows.map((r) => [r.index, r.result.evidence.tracePath])).toEqual([
      [0, 'row_0/t.zip'],
      [1, undefined],
      [2, 'row_2/t.zip'],
    ]);
    // A row's own steps are its own, not renamed after the merge.
    expect(run.rows[1].result.steps[0].name).toBe('Pay');
  });

  it('runs every row even after one fails', async () => {
    const seen: number[] = [];
    await runOverDataset([{}, {}, {}], async (_row, index) => {
      seen.push(index);
      return { success: index !== 0 };
    });
    expect(seen).toEqual([0, 1, 2]);
  });
});
