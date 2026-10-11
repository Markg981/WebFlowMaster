import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateTestPlanWizard from './CreateTestPlanWizard';

/**
 * The wizard sends what the plan's settings dialog can change afterwards: a plan created
 * here with a device, a video setting and a parallelism must not need a second save to
 * get them.
 */

const fetchMock = vi.fn();

/** Radix opens a Select on keyboard activation only; JSDOM has no PointerEvent for a click. */
const choose = async (trigger: HTMLElement, option: string) => {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

const renderWizard = (onPlanCreated = vi.fn()) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => [] } },
  });
  client.setQueryData(['tags'], []);
  render(
    <QueryClientProvider client={client}>
      <CreateTestPlanWizard isOpen onClose={() => {}} onPlanCreated={onPlanCreated} />
    </QueryClientProvider>,
  );
  return onPlanCreated;
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'plan-1' }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CreateTestPlanWizard', () => {
  it('offers the device, video and parallelism the settings dialog does, and sends them', async () => {
    const onPlanCreated = renderWizard();

    fireEvent.change(screen.getByLabelText(/Test Plan Name/i), {
      target: { value: 'Nightly' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // A browser as a phone: the device choice is the one the settings dialog offers.
    await choose(screen.getByRole('combobox', { name: /Operating System/i }), 'Linux');
    await choose(screen.getByRole('combobox', { name: /OS Version/i }), 'Ubuntu 22.04');
    await choose(screen.getByRole('combobox', { name: /Device/i }), 'Pixel 7');
    fireEvent.click(screen.getByRole('button', { name: /Add Machine Configuration/i }));
    // The added row, not the Select trigger that also reads "Pixel 7".
    expect(await screen.findByText(/chrome latest · Pixel 7/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await choose(screen.getByRole('combobox', { name: /^Video$/i }), 'Always');
    fireEvent.change(screen.getByLabelText(/Run at most/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));

    await waitFor(() => expect(onPlanCreated).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.find(([, i]: any[]) => i?.method === 'POST')!;
    expect(url).toBe('/api/test-plans');
    const body = JSON.parse(init.body);
    expect(body.captureVideo).toBe('always');
    expect(body.maxParallelTests).toBe(4);
    expect(body.testMachinesConfig).toEqual([
      expect.objectContaining({ browserName: 'chrome', device: 'Pixel 7' }),
    ]);
  });

  it('refuses a parallelism outside 1 to 16, like the settings dialog', async () => {
    const onPlanCreated = renderWizard();

    fireEvent.change(screen.getByLabelText(/Test Plan Name/i), {
      target: { value: 'Nightly' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    await choose(screen.getByRole('combobox', { name: /Operating System/i }), 'Linux');
    await choose(screen.getByRole('combobox', { name: /OS Version/i }), 'Ubuntu 22.04');
    fireEvent.click(screen.getByRole('button', { name: /Add Machine Configuration/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    fireEvent.change(screen.getByLabelText(/Run at most/i), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));

    expect(
      await screen.findByText('Run at most must be a whole number between 1 and 16.'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]: any[]) => i?.method === 'POST')).toBe(false);
    expect(onPlanCreated).not.toHaveBeenCalled();
  });
});
