import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TestManagementCard from './TestManagementCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.split(`{{${name}}}`).join(String(value));
      return text;
    },
  }),
}));

/**
 * The organization's TestRail, Xray and Zephyr connections: the fields each tool needs, a token
 * typed once, a check, deletion that says which plans stop publishing, and the case of each test.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/test-management') return Promise.resolve({ ok: true, json: async () => ({ id: 'tm2' }) });
    if (init?.method === 'POST' && url.endsWith('/test')) return Promise.resolve({ ok: true, json: async () => ({ ok: true, detail: 'Connected to Shop.' }) });
    if (init?.method === 'DELETE') return Promise.resolve({ ok: true, json: async () => ({ deleted: true, plansStoppedPublishing: 3 }) });
    if (init?.method === 'PUT') return Promise.resolve({ ok: true, json: async () => ({ changed: 1 }) });
    if (url.endsWith('/cases'))
      return Promise.resolve({
        ok: true,
        json: async () => ({
          provider: 'testrail',
          tests: [
            { type: 'ui', id: 1, name: '[C7] Login', caseKey: null, fromName: 'C7' },
            { type: 'api', id: 2, name: 'Orders API', caseKey: 'C9', fromName: null },
            { type: 'mobile', id: 3, name: 'Login on Android', caseKey: null, fromName: null },
          ],
        }),
      });
    return Promise.resolve({
      ok: true,
      json: async () => [{ id: 'tm1', name: 'QA TestRail', provider: 'testrail', baseUrl: 'https://acme.testrail.io', username: 'qa@acme.test', projectKey: '3', suiteId: '5', testPlanKey: null, hasToken: true }],
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TestManagementCard />
    </QueryClientProvider>,
  );

describe('TestManagementCard', () => {
  it('lists the connections by tool and project, never by token', async () => {
    renderCard();
    const row = await screen.findByTestId('tm-QA TestRail');
    expect(within(row).getByText('TestRail')).toBeTruthy();
    expect(row.textContent).toContain('3 · suite 5');
    expect(row.textContent).not.toMatch(/token/i);
  });

  it('asks TestRail for an address, a user, a project and a token, then saves them', async () => {
    renderCard();
    // A TestRail project may have several suites; only Xray has a Test Plan.
    expect(screen.getByLabelText('Suite id (for a project with several suites)')).toBeTruthy();
    expect(screen.queryByLabelText('Xray Test Plan (optional)')).toBeNull();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TR' } });
    fireEvent.click(screen.getByText('Add connection'));
    expect(screen.getByRole('alert').textContent).toMatch(/address/);

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://acme.testrail.io' } });
    fireEvent.click(screen.getByText('Add connection'));
    expect(screen.getByRole('alert').textContent).toMatch(/User \(e-mail\) is required/);

    fireEvent.change(screen.getByLabelText('User (e-mail)'), { target: { value: 'qa@acme.test' } });
    fireEvent.change(screen.getByLabelText('Project id (a number)'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Add connection'));
    expect(screen.getByRole('alert').textContent).toMatch(/API token is required/);

    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByText('Add connection'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/test-management' && init?.method === 'POST')).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url, i]) => url === '/api/test-management' && i?.method === 'POST')!;
    expect(JSON.parse(init.body)).toEqual({
      name: 'TR',
      provider: 'testrail',
      baseUrl: 'https://acme.testrail.io',
      username: 'qa@acme.test',
      projectKey: '3',
      suiteId: null,
      testPlanKey: null,
      token: 'secret',
    });
    await waitFor(() => expect(screen.getByLabelText('API token')).toHaveValue(''));
  });

  it('checks a connection, and says which plans a deletion stops publishing', async () => {
    renderCard();
    fireEvent.click(await screen.findByLabelText('Test connection'));
    expect(await screen.findByText('Connected to Shop.')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Delete'));
    expect(await screen.findByText('3 plan(s) that published to it no longer publish anywhere.')).toBeTruthy();
  });

  it('maps tests to cases, showing the key a name carries and refusing a key of another tool', async () => {
    renderCard();
    fireEvent.click(await screen.findByLabelText('Test cases'));
    const login = await screen.findByLabelText('Case of [C7] Login');
    expect(login).toHaveAttribute('placeholder', 'C7');
    expect(screen.getByLabelText('Case of Orders API')).toHaveValue('C9');

    fireEvent.change(login, { target: { value: 'SHOP-T1' } });
    expect(screen.getByText(/Not a case key of this tool/).textContent).toContain('SHOP-T1');
    expect(screen.getByText('Save 1 changes').closest('button')).toBeDisabled();

    fireEvent.change(login, { target: { value: 'C12' } });
    fireEvent.change(screen.getByLabelText('Case of Orders API'), { target: { value: '' } });
    // A mobile app test is mapped like the others.
    expect(screen.getByLabelText('Case of Login on Android').closest('li, tr, div')).toHaveTextContent('Mobile');
    fireEvent.change(screen.getByLabelText('Case of Login on Android'), { target: { value: 'C30' } });
    fireEvent.click(screen.getByText('Save 3 changes'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(url).toBe('/api/test-management/tm1/cases');
    expect(JSON.parse(init.body)).toEqual({
      links: [
        { type: 'ui', id: 1, caseKey: 'C12' },
        { type: 'api', id: 2, caseKey: null },
        { type: 'mobile', id: 3, caseKey: 'C30' },
      ],
    });
  });
});
