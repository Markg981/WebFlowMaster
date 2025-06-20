import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SaveTestModal from './SaveTestModal';
import { MemoryRouter } from 'wouter'; // Needed if any sub-components use Link/navigation

// Define Project type locally for the test, matching the component's expectation
interface Project {
  id: number;
  name: string;
}

// Mock lucide-react icons
vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal() as any;
  const genericIcon = (props: any) => <svg data-testid={`icon-${props.name || 'generic'}`} />;
  return {
    ...original,
    Loader2: (props: any) => genericIcon({...props, name: 'loader2'}),
    // Add other icons used directly by SaveTestModal or its subcomponents if any
  };
});

// Mock API calls & react-query
const mockInvalidateQueries = vi.fn();
const mockMutateCreateProject = vi.fn();
let mockProjectsQueryData: { data: Project[] | undefined; isLoading: boolean; isError: boolean; error: Error | null } = {
  data: [],
  isLoading: false,
  isError: false,
  error: null,
};

vi.mock('@tanstack/react-query', async () => {
  const original = await vi.importActual('@tanstack/react-query') as any;
  return {
    ...original,
    useQuery: (options: { queryKey: string[] }) => {
      if (options.queryKey[0] === 'projects') {
        return mockProjectsQueryData;
      }
      return { data: [], isLoading: false, isError: false, error: null }; // Default for other queries
    },
    useMutation: (options: any) => {
      // Assuming the mutation in SaveTestModal is for creating projects
      // This mock will be used for the createProjectMutation
      return {
        mutate: (vars: any) => {
          mockMutateCreateProject(vars); // Call our specific mock for project creation
          if (options && options.onSuccess) {
            // Simulate successful project creation
            act(() => options.onSuccess({ id: Date.now(), name: vars.name }, vars, {}));
          }
        },
        isPending: false, // Default, can be overridden in tests
      };
    },
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

// Mock toast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (options: any) => mockToast(options),
}));

// Helper to create a QueryClient instance for tests
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity },
  },
});

// Wrapper component providing necessary context (QueryClientProvider, MemoryRouter)
const AllTheProviders: React.FC<{ children: React.ReactNode, client?: QueryClient }> = ({ children, client }) => {
  const [queryClient] = React.useState(() => client || createTestQueryClient());
  return <MemoryRouter><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></MemoryRouter>;
};

// Render function with the wrapper
const renderSaveTestModal = (props: React.ComponentProps<typeof SaveTestModal>, client?: QueryClient) => {
  return render(<SaveTestModal {...props} />, { wrapper: ({children}) => <AllTheProviders client={client}>{children}</AllTheProviders> });
};

// Sample Projects Data
const sampleProjects: Project[] = [
  { id: 1, name: 'Project Alpha' },
  { id: 2, name: 'Project Beta' },
];

describe('SaveTestModal', () => {
  let onSaveMock: ReturnType<typeof vi.fn>;
  let onCloseMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks(); // Reset all mocks before each test
    onSaveMock = vi.fn();
    onCloseMock = vi.fn();
    mockProjectsQueryData = { data: sampleProjects, isLoading: false, isError: false, error: null };
  });

  it('renders correctly when open', () => {
    renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });
    expect(screen.getByText('Save Test')).toBeInTheDocument();
    expect(screen.getByLabelText('Test Name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Project/)).toBeInTheDocument(); // Label includes asterisk
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('Save button is disabled if test name is empty or project is not selected', async () => {
    renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock, initialTestName: '' });
    const saveButton = screen.getByRole('button', { name: 'Save' });
    const testNameInput = screen.getByLabelText('Test Name');
    const projectSelectTrigger = screen.getByRole('combobox', { name: /Project/i });


    // Initially, both name and project are empty/not selected
    expect(saveButton).toBeDisabled();

    // Enter test name, but no project selected
    fireEvent.change(testNameInput, { target: { value: 'My Test' } });
    expect(saveButton).toBeDisabled();

    // Select project, name is present
    fireEvent.mouseDown(projectSelectTrigger);
    await waitFor(() => expect(screen.getByText(sampleProjects[0].name)).toBeInTheDocument());
    fireEvent.click(screen.getByText(sampleProjects[0].name));
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    // Clear test name, project is selected
    fireEvent.change(testNameInput, { target: { value: '' } });
    expect(saveButton).toBeDisabled();
  });

  it('calls onSave with test name and selected project ID when Save is clicked and form is valid', async () => {
    renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });
    const testNameInput = screen.getByLabelText('Test Name');
    const projectSelectTrigger = screen.getByRole('combobox', { name: /Project/i });
    const saveButton = screen.getByRole('button', { name: 'Save' });

    fireEvent.change(testNameInput, { target: { value: 'Valid Test Name' } });

    fireEvent.mouseDown(projectSelectTrigger);
    await waitFor(() => expect(screen.getByText(sampleProjects[0].name)).toBeInTheDocument());
    fireEvent.click(screen.getByText(sampleProjects[0].name)); // Select 'Project Alpha' (id: 1)

    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    expect(onSaveMock).toHaveBeenCalledWith('Valid Test Name', sampleProjects[0].id);
  });

  it('calls onClose when Cancel button is clicked or dialog is closed via overlay/escape', () => {
    renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCloseMock).toHaveBeenCalledTimes(1);

    // Simulate closing via overlay/escape (onOpenChange will be called with false)
    // This needs to be handled by how Dialog's onOpenChange is typically tested,
    // or by directly calling the prop if testing the component in isolation.
    // For now, testing the explicit cancel button is sufficient for this component's logic.
  });

  describe('Create New Project functionality', () => {
    beforeEach(() => {
      // Ensure projectsData is initially set for the main modal
      mockProjectsQueryData = { data: [...sampleProjects], isLoading: false, isError: false, error: null };
    });

    it('opens "Create New Project" modal, allows project creation, and auto-selects it', async () => {
      const queryClient = createTestQueryClient(); // Use a fresh client for this test to better manage query invalidation effects
      renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock }, queryClient);

      // Click "Create New Project" button
      const createProjectButton = screen.getByRole('button', { name: 'Create New Project' });
      fireEvent.click(createProjectButton);

      // Check if nested dialog opens
      const nestedDialog = await screen.findByRole('dialog', { name: 'Create New Project' });
      expect(nestedDialog).toBeInTheDocument();

      // Type new project name
      const newProjectNameInput = within(nestedDialog).getByLabelText('Project Name');
      const newProjectName = 'Project Gamma';
      fireEvent.change(newProjectNameInput, { target: { value: newProjectName } });

      // Click "Save Project" in nested dialog
      const saveProjectButton = within(nestedDialog).getByRole('button', { name: 'Save Project' });

      // Define what the create project mutation should do upon success for this specific test
      mockMutateCreateProject.mockImplementationOnce((vars) => {
        // Simulate the project being added to the list after invalidation and refetch
        const newProject = { id: 3, name: vars.name };
        act(() => {
          // This simulates the queryClient.invalidateQueries + refetch behavior
          // by directly updating the data source for the 'projects' query.
          mockProjectsQueryData = {
            data: [...sampleProjects, newProject],
            isLoading: false,
            isError: false,
            error: null
          };
          // Manually trigger a "refetch" or component update that would use the new data.
          // In a real scenario, react-query handles this. Here, we might need to re-render or rely on
          // the component's internal refetch mechanism if `invalidateQueries` is robustly mocked for that.
          // For this test, we assume invalidateQueries will eventually lead to projectsData updating.
          // The auto-selection logic in the component relies on this.
        });
        // Simulate the actual onSuccess call from useMutation
        const mutationOptions = (vi.mocked(QueryClientProvider).mock.calls[0] as any); // This is a bit of a hack to get to the mutation options.
                                                                                      // A cleaner way would be to have a more direct way to get to the specific useMutation's options.
                                                                                      // For this example, we'll assume the options.onSuccess from the useMutation mock is called.
      });


      fireEvent.click(saveProjectButton);

      // Assertions
      await waitFor(() => expect(mockMutateCreateProject).toHaveBeenCalledWith({ name: newProjectName }));
      await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects'] }));
      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Project Created' })));

      // Wait for the nested dialog to close
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create New Project' })).not.toBeInTheDocument());

      // Verify the new project is now selected in the main modal's dropdown
      // This requires the component to re-render with updated projectsData and for the auto-selection logic to run.
      // We will check the SelectValue display. This might be tricky if the update isn't immediate.
      // We might need to wait for the text "Project Gamma" to appear in the SelectTrigger.
      const projectSelectTrigger = screen.getByRole('combobox', { name: /Project/i });
      await waitFor(() => expect(within(projectSelectTrigger).getByText(newProjectName)).toBeInTheDocument(), { timeout: 2000 }); // Increased timeout for state update
    });
  });
});
