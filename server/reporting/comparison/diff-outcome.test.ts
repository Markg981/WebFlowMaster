import { describe, it, expect } from 'vitest';
import { diffOutcome } from './diff-outcome';
import { stepsOfLog } from './steps';

const steps = (list: Array<[string, 'passed' | 'failed']>) =>
  stepsOfLog(JSON.stringify(list.map(([stepId, status]) => ({ stepId, status }))));

describe('diffOutcome', () => {
  it('reports nothing when every step ended alike', () => {
    expect(diffOutcome(steps([['a', 'passed']]), steps([['a', 'passed']]))).toEqual([]);
  });

  it('reports a step that passed on one side and failed on the other, and one run on one side only', () => {
    const differences = diffOutcome(
      steps([
        ['a', 'passed'],
        ['b', 'passed'],
      ]),
      steps([['a', 'failed']]),
    );
    expect(differences).toEqual([
      expect.objectContaining({
        stepId: 'a',
        kind: 'outcome',
        baseline: 'passed',
        candidate: 'failed',
        severity: 'blocking',
      }),
      expect.objectContaining({ stepId: 'b', stepIndex: 1, baseline: 'passed', candidate: null }),
    ]);
  });

  it('keeps a step run inside an if branch on one side only informative, a failure there blocking', () => {
    const branch = (inner: 'passed' | 'failed') =>
      stepsOfLog(
        JSON.stringify([
          { stepId: 'if', type: 'if', status: 'passed' },
          { stepId: 'wait', type: 'wait', status: inner },
          { stepId: 'end', type: 'endIf', status: 'passed' },
          { stepId: 'after', type: 'click', status: 'passed' },
        ]),
      );
    const skipped = stepsOfLog(
      JSON.stringify([
        { stepId: 'if', type: 'if', status: 'passed' },
        { stepId: 'after', type: 'click', status: 'passed' },
      ]),
    );
    expect(diffOutcome(branch('passed'), skipped).map((d) => [d.stepId, d.severity])).toEqual([
      ['wait', 'informative'],
      ['end', 'informative'],
    ]);
    expect(diffOutcome(branch('failed'), skipped)[0]).toMatchObject({
      stepId: 'wait',
      severity: 'blocking',
    });
  });
});
