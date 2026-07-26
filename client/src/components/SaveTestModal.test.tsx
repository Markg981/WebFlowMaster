import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SaveTestModal from './SaveTestModal';
import { TestRouter } from '@/test-utils/router';

/**
 * Only `apiRequest` is stubbed: react-query runs for real, so the optimistic cache update
 * and the auto-selection after creating a project are genuinely exercised. The previous
 * version replaced `useQuery`/`useMutation` with hand-rolled fakes and therefore asserted
 * on the fakes rather than on the component.
 */

interface Project {
  id: number;
  name: string;
}

const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (options: unknown) => mockToast(options),
  useToast: () => ({ toast: mockToast }),
}));

const sampleProjects: Project[] = [
  { id: 1, name: 'Project Alpha' },
  { id: 2, name: 'Project Beta' },
];

const jsonOk = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

const renderSaveTestModal = (
  props: React.ComponentProps<typeof SaveTestModal>,
  client: QueryClient = createTestQueryClient(),
) => {
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <TestRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </TestRouter>
  );
  const utils = render(<SaveTestModal {...props} />, { wrapper });
  const rerenderWithProps = (next: React.ComponentProps<typeof SaveTestModal>) =>
    utils.rerender(<SaveTestModal {...next} />);
  return { ...utils, rerenderWithProps };
};

/**
 * Radix opens its Select on keyboard activation, and only when the trigger holds focus —
 * a bare mouseDown does nothing in JSDOM because there is no PointerEvent.
 */
const openSelect = async (trigger: HTMLElement) => {
  // The trigger is `disabled` while the projects query is in flight, and a disabled button
  // swallows the keydown — so wait for the data to land before trying to open it.
  await waitFor(() => expect(trigger).not.toBeDisabled());
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(selectOptions().length).toBeGreaterThan(0));
};

/**
 * The Select content is portalled to <body>, which Radix's Dialog marks aria-hidden while
 * the modal is open — so the options are only reachable with `hidden: true`.
 */
const selectOptions = () => screen.getAllByRole('option', { hidden: true });
const selectOption = (name: string) =>
  screen.findByRole('option', { name, hidden: true });

const projectsFetchCount = () =>
  mockApiRequest.mock.calls.filter(
    ([method, url]) => method === 'GET' && url === '/api/projects',
  ).length;

describe('SaveTestModal', () => {
  let onSaveMock: ReturnType<typeof vi.fn>;
  let onCloseMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onSaveMock = vi.fn();
    onCloseMock = vi.fn();
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === 'GET' && url === '/api/projects') return jsonOk(sampleProjects);
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
  });

  it('renders correctly when open and loads projects', async () => {
    renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });

    expect(screen.getByText('Save Test')).toBeInTheDocument();
    expect(screen.getByLabelText('Test Name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Project/)).toBeInTheDocument(); // Label includes asterisk
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    await waitFor(() => expect(projectsFetchCount()).toBeGreaterThan(0));
  });

  it('refetches projects when re-opened', async () => {
    const client = createTestQueryClient();
    const { rerenderWithProps } = renderSaveTestModal(
      { isOpen: false, onSave: onSaveMock, onClose: onCloseMock },
      client,
    );

    // The query is `enabled: isOpen`, so a closed modal must not hit the API.
    expect(projectsFetchCount()).toBe(0);

    rerenderWithProps({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });
    await waitFor(() => expect(projectsFetchCount()).toBeGreaterThan(0));
    const afterFirstOpen = projectsFetchCount();

    rerenderWithProps({ isOpen: false, onSave: onSaveMock, onClose: onCloseMock });
    rerenderWithProps({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });
    await waitFor(() => expect(projectsFetchCount()).toBeGreaterThan(afterFirstOpen));
  });

  it('Save button is disabled until both a name and a project are provided', async () => {
    renderSaveTestModal({
      isOpen: true,
      onSave: onSaveMock,
      onClose: onCloseMock,
      initialTestName: '',
    });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    const testNameInput = screen.getByLabelText('Test Name');
    const projectSelectTrigger = screen.getByRole('combobox', { name: /Project/i });

    expect(saveButton).toBeDisabled();

    fireEvent.change(testNameInput, { target: { value: 'My Test' } });
    expect(saveButton).toBeDisabled();

    await waitFor(() => expect(projectsFetchCount()).toBeGreaterThan(0));
    await openSelect(projectSelectTrigger);
    fireEvent.click(await selectOption('Project Alpha'));
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    fireEvent.change(testNameInput, { target: { value: '' } });
    expect(saveButton).toBeDisabled();
  });

  it('calls onSave with the test name and the selected project id', async () => {
    renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });

    const testNameInput = screen.getByLabelText('Test Name');
    const projectSelectTrigger = screen.getByRole('combobox', { name: /Project/i });
    const saveButton = screen.getByRole('button', { name: 'Save' });

    fireEvent.change(testNameInput, { target: { value: 'Valid Test Name' } });

    await waitFor(() => expect(projectsFetchCount()).toBeGreaterThan(0));
    await openSelect(projectSelectTrigger);
    fireEvent.click(await selectOption('Project Alpha'));

    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    expect(onSaveMock).toHaveBeenCalledWith('Valid Test Name', sampleProjects[0].id);
  });

  it('calls onClose when Cancel is clicked', () => {
    renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  describe('Create New Project functionality', () => {
    it('creates a project, selects it, and closes the nested dialog', async () => {
      const newProjectName = 'Project Gamma';
      const newlyCreated: Project = { id: 3, name: newProjectName };

      // The component invalidates the projects query after creating one, so the server has
      // to start returning the new project — otherwise the refetch would legitimately
      // overwrite the optimistic entry.
      let created = false;
      mockApiRequest.mockImplementation(async (method: string, url: string) => {
        if (method === 'GET' && url === '/api/projects') {
          return jsonOk(created ? [...sampleProjects, newlyCreated] : sampleProjects);
        }
        if (method === 'POST' && url === '/api/projects') {
          created = true;
          return jsonOk(newlyCreated);
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });
      await waitFor(() => expect(projectsFetchCount()).toBeGreaterThan(0));

      fireEvent.click(screen.getByRole('button', { name: 'Create New Project' }));

      const nestedDialog = await screen.findByRole('dialog', { name: 'Create New Project' });
      fireEvent.change(within(nestedDialog).getByLabelText('Project Name'), {
        target: { value: newProjectName },
      });
      fireEvent.click(within(nestedDialog).getByRole('button', { name: 'Save Project' }));

      await waitFor(() =>
        expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/projects', {
          name: newProjectName,
        }),
      );

      // The optimistic cache write makes the new project the selected one.
      const projectSelectTrigger = screen.getByRole('combobox', { name: /Project/i });
      await waitFor(() =>
        expect(within(projectSelectTrigger).getByText(newProjectName)).toBeInTheDocument(),
      );

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Project Created' }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Create New Project' }),
        ).not.toBeInTheDocument(),
      );
    });

    it('skips malformed entries in the project dropdown without crashing', async () => {
      const malformedProjects = [
        { id: 10, name: 'Valid Project 10' },
        undefined,
        { name: 'Project Without ID' },
        { id: null, name: 'Project With Null ID' },
        { id: 13, name: 'Valid Project 13' },
        { id: '14', name: 'Project With String ID' },
      ];

      mockApiRequest.mockImplementation(async (method: string, url: string) => {
        if (method === 'GET' && url === '/api/projects') return jsonOk(malformedProjects);
        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });
      await waitFor(() => expect(projectsFetchCount()).toBeGreaterThan(0));

      const projectSelectTrigger = screen.getByRole('combobox', { name: /Project/i });
      await openSelect(projectSelectTrigger);

      expect(await selectOption('Valid Project 10')).toBeInTheDocument();
      expect(await selectOption('Valid Project 13')).toBeInTheDocument();

      expect(screen.queryByText('Project Without ID')).not.toBeInTheDocument();
      expect(screen.queryByText('Project With Null ID')).not.toBeInTheDocument();
      expect(screen.queryByText('Project With String ID')).not.toBeInTheDocument();

      expect(selectOptions()).toHaveLength(2);
    });
  });
});
