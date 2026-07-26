import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import DashboardPageNew from './dashboard-page-new';

/**
 * Covers the "Create Test" page at the seam that matters: what the page hands to the API
 * when the user saves, and what it does with the recorder.
 *
 * Only the leaves are stubbed (React Flow builder, save modal, preconditions panel);
 * react-query itself runs for real, so mutation wiring is exercised rather than mocked
 * away — the previous version of this file replaced `useMutation` with a spy and could not
 * have caught a broken payload.
 */

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Return the key (or the provided default) so assertions do not depend on translations.
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

const SAVE_NAME = 'Checkout smoke test';
const SAVE_PROJECT_ID = 7;

vi.mock('@/components/SaveTestModal', () => ({
  default: ({
    isOpen,
    onSave,
  }: {
    isOpen: boolean;
    onSave: (name: string, projectId?: number) => void;
  }) =>
    isOpen ? (
      <div data-testid="save-modal">
        <button data-testid="modal-confirm" onClick={() => onSave(SAVE_NAME, SAVE_PROJECT_ID)}>
          confirm
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/PreconditionsPanel', () => ({
  PreconditionsPanel: () => <div data-testid="preconditions-panel" />,
}));

vi.mock('@/components/visual-builder/VisualTestBuilder', () => ({
  VisualTestBuilder: ({
    testSequence,
    onUpdateSequence,
    onSaveTest,
    onExecuteTest,
  }: {
    testSequence: unknown[];
    onUpdateSequence: (sequence: unknown[]) => void;
    onSaveTest: () => void;
    onExecuteTest: () => void;
  }) => (
    <div>
      <span data-testid="step-count">{testSequence.length}</span>
      <button
        data-testid="add-step"
        onClick={() =>
          onUpdateSequence([
            {
              id: 'step-1',
              action: {
                id: 'click',
                type: 'click',
                name: 'click',
                icon: 'mouse-pointer',
                description: 'click',
              },
              targetElement: {
                id: 'el-1',
                type: 'button',
                selector: '#submit',
                text: 'Submit',
                tag: 'button',
                attributes: {},
              },
              value: '',
            },
          ])
        }
      >
        add step
      </button>
      <button data-testid="save-test" onClick={onSaveTest}>
        save
      </button>
      <button data-testid="execute-test" onClick={onExecuteTest}>
        execute
      </button>
    </div>
  ),
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DndProvider backend={HTML5Backend}>
        <DashboardPageNew />
      </DndProvider>
    </QueryClientProvider>,
  );
};

const urlInput = (container: HTMLElement) =>
  container.querySelector('#urlInput') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ defaultTestUrl: null, theme: 'light' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardPageNew — saving a test', () => {
  it('refuses to open the save modal with an empty sequence', async () => {
    renderPage();

    fireEvent.click(screen.getByTestId('save-test'));

    expect(screen.queryByTestId('save-modal')).not.toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('posts the current URL, sequence and project id', async () => {
    mockApiRequest.mockResolvedValue({ id: 12345, name: SAVE_NAME });

    const { container } = renderPage();

    fireEvent.change(urlInput(container), { target: { value: 'https://shop.test' } });
    fireEvent.click(screen.getByTestId('add-step'));
    fireEvent.click(screen.getByTestId('save-test'));

    await screen.findByTestId('save-modal');
    fireEvent.click(screen.getByTestId('modal-confirm'));

    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());

    const [method, url, payload] = mockApiRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(url).toBe('/api/tests');
    expect(payload).toMatchObject({
      name: SAVE_NAME,
      projectId: SAVE_PROJECT_ID,
      url: 'https://shop.test',
      status: 'draft',
    });
    expect(payload.sequence).toHaveLength(1);
    expect(payload.sequence[0].targetElement.selector).toBe('#submit');
  });

  it('reports a failed save', async () => {
    mockApiRequest.mockRejectedValue(new Error('Simulated server error'));

    const { container } = renderPage();

    fireEvent.change(urlInput(container), { target: { value: 'https://shop.test' } });
    fireEvent.click(screen.getByTestId('add-step'));
    fireEvent.click(screen.getByTestId('save-test'));

    await screen.findByTestId('save-modal');
    fireEvent.click(screen.getByTestId('modal-confirm'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Simulated server error',
          variant: 'destructive',
        }),
      ),
    );
  });
});

describe('DashboardPageNew — recording mode', () => {
  const switchToRecordMode = async () => {
    // The mode <select> is a Radix trigger; drive the page through it by role.
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const recordOption = await screen.findByText(
      'dashboardPageNew.registraAzioniUtenteAutorecord.text',
    );
    fireEvent.click(recordOption);
  };

  it('starts a recording for the current URL without requiring a preview load', async () => {
    mockApiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, sessionId: 'sess-1' }),
    });

    const { container } = renderPage();
    fireEvent.change(urlInput(container), { target: { value: 'https://shop.test' } });
    await switchToRecordMode();

    const startButton = await screen.findByText('dashboardPageNew.iniziaRegistrazione.button');
    expect(startButton.closest('button')).not.toBeDisabled();

    fireEvent.click(startButton);

    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/start-recording', {
        url: 'https://shop.test',
      }),
    );
  });

  it('keeps the start button disabled while no URL is entered', async () => {
    const { container } = renderPage();
    fireEvent.change(urlInput(container), { target: { value: '' } });
    await switchToRecordMode();

    const startButton = await screen.findByText('dashboardPageNew.iniziaRegistrazione.button');
    expect(startButton.closest('button')).toBeDisabled();
  });
});
