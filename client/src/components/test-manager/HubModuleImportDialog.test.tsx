import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HubModuleImportDialog, { pendingCases } from './HubModuleImportDialog';
import type { HubModuleCoverage } from '@/hooks/useTestCaseHub';

/**
 * The module import dialog: each module with its active cases, those in the library and those an
 * import would take up; the chosen modules and options go to the server as one background job.
 */

const fetchMock = vi.fn();

const modules: HubModuleCoverage[] = [
  { module: 'DMO Archiving', total: 27, active: 26, imported: 0, importedActive: 0, changed: 0 },
  { module: 'DMO Core', total: 4313, active: 4013, imported: 10, importedActive: 9, changed: 2 },
  { module: 'DMO Setup', total: 6, active: 6, imported: 6, importedActive: 6, changed: 0 },
];

const startedJob = {
  id: 'job-9',
  kind: 'modules_import',
  status: 'queued',
  params: {},
  progress: {},
  summary: null,
  error: null,
  createdAt: '2026-11-19T10:00:00Z',
  startedAt: null,
  finishedAt: null,
  cancelRequested: false,
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const body =
      url === '/api/projects'
        ? [{ id: 3, name: 'DMO' }]
        : init?.method === 'POST'
          ? startedJob
          : {};
    return Promise.resolve({
      ok: true,
      status: init?.method === 'POST' ? 202 : 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDialog(onStarted = vi.fn(), onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <HubModuleImportDialog
        open
        onOpenChange={onOpenChange}
        modules={modules}
        onStarted={onStarted}
      />
    </QueryClientProvider>,
  );
  return { onStarted, onOpenChange };
}

describe('pendingCases', () => {
  it('counts the active cases not in the library, deprecated and changed ones when asked', () => {
    expect(pendingCases(modules[1], false, false)).toBe(4004);
    expect(pendingCases(modules[1], true, false)).toBe(4303);
    expect(pendingCases(modules[1], false, true)).toBe(4006);
    expect(pendingCases(modules[2], false, false)).toBe(0);
  });
});

describe('HubModuleImportDialog', () => {
  it('lists the modules with what an import would take up, a complete one disabled', () => {
    renderDialog();
    expect(screen.getAllByTestId('hub-module-import-row')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'DMO Setup' })).toBeDisabled();
    expect(screen.getByTestId('hub-module-import-submit')).toBeDisabled();
  });

  it('starts one job for the chosen modules and hands it back', async () => {
    const { onStarted, onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId('hub-module-import-all'));
    expect(screen.getByTestId('hub-module-import-submit')).toHaveTextContent('4030');
    fireEvent.click(screen.getByTestId('hub-module-import-submit'));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(startedJob));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const call = fetchMock.mock.calls.find(
      ([url]: any[]) => url === '/api/testcase-hub/import/modules',
    );
    expect(JSON.parse(call![1].body)).toEqual({
      modules: ['DMO Archiving', 'DMO Core'],
      projectId: null,
      variant: 'standard',
      includeDeprecated: false,
      updateChanged: false,
      sync: false,
    });
  });
});
