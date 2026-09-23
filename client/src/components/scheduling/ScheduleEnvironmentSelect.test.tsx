import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ScheduleEnvironmentSelect from './ScheduleEnvironmentSelect';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, values?: Record<string, unknown>) =>
      String(typeof fallback === 'string' ? fallback : _key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(values?.[name] ?? '')),
  }),
}));

vi.mock('@/hooks/use-environments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-environments')>();
  return {
    ...actual,
    useEnvironments: () => ({
      data: [
        { id: 4, name: 'QA', description: null, loginStateCapturedAt: null },
        { id: 9, name: 'Staging EU', description: null, loginStateCapturedAt: null },
      ],
      isLoading: false,
    }),
  };
});

/** The environment a schedule runs against, from the organization's own environments. */

describe('ScheduleEnvironmentSelect', () => {
  it("shows the chosen environment by its name, saved by its id", () => {
    render(<ScheduleEnvironmentSelect value="9" onChange={vi.fn()} />);
    expect(document.getElementById('environment')).toHaveTextContent('Staging EU');
  });

  it('turns a name saved by the old form into the id of the environment with that name', async () => {
    const onChange = vi.fn();
    render(<ScheduleEnvironmentSelect value="QA" onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('4'));
  });

  it('says so when a saved name is no environment of this organization, instead of hiding it', () => {
    const onChange = vi.fn();
    render(<ScheduleEnvironmentSelect value="Production" onChange={onChange} />);
    expect(document.getElementById('environment')).toHaveTextContent(/Production — not an environment of this organization/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers no environment at all as a choice, and shows it for an empty value', () => {
    render(<ScheduleEnvironmentSelect value="" onChange={vi.fn()} />);
    expect(document.getElementById('environment')).toHaveTextContent('No environment (defaults only)');
  });
});
