import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BddResultsCard from './BddResultsCard';
import GherkinArguments from '../tests/GherkinArguments';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
describe('BDD evidence', () => {
  it('renders hooks and undefined diagnostics and attachments as escaped plain text', () => {
    const text = '<script>alert(1)</script>';
    const log = JSON.stringify({
      bdd: {
        runs: [
          {
            status: 'failed',
            durationMs: 20,
            steps: [
              {
                kind: 'hook',
                name: 'Before',
                status: 'FAILED',
                durationMs: 2,
                error: 'hook failed',
              },
              { kind: 'step', name: 'Given a', status: 'UNDEFINED', durationMs: 0 },
            ],
            attachments: [
              { mediaType: 'text/plain', text },
              { mediaType: 'text/html', text: 'unsafe HTML' },
            ],
          },
        ],
      },
    });
    const { container } = render(
      <BddResultsCard rows={[{ id: 'r', testName: 'Scenario', detailedLog: log }]} />,
    );
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('UNDEFINED')).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText('unsafe HTML')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
  it('shows manual doc strings and data tables as text', () => {
    render(
      <GherkinArguments
        argument={{
          docString: { content: '<p>hello</p>', mediaType: 'text/plain' },
          dataTable: { rows: [{ cells: [{ value: 'a | b' }, { value: 'second' }] }] },
        }}
      />,
    );
    expect(screen.getByText('<p>hello</p>')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('a | b');
  });
});
