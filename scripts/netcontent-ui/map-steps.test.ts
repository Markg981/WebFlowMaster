import { describe, it, expect } from 'vitest';
import { splitSteps, mapSteps, mapStep } from './map-steps';
import type { UiElement } from './parse-views';

const el = (over: Partial<UiElement>): UiElement => ({
  tag: 'button',
  role: 'button',
  action: 'click',
  selector: '[name="x"]',
  label: '',
  ...over,
});

const inventory: UiElement[] = [
  el({ role: 'button', action: 'click', label: 'Open Sample Monitoring', selector: '[name="btnSampleMonitoring"]', name: 'btnSampleMonitoring' }),
  el({ role: 'input', action: 'input', label: 'samples', selector: '[ng-model="data.samples"]', ngModel: 'data.samples' }),
  el({ role: 'button', action: 'click', label: 'Save', selector: '[name="btnSave"]', name: 'btnSave', ngClick: 'save()' }),
];

describe('splitSteps', () => {
  it('splits a numbered list into clean steps', () => {
    expect(splitSteps('1. Open the Sample monitoring modal\n2. Enter samples\n3. Click Save')).toEqual([
      'Open the Sample monitoring modal',
      'Enter samples',
      'Click Save',
    ]);
  });
  it('splits inline numbering too', () => {
    expect(splitSteps('1. Open X 2. Click Save')).toEqual(['Open X', 'Click Save']);
  });
});

describe('mapStep / mapSteps', () => {
  it('maps a click step to the best-matching element', () => {
    const m = mapStep('Click Save', inventory);
    expect(m.action).toBe('click');
    expect(m.selector).toBe('[name="btnSave"]');
  });

  it('maps an input step and extracts the value', () => {
    const m = mapStep('Enter 5 in the samples field', inventory);
    expect(m.action).toBe('input');
    expect(m.selector).toBe('[ng-model="data.samples"]');
    expect(m.value).toBe('5');
  });

  it('maps a verify step to a containsText assertion', () => {
    const m = mapStep('Verify the status shows "Passed"', inventory);
    expect(m.action).toBe('assertion');
    expect(m.assertType).toBe('containsText');
    expect(m.value).toBe('Passed');
  });

  it('flags an unmatched step for manual review', () => {
    const m = mapStep('Click the Frobnicate widget', inventory);
    expect(m.action).toBe('click');
    expect(m.selector).toBeUndefined();
    expect(m.note).toMatch(/unmatched/);
  });

  it('maps the full TC_0481 sequence', () => {
    const steps = mapSteps('1. Open the Sample monitoring modal\n2. Enter in the required amount of samples\n3. Click Save', inventory);
    expect(steps).toHaveLength(3);
    expect(steps[0].selector).toBe('[name="btnSampleMonitoring"]');
    expect(steps[2].selector).toBe('[name="btnSave"]');
  });
});
