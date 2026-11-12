import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ExportComparisonMenu from './ExportComparisonMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

describe('ExportComparisonMenu', () => {
  it('offers the parity report as HTML and PDF, each a download of this comparison', async () => {
    render(<ExportComparisonMenu comparisonId="cmp 1" />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Export/ }), {
      key: 'Enter',
      code: 'Enter',
    });
    for (const format of ['html', 'pdf']) {
      const link = await screen.findByTestId(`export-comparison-${format}`);
      expect(link).toHaveAttribute('href', `/api/comparisons/cmp%201/export/${format}`);
      expect(link).toHaveAttribute('download');
    }
  });
});
