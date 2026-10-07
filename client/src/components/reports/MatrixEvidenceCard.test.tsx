import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { matrixEvidence } from '@shared/matrix-evidence';
import MatrixEvidenceCard from './MatrixEvidenceCard';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('matrix evidence report', () => {
  it('shows a substitution independently of the functional result, escaped', () => {
    const e = matrixEvidence({
      route: 'appium',
      source: 'capabilities',
      requested: { device: 'Pixel 8' },
      effective: { device: '<script>Pixel 9</script>' },
    });
    const { container } = render(
      <MatrixEvidenceCard
        rows={[
          {
            id: 'r',
            testName: 'Passed test',
            detailedLog: JSON.stringify({ mobile: true, steps: [], matrixEvidence: e }),
          },
        ]}
      />,
    );
    expect(screen.getByText('matrixEvidence.mismatch')).toBeVisible();
    expect(container.textContent).toContain('Pixel 8');
    expect(container.textContent).toContain('<script>Pixel 9</script>');
    expect(container.querySelector('script')).toBeNull();
  });
  it('does not certify legacy results', () => {
    const { container } = render(
      <MatrixEvidenceCard rows={[{ id: 'r', testName: 'Old run', detailedLog: '[]' }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
