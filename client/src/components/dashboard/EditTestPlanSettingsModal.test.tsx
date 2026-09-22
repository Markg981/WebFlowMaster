import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EditTestPlanSettingsModal from './EditTestPlanSettingsModal';
import type { TestPlan } from '@shared/schema';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key) }),
}));

/**
 * The browsers a plan covers, its visual testing switch and where its notifications go could
 * only be set while creating the plan — there was no edit screen at all, so every plan made
 * before those settings worked was stuck without them.
 */

const plan = {
  id: 'plan-1',
  name: 'Nightly regression',
  testMachinesConfig: [{ browserName: 'firefox', headless: true }],
  visualTestingEnabled: true,
  notificationSettings: { passed: false, failed: true, notExecuted: true, stopped: true, webhookUrl: 'https://hooks.test/abc' },
} as unknown as TestPlan;

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('EditTestPlanSettingsModal', () => {
  it('opens on what the plan already holds', () => {
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={() => {}} />);

    expect(screen.getByText('firefox')).toBeInTheDocument();
    expect(screen.getByLabelText('Visual testing')).toBeChecked();
    expect(screen.getByLabelText(/webhook URL/i)).toHaveValue('https://hooks.test/abc');
    expect(screen.getByLabelText('passed')).not.toBeChecked();
    expect(screen.getByLabelText('failed')).toBeChecked();
  });

  it('saves the three run settings, and leaves the plan’s tests alone', async () => {
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/webhook URL/i), { target: { value: 'https://hooks.test/new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/test-plans/plan-1');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body);
    expect(body.testMachinesConfig).toEqual([{ browserName: 'firefox', headless: true }]);
    expect(body.visualTestingEnabled).toBe(true);
    expect(body.notificationSettings.webhookUrl).toBe('https://hooks.test/new');
    expect(body.selectedTests).toBeUndefined();
  });

  it('saves how many tests may run at once', async () => {
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/Run at most/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).maxParallelTests).toBe(4);
  });

  it('refuses a parallelism that is not a usable number of browser sessions', async () => {
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Run at most/i), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/between 1 and 16/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a webhook URL that is not http(s) instead of storing it', async () => {
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.change(screen.getByLabelText(/webhook URL/i), { target: { value: 'slack://channel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/must start with http/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends an empty destination as null, so the plan stops notifying', async () => {
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/webhook URL/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).notificationSettings.webhookUrl).toBeNull();
  });

  it('removes a browser from the matrix', async () => {
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).testMachinesConfig).toEqual([]);
  });

  it('reports a refused save rather than closing as if it had worked', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Invalid request payload' }) });
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Invalid request payload')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
