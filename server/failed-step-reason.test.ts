import { describe, expect, it } from 'vitest';
import { failedStepReason } from './failed-step-reason';

describe('failedStepReason', () => {
  const steps = [
    { status: 'passed', details: 'Navigated' },
    { status: 'failed', error: 'Timeout 5000ms exceeded waiting for button.btn-vecchia' },
    { status: 'skipped' },
  ];

  it('gives a failed test the error of its first failed step', () => {
    expect(failedStepReason('failed', steps)).toBe('Timeout 5000ms exceeded waiting for button.btn-vecchia');
  });

  it('falls back to the step details when the step has no error field', () => {
    expect(failedStepReason('error', [{ status: 'error', details: 'Browser closed' }])).toBe('Browser closed');
  });

  it('gives nothing to a passed test, or without steps', () => {
    expect(failedStepReason('passed', steps)).toBeUndefined();
    expect(failedStepReason('failed', undefined)).toBeUndefined();
    expect(failedStepReason('failed', [{ status: 'failed', error: '   ' }])).toBeUndefined();
  });
});
