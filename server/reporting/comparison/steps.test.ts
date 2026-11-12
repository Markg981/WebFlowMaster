import { describe, it, expect } from 'vitest';
import { pairSteps, stepsOfLog } from './steps';

const log = (steps: unknown[]) => JSON.stringify(steps);

describe('stepsOfLog', () => {
  it('keys steps by id and occurrence, so a group called twice pairs call by call', () => {
    const steps = stepsOfLog(
      log([
        { name: 'a', stepId: 's1', status: 'passed' },
        { name: 'g1', stepId: 'g', calledFrom: 'call', status: 'passed' },
        { name: 'g2', stepId: 'g', calledFrom: 'call', status: 'failed' },
        { name: 'no id', status: 'passed' },
      ]),
    );
    expect(steps.map((s) => s.key)).toEqual(['/s1@0', 'call/g@0', 'call/g@1', '#3@0']);
    expect(steps[2].status).toBe('failed');
  });

  it('keeps a step checkpoint and screenshot, and reads nothing from a log that is not a list', () => {
    const [step] = stepsOfLog(
      log([
        {
          name: 'c',
          status: 'passed',
          screenshot: 'x.png',
          checkpoint: { name: 'total', kind: 'text', data: { texts: ['1'] }, hash: 'h' },
        },
      ]),
    );
    expect(step.checkpoint?.name).toBe('total');
    expect(step.screenshot).toBe('x.png');
    expect(stepsOfLog('not json')).toEqual([]);
    expect(stepsOfLog(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(stepsOfLog(null)).toEqual([]);
  });
});

describe('pairSteps', () => {
  it('pairs by key and keeps the steps of either side that have no partner', () => {
    const left = stepsOfLog(log([{ stepId: 'a' }, { stepId: 'b' }]));
    const right = stepsOfLog(log([{ stepId: 'a' }, { stepId: 'c' }]));
    const pairs = pairSteps(left, right);
    expect(pairs.map((p) => [p.baseline?.stepId ?? null, p.candidate?.stepId ?? null])).toEqual([
      ['a', 'a'],
      ['b', null],
      [null, 'c'],
    ]);
  });
});
