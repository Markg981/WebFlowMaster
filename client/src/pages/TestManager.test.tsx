import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestManager from './TestManager';
import { getQueryFn } from '@/lib/queryClient';

/**
 * The Excel test manager: a spreadsheet of test cases becomes rows, each row is mapped to a
 * saved sequence, and the selected rows run one after another through the same endpoint as a
 * test started from the library, with a report per row.
 */

const fetchMock = vi.fn();

const rows = [
  {
    id: 'r1',
    testCaseId: 'TC-1',
    priority: 'High',
    functionalObjective: 'Sign in with a valid account',
    expectedOutcome: 'Dashboard opens',
    devOpsId: '100',
    sme: 'Ada',
  },
  {
    id: 'r2',
    testCaseId: 'TC-2',
    priority: 'Low',
    functionalObjective: 'Pay by card',
    expectedOutcome: 'Order confirmed',
    devOpsId: '101',
    sme: 'Ada',
  },
  {
    id: 'r3',
    testCaseId: 'TC-3',
    priority: 'Medium',
    functionalObjective: 'Search the catalogue',
    expectedOutcome: 'Results listed',
    devOpsId: '102',
    sme: 'Bob',
  },
];

const sequences = [
  { id: 5, name: 'Login flow' },
  { id: 6, name: 'Checkout flow' },
];

const passedRun = {
  success: true,
  duration: 1500,
  steps: [
    { name: 'Open page', type: 'navigate', status: 'passed', details: 'Opened /login' },
    { name: 'Click login', type: 'click', status: 'passed' },
  ],
};

const failedRun = {
  success: false,
  error: 'Element not found: #submit',
  duration: 800,
  steps: [
    { name: 'Open page', type: 'navigate', status: 'passed' },
    { name: 'Click login', type: 'click', status: 'failed', error: 'Element not found: #submit' },
  ],
};

/** A reply with a status of its own; a bare body answers 200. */
class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown = {},
  ) {}
}
const reply = (status: number, body?: unknown) => new Reply(status, body);

/** Answers `${method} ${url}`; anything unlisted gets an empty 200. */
function answer(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const route = routes[`${method} ${url}`];
    const answerWith = route instanceof Reply ? route : new Reply(200, route ?? {});
    const status = answerWith.status;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => answerWith.body ?? {},
      text: async () => JSON.stringify(answerWith.body ?? {}),
    });
  });
}

const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]: any[]) => u === url && (init?.method ?? 'GET') === method,
  );

const sentJson = (method: string, url: string) => {
  const call = calls(method, url)[0];
  return call && call[1]?.body ? JSON.parse(call[1].body) : undefined;
};

const routes = {
  'GET /api/tests': sequences,
  'GET /api/excel-mappings': [{ id: 1, excelTestCaseId: 'TC-1', testId: 5 }],
  'POST /api/upload-excel': rows,
  'POST /api/tests/5/run': passedRun,
  'POST /api/tests/6/run': failedRun,
};

function renderPage() {
  // The hooks read their lists under a URL key and the app's default queryFn; same here.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: getQueryFn({ on401: 'throw' }) },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <TestManager />
    </QueryClientProvider>,
  );
}

/** Chooses the workbook and uploads it, which is how every row gets on screen. */
async function importWorkbook() {
  const file = new File(['xlsx bytes'], 'cases.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(screen.getByLabelText('No file chosen'), { target: { files: [file] } });
  expect(screen.getByText('cases.xlsx')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Upload Excel' }));
  await screen.findByText('TC-1');
}

const rowOf = (id: string) => screen.getByText(id).closest('tr')!;

/** Radix opens a Select on keyboard activation only; JSDOM has no PointerEvent for a click. */
const choose = async (trigger: HTMLElement, option: string) => {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TestManager', () => {
  it('opens on the empty state, with the file picker and no upload until a file is chosen', () => {
    answer(routes);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Test Manager' })).toBeInTheDocument();
    expect(screen.getByText('Start from an Excel file')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload Excel' })).toBeNull();

    const file = new File(['xlsx bytes'], 'cases.xlsx');
    fireEvent.change(screen.getByLabelText('No file chosen'), { target: { files: [file] } });
    expect(screen.getByRole('button', { name: 'Upload Excel' })).toBeEnabled();
  });

  it('uploads the workbook and lists each row with its mapped sequence', async () => {
    answer(routes);
    renderPage();
    await importWorkbook();

    const upload = calls('POST', '/api/upload-excel')[0];
    expect(upload[1].body).toBeInstanceOf(FormData);
    expect((upload[1].body as FormData).get('file')).toBeInstanceOf(File);

    expect(screen.getByText('3 test cases imported')).toBeInTheDocument();
    expect(screen.queryByText('Start from an Excel file')).toBeNull();
    expect(within(rowOf('TC-1')).getByText('High')).toBeInTheDocument();
    expect(within(rowOf('TC-1')).getByText('Sign in with a valid account')).toBeInTheDocument();
    expect(within(rowOf('TC-2')).getByText('Pay by card')).toBeInTheDocument();
    expect(screen.getAllByText('Not run')).toHaveLength(3);

    // The saved mapping of TC-1 is shown; the other rows still ask for one.
    await waitFor(() =>
      expect(within(rowOf('TC-1')).getByRole('combobox')).toHaveTextContent('Login flow'),
    );
    expect(within(rowOf('TC-2')).getByRole('combobox')).toHaveTextContent('Choose a sequence');
  });

  it('stays on the empty state when the upload is refused', async () => {
    answer({ ...routes, 'POST /api/upload-excel': reply(500, { error: 'Not a workbook' }) });
    renderPage();
    const file = new File(['not xlsx'], 'notes.txt');
    fireEvent.change(screen.getByLabelText('No file chosen'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload Excel' }));

    await waitFor(() => expect(calls('POST', '/api/upload-excel')).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload Excel' })).toBeEnabled());
    expect(screen.getByText('Start from an Excel file')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('counts the selection on the run button and offers no run with nothing selected', async () => {
    answer(routes);
    renderPage();
    await importWorkbook();

    const run = screen.getByRole('button', { name: 'Run selected (0)' });
    expect(run).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select test case TC-1' }));
    expect(screen.getByRole('button', { name: 'Run selected (1)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select test case TC-3' }));
    expect(screen.getByRole('button', { name: 'Run selected (2)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select test case TC-1' }));
    expect(screen.getByRole('button', { name: 'Run selected (1)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select test case TC-3' }));
    expect(screen.getByRole('button', { name: 'Run selected (0)' })).toBeDisabled();
  });

  it('saves a mapping chosen for a row', async () => {
    answer(routes);
    renderPage();
    await importWorkbook();

    await choose(within(rowOf('TC-2')).getByRole('combobox'), 'Checkout flow');
    await waitFor(() =>
      expect(sentJson('POST', '/api/excel-mappings')).toEqual({
        excelTestCaseId: 'TC-2',
        testId: 6,
      }),
    );
    expect(within(rowOf('TC-2')).getByRole('combobox')).toHaveTextContent('Checkout flow');
  });

  it('runs the mapped rows that are selected, in table order, and opens their reports', async () => {
    answer(routes);
    renderPage();
    await importWorkbook();
    await choose(within(rowOf('TC-3')).getByRole('combobox'), 'Checkout flow');

    // Ticked out of order; run in table order, the unmapped one skipped.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select test case TC-3' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select test case TC-2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select test case TC-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run selected (3)' }));

    expect(await within(rowOf('TC-1')).findByText('Passed')).toBeInTheDocument();
    expect(await within(rowOf('TC-3')).findByText('Failed')).toBeInTheDocument();
    expect(within(rowOf('TC-2')).getByText('Not mapped')).toBeInTheDocument();
    expect(within(rowOf('TC-2')).queryByRole('button', { name: /View report/ })).toBeNull();

    const runs = fetchMock.mock.calls
      .filter(([u, init]: any[]) => init?.method === 'POST' && String(u).endsWith('/run'))
      .map(([u]: any[]) => u);
    expect(runs).toEqual(['/api/tests/5/run', '/api/tests/6/run']);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run selected (3)' })).toBeEnabled(),
    );

    fireEvent.click(within(rowOf('TC-1')).getByRole('button', { name: /View report/ }));
    const report = await screen.findByRole('dialog');
    expect(within(report).getByRole('heading', { name: 'TC-1 · Login flow' })).toBeInTheDocument();
    expect(within(report).getByText('2 of 2 steps passed in 1.5 s')).toBeInTheDocument();
    expect(within(report).getByText('1. Open page')).toBeInTheDocument();
    expect(within(report).getByText('Opened /login')).toBeInTheDocument();
    expect(within(report).getByText('2. Click login')).toBeInTheDocument();
    fireEvent.keyDown(report, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(within(rowOf('TC-3')).getByRole('button', { name: /View report/ }));
    const failed = await screen.findByRole('dialog');
    expect(
      within(failed).getByRole('heading', { name: 'TC-3 · Checkout flow' }),
    ).toBeInTheDocument();
    expect(within(failed).getByText('1 of 2 steps passed in 0.8 s')).toBeInTheDocument();
    expect(within(failed).getAllByText('Element not found: #submit').length).toBeGreaterThan(0);
  });

  it('marks a row whose run the server refused as an error, with a report of it', async () => {
    answer({ ...routes, 'POST /api/tests/5/run': reply(500, { error: 'Runner unavailable' }) });
    renderPage();
    await importWorkbook();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select test case TC-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run selected (1)' }));

    expect(await within(rowOf('TC-1')).findByText('Error')).toBeInTheDocument();
    fireEvent.click(within(rowOf('TC-1')).getByRole('button', { name: /View report/ }));
    const report = await screen.findByRole('dialog');
    expect(within(report).getByText('The run stopped before any step.')).toBeInTheDocument();
    expect(within(report).getByText(/Runner unavailable/)).toBeInTheDocument();
  });
});
