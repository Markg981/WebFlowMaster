import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ApiPerformance } from '@shared/api-performance';
import { summarise } from '@shared/api-performance';
import { PerformanceEditor } from './PerformanceEditor';
import PerformanceResultsCard from '../reports/PerformanceResultsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

/** Setting up an API test's response-time check, and reading its outcome in the run report. */

function Harness({ onChange }: { onChange: (value: ApiPerformance | null) => void }) {
  const [value, setValue] = useState<ApiPerformance | null>(null);
  return (
    <PerformanceEditor
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('PerformanceEditor', () => {
  it('starts off, turns on with defaults, keeps counts within the caps, and clears an emptied threshold', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.queryByLabelText('Requests')).toBeNull();

    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith({ iterations: 20, concurrency: 2, thresholds: { p95Ms: 1000, errorRatePct: 0 } });

    fireEvent.change(screen.getByLabelText('Requests'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('At once'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Median \(p50\)/), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/Failed requests/), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ iterations: 200, concurrency: 4, thresholds: { p95Ms: 1000, p50Ms: 200 } });

    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('PerformanceResultsCard', () => {
  it('shows only results with a performance check, with their percentiles and what was exceeded', () => {
    const slow = summarise(
      [...Array.from({ length: 19 }, () => ({ durationMs: 120 })), { durationMs: 900, error: 'Request timed out after 30000ms' }],
      { iterations: 20, concurrency: 2, thresholds: { p95Ms: 300, errorRatePct: 0 } },
    );
    const fine = summarise([{ durationMs: 40 }, { durationMs: 60 }], { iterations: 2, concurrency: 1, thresholds: { p95Ms: 300 } });
    render(
      <PerformanceResultsCard
        rows={[
          { id: 'a', testName: 'List orders', detailedLog: JSON.stringify({ api: true, performance: slow }) },
          { id: 'b', testName: 'Health', detailedLog: JSON.stringify({ api: true, performance: fine }) },
          { id: 'c', testName: 'A UI test', detailedLog: JSON.stringify([{ name: 'Click' }]) },
        ]}
      />,
    );
    const rows = screen.getAllByTestId('performance-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('List orders');
    // p50 and p95 120 ms, the slowest 900 ms.
    expect(Array.from(rows[0].querySelectorAll('td')).slice(2, 5).map((cell) => cell.textContent)).toEqual(['120 ms', '120 ms', '900 ms']);
    expect(rows[0]).toHaveTextContent('errors 5% > 0% (1 of 20)');
    expect(rows[0]).toHaveTextContent('Request timed out');
    expect(rows[1]).toHaveTextContent('within thresholds');
  });

  it('is not shown when no test checked its response times', () => {
    const { container } = render(<PerformanceResultsCard rows={[{ id: 'c', testName: 'UI', detailedLog: null }]} />);
    expect(container.firstChild).toBeNull();
  });
});
