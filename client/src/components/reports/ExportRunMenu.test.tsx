import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ExportRunMenu from './ExportRunMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

/**
 * The report's export menu. It replaced three buttons that did nothing, so what is worth a test
 * is that each entry is a real download of that run in that format.
 */

describe('ExportRunMenu', () => {
  it('offers the run as HTML, PDF, Allure results and JUnit, each a download of this run', async () => {
    render(<ExportRunMenu executionId="run 1" />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Export/ }), { key: 'Enter', code: 'Enter' });

    const expected: Record<string, string> = {
      html: '/api/test-plan-executions/run%201/export/html',
      pdf: '/api/test-plan-executions/run%201/export/pdf',
      allure: '/api/test-plan-executions/run%201/export/allure',
      junit: '/api/test-plan-executions/run%201/junit',
    };
    for (const [format, href] of Object.entries(expected)) {
      const link = await screen.findByTestId(`export-${format}`);
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('download');
    }
  });
});
