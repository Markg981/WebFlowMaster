import { describe, it, expect } from 'vitest';
import { comparisonPolicyOf } from '@shared/comparison';
import { diffText } from './diff-text';
import { stepsOfLog } from './steps';

const withCheckpoints = (...checkpoints: Array<[string, string[], string?]>) =>
  stepsOfLog(
    JSON.stringify(
      checkpoints.map(([name, texts, hash], i) => ({
        stepId: `s${i}`,
        status: 'passed',
        checkpoint: { name, kind: 'text', data: { texts }, hash: hash ?? texts.join('|') },
      })),
    ),
  );

const policy = comparisonPolicyOf({});

describe('diffText', () => {
  it('finds no difference between equal captures, nor between texts equal under the policy', () => {
    expect(
      diffText(withCheckpoints(['total', ['10']]), withCheckpoints(['total', ['10']]), policy),
    ).toEqual([]);
    expect(
      diffText(
        withCheckpoints(['total', ['1.234,5']]),
        withCheckpoints(['total', ['1,234.5']]),
        policy,
      ),
    ).toEqual([]);
  });

  it('reports each differing text by its position, and a change in how many there are', () => {
    const differences = diffText(
      withCheckpoints(['rows', ['a', 'b']]),
      withCheckpoints(['rows', ['a', 'B', 'c']]),
      policy,
    );
    expect(differences.map((d) => [d.path, d.baseline, d.candidate])).toEqual([
      ['texts.length', 2, 3],
      ['texts[1]', 'b', 'B'],
      ['texts[2]', null, 'c'],
    ]);
    expect(differences.every((d) => d.checkpoint === 'rows' && d.severity === 'blocking')).toBe(
      true,
    );
  });

  it('reports a checkpoint captured on one side only', () => {
    const differences = diffText(
      withCheckpoints(['x', ['1']]),
      withCheckpoints(['y', ['2']]),
      policy,
    );
    expect(differences.map((d) => [d.checkpoint, d.baseline, d.candidate])).toEqual([
      ['x', ['1'], null],
      ['y', null, ['2']],
    ]);
  });
});
