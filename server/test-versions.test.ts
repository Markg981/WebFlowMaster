import { describe, it, expect } from 'vitest';
import { describeChange, signatureOf, snapshotOf, stepCountOf } from './test-versions';

/**
 * What changed between two versions of a test.
 *
 * The summary is what somebody scanning a history decides on, so the two failures that matter
 * are a change reported as nothing and a non-change reported as a rewrite. Re-recording the
 * same flow produces twelve new step ids and must not read as twelve removals; reordering the
 * same steps changes what the test does and must not read as silence.
 */

const step = (action: string, selector: string, value?: string) => ({
  id: `step-${Math.random()}`,
  action: { id: action, type: action, name: `a.${action}`, icon: 'x', description: 'd' },
  targetElement: { id: 'e', type: 'button', selector, tag: 'button', attributes: {} },
  ...(value === undefined ? {} : { value }),
});

const snapshot = (sequence: unknown[], overrides: Record<string, unknown> = {}) =>
  snapshotOf({ name: 'Checkout', url: 'https://shop.test', sequence, elements: [], ...overrides });

describe('signatureOf', () => {
  it('is about what a step does, not which id it happens to carry', () => {
    expect(signatureOf(step('click', '#save'))).toBe(signatureOf(step('click', '#save')));
  });

  it('prefers the repository element, so healing a selector is not a changed step', () => {
    const before = { action: { id: 'click' }, targetElement: { elementId: 'el-1', selector: '#save' } };
    const after = { action: { id: 'click' }, targetElement: { elementId: 'el-1', selector: '#save-v2' } };

    expect(signatureOf(before)).toBe(signatureOf(after));
  });
});

describe('describeChange', () => {
  it('says what a first version is', () => {
    expect(describeChange(null, snapshot([step('click', '#a'), step('click', '#b')]))).toBe('Created with 2 steps.');
    expect(describeChange(null, snapshot([step('click', '#a')]))).toBe('Created with 1 step.');
  });

  it('says nothing at all when nothing changed', () => {
    // Which is what stops a save that saved nothing from manufacturing a version.
    const before = snapshot([step('click', '#a'), step('input', '#user', 'mario')]);
    const after = snapshot([step('click', '#a'), step('input', '#user', 'mario')]);

    expect(describeChange(before, after)).toBe('');
  });

  it('does not read a re-recording of the same flow as a rewrite', () => {
    // Every step id is new here. A history that says "12 removed, 12 added" every time somebody
    // re-records is a history nobody reads.
    const before = snapshot([step('click', '#a'), step('click', '#b'), step('click', '#c')]);
    const after = snapshot([step('click', '#a'), step('click', '#b'), step('click', '#c')]);

    expect(describeChange(before, after)).toBe('');
  });

  it('counts what was added and what was taken away', () => {
    const before = snapshot([step('click', '#a'), step('click', '#b')]);
    const after = snapshot([step('click', '#a'), step('click', '#c'), step('assert', '#d')]);

    expect(describeChange(before, after)).toBe('2 steps added, 1 step removed.');
  });

  it('notices the same steps in a different order', () => {
    const before = snapshot([step('click', '#a'), step('click', '#b')]);
    const after = snapshot([step('click', '#b'), step('click', '#a')]);

    expect(describeChange(before, after)).toBe('Steps reordered.');
  });

  it('notices a changed value, because the step now does something else', () => {
    const before = snapshot([step('input', '#user', 'mario')]);
    const after = snapshot([step('input', '#user', 'luigi')]);

    expect(describeChange(before, after)).toBe('1 step added, 1 step removed.');
  });

  it('mentions the things around the steps', () => {
    const before = snapshot([step('click', '#a')], { name: 'Old name', dataset: [{ user: 'a' }] });
    const after = snapshot([step('click', '#a')], {
      name: 'Checkout',
      url: 'https://other.test',
      dataset: [{ user: 'a' }, { user: 'b' }],
    });

    const summary = describeChange(before, after);

    expect(summary).toContain('Renamed from "Old name"');
    expect(summary).toContain('starting URL changed');
    expect(summary).toContain('dataset 1 → 2 rows');
  });

  it('reads a sequence stored as text, which is how jsonb sometimes comes back', () => {
    const before = snapshot(JSON.stringify([step('click', '#a')]) as unknown as unknown[]);
    const after = snapshot([step('click', '#a')]);

    expect(describeChange(before, after)).toBe('');
  });
});

describe('stepCountOf', () => {
  it('counts a sequence without trusting its shape', () => {
    expect(stepCountOf([step('click', '#a')])).toBe(1);
    expect(stepCountOf(null)).toBe(0);
    expect(stepCountOf('not json')).toBe(0);
  });
});
