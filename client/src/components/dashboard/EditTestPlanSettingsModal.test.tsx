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
  fetchMock.mockImplementation((url: string) =>
    // Opening the dialog also reads the organization's issue trackers, so the save is no
    // longer the only request here — every assertion below looks for the PUT by name.
    Promise.resolve({ ok: true, json: async () => (String(url).includes('/api/issue-trackers') ? [] : {}) }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

/** The save, whichever request it happened to be. */
function putCall() {
  return fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
}

function savedBody() {
  return JSON.parse(putCall()![1].body);
}

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
    const [url, init] = putCall()!;
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
    expect(savedBody().maxParallelTests).toBe(4);
  });

  it('refuses a parallelism that is not a usable number of browser sessions', async () => {
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Run at most/i), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/between 1 and 16/i)).toBeInTheDocument();
    expect(putCall()).toBeUndefined();
  });

  it('refuses a webhook URL that is not http(s) instead of storing it', async () => {
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.change(screen.getByLabelText(/webhook URL/i), { target: { value: 'slack://channel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/must start with http/i)).toBeInTheDocument();
    expect(putCall()).toBeUndefined();
  });

  it('sends an empty destination as null, so the plan stops notifying', async () => {
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/webhook URL/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedBody().notificationSettings.webhookUrl).toBeNull();
  });

  it('removes a browser from the matrix', async () => {
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedBody().testMachinesConfig).toEqual([]);
  });

  it('offers the organization’s trackers, and files nowhere until one is chosen', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(url).includes('/api/issue-trackers') ? [{ id: 'tracker-1', name: 'Jira — Shop', provider: 'jira' }] : {},
      }),
    );
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);

    // Nothing is filed by a plan that names no tracker, so the switch has nothing to turn on.
    expect(await screen.findByLabelText('Open an issue when a test fails')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedBody().issueTrackerId).toBeNull();
    expect(savedBody().createIssuesOnFailure).toBe(false);
  });

  it('runs on the server until a pool of local agents is chosen, then sends that pool', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(url).includes('/api/agents')
            ? { agents: [{ pool: 'onprem', revokedAt: null }, { pool: 'retired', revokedAt: '2026-09-01T00:00:00Z' }] }
            : String(url).includes('/api/issue-trackers') ? [] : {},
      }),
    );
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);

    const trigger = screen.getByRole('combobox', { name: 'Run on' });
    expect(trigger).toHaveTextContent("This server's runners");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agents')).toBe(true));
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
    // A revoked agent's pool lends nothing, so it is not offered.
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    fireEvent.click(options[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedBody().agentPool).toBe('onprem');
  });

  it('sends no pool for a plan that runs on the server', async () => {
    const onSaved = vi.fn();
    render(<EditTestPlanSettingsModal isOpen plan={plan} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedBody().agentPool).toBeNull();
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
