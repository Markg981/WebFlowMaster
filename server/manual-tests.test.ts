import { describe, it, expect } from 'vitest';
import { manualSequenceProblem, toSequence } from '@shared/manual-tests';

describe('manualSequenceProblem', () => {
  it('accepts a manual test whose steps all say what to do', () => {
    expect(manualSequenceProblem(toSequence([{ action: 'Print the invoice', expected: 'Logo and total' }]))).toBeNull();
  });

  it('refuses a manual test whose steps are blank (collaudo LIB-13)', () => {
    expect(manualSequenceProblem(toSequence([{ action: '  ', expected: '' }]))).toMatch(/needs its action/);
    expect(
      manualSequenceProblem(toSequence([{ action: 'Open it', expected: '' }, { action: '', expected: 'Shown' }])),
    ).toMatch(/needs its action/);
  });

  it('leaves tests that are not manual alone', () => {
    expect(manualSequenceProblem([])).toBeNull();
    expect(manualSequenceProblem([{ id: '1', action: { id: 'click' }, value: '' }])).toBeNull();
    expect(manualSequenceProblem(undefined)).toBeNull();
  });
});
