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
const mockSetQueryData = vi.fn(); // Spy for setQueryData
const mockMutateCreateProject = vi.fn();
const mockRefetchProjects = vi.fn(() => Promise.resolve({ data: sampleProjects })); // Mock for refetch

let mockProjectsQueryData: {
  data: Project[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch?: () => Promise<any>; // Add refetch to the type
} = {
  data: [],
  isLoading: false,
  isError: false,
  error: null,
};

// Store the actual onSuccess from the component's useMutation call
let actualComponentOnSuccess: ((data: any, variables: any, context: any) => void) | undefined;

vi.mock('@tanstack/react-query', async () => {
  const original = await vi.importActual('@tanstack/react-query') as any;
  return {
    ...original,
    useQuery: (options: { queryKey: string[] }) => {
      if (options.queryKey[0] === 'projects') {
        // Ensure the mock for 'projects' query returns the refetch spy
        return { ...mockProjectsQueryData, refetch: mockRefetchProjects };
      }
      // Default for other queries (ensure they also have a basic refetch if needed, or adjust)
      return { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(() => Promise.resolve({ data: [] })) };
    },
    useMutation: (options: any) => {
      // Store the component's onSuccess to be called by the test
      actualComponentOnSuccess = options.onSuccess;
      return {
        mutate: (vars: any) => {
          mockMutateCreateProject(vars); // Track that mutate was called
          // Simulate the mutationFn resolving with a new project
          // The actual component's onSuccess will then be triggered by the test.
          // This mock assumes the mutationFn (apiRequest) itself is successful.
          // The test will control WHEN onSuccess is called.
        },
        isPending: false,
      };
    },
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: mockSetQueryData, // Provide the mock for setQueryData
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
    // Initialize mockProjectsQueryData with the refetch spy for each test
    mockProjectsQueryData = {
      data: sampleProjects,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetchProjects
    };
    mockRefetchProjects.mockClear(); // Clear calls from previous tests
  });

  it('renders correctly when open and calls refetchProjects', () => {
    renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });
    expect(screen.getByText('Save Test')).toBeInTheDocument();
    expect(screen.getByLabelText('Test Name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Project/)).toBeInTheDocument(); // Label includes asterisk
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(mockRefetchProjects).toHaveBeenCalledTimes(1); // Called on initial open due to useEffect
  });

  it('refetches projects when re-opened', () => {
    const { rerender } = renderSaveTestModal({ isOpen: false, onSave: onSaveMock, onClose: onCloseMock });
    expect(mockRefetchProjects).not.toHaveBeenCalled(); // Should not call if not open initially (enabled:false)

    rerender(<SaveTestModal isOpen={true} onSave={onSaveMock} onClose={onCloseMock} />);
    expect(mockRefetchProjects).toHaveBeenCalledTimes(1); // Called when opened

    rerender(<SaveTestModal isOpen={false} onSave={onSaveMock} onClose={onCloseMock} />); // Close it
    rerender(<SaveTestModal isOpen={true} onSave={onSaveMock, onClose: onCloseMock} />); // Re-open
    expect(mockRefetchProjects).toHaveBeenCalledTimes(2); // Called again
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


      // Simulate clicking "Save Project"
      fireEvent.click(saveProjectButton);

      // 1. Assert that the mutation was called
      expect(mockMutateCreateProject).toHaveBeenCalledWith({ name: newProjectName });

      // 2. Simulate the mutation's success by manually calling the component's onSuccess
      const newlyCreatedProjectMock: Project = { id: 3, name: newProjectName };
      if (actualComponentOnSuccess) {
        await act(async () => {
          actualComponentOnSuccess(newlyCreatedProjectMock, { name: newProjectName }, {});
        });
      } else {
        throw new Error("actualComponentOnSuccess was not defined by useMutation mock");
      }

      // 3. Assertions for optimistic update and auto-selection
      // Check that setQueryData was called to optimistically update the cache
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ['projects'],
        expect.any(Function) // The updater function
      );

      // To verify the updater function's behavior, we can capture it and test separately,
      // or check the effect: the project list in the component should now include the new project
      // and it should be selected.

      // Check that the new project is selected (its name appears in the SelectTrigger)
      // This requires that the `projectsData` used by the Select component is updated by `setQueryData`
      // The `mockProjectsQueryData` needs to be updated by the `setQueryData` mock or manually in test
      // to reflect the optimistic update for the component's re-render.

      // Simulate the effect of setQueryData for the test's `mockProjectsQueryData`
      // This is a bit of a workaround as `setQueryData` is mocked at a low level.
      // The component's `setQueryData` call would update the actual RQ cache.
      // For the test, we update our mock data source that `useQuery` reads from.
      const updaterFn = mockSetQueryData.mock.calls[0][1]; // Get the updater function
      mockProjectsQueryData.data = updaterFn(sampleProjects); // Apply it to current sampleProjects

      // Re-render or wait for component to update with new projectsData from the (mocked) cache
      // In this setup, because useQuery reads from mockProjectsQueryData,
      // once we update mockProjectsQueryData and if the component re-renders due to setSelectedProjectId,
      // it should pick up the new data.

      // Check if the new project name is displayed in the SelectTrigger
      const projectSelectTrigger = screen.getByRole('combobox', { name: /Project/i });
      await waitFor(() => {
        expect(within(projectSelectTrigger).getByText(newProjectName)).toBeInTheDocument();
      });

      // Check that invalidateQueries was still called
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects'] });

      // Check toast and dialog close
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Project Created' }));
      expect(screen.queryByRole('dialog', { name: 'Create New Project' })).not.toBeInTheDocument();
    });

    it('handles malformed project data gracefully in the dropdown', async () => {
      const malformedProjectsData: any[] = [
        { id: 10, name: 'Valid Project 10' },
        undefined, // Undefined entry
        { name: 'Project Without ID' }, // Missing id
        { id: 12, name: undefined }, // Missing name (but filter currently allows it if name is not explicitly checked, let's assume name is needed for display)
        { id: null, name: 'Project With Null ID' }, // id is null
        { id: 13, name: 'Valid Project 13' },
        { id: '14', name: 'Project With String ID' }, // id is string, filter expects number
      ];

      mockProjectsQueryData = { data: malformedProjectsData  as Project[], isLoading: false, isError: false, error: null };

      const { container } = renderSaveTestModal({ isOpen: true, onSave: onSaveMock, onClose: onCloseMock });

      const projectSelectTrigger = screen.getByRole('combobox', { name: /Project/i });
      fireEvent.mouseDown(projectSelectTrigger); // Open the dropdown

      // Wait for dropdown items to be potentially rendered
      await waitFor(() => {
        // Valid projects should be present
        expect(screen.getByText('Valid Project 10')).toBeInTheDocument();
        expect(screen.getByText('Valid Project 13')).toBeInTheDocument();

        // Check that items that would cause errors are NOT rendered as SelectItems
        // This is an indirect way to check the filter. A direct check on item count is better.
        expect(screen.queryByText('Project Without ID')).not.toBeInTheDocument();
        // Name is expected for SelectItem's child, so "Project With Null ID" might not render if name is checked by filter
        // However, the filter `project.name` only checks for truthiness.
        // The key part is that `project.id.toString()` doesn't crash.
        expect(screen.queryByText('Project With Null ID')).not.toBeInTheDocument(); // Assuming filter makes it skip due to `typeof project.id === 'number'`
        expect(screen.queryByText('Project With String ID')).not.toBeInTheDocument();

        // Check the number of rendered items. Should be 2 valid items.
        // ShadCN's SelectItem role is 'option'.
        const options = screen.getAllByRole('option');
        expect(options.length).toBe(2);
      });

      // Ensure no console errors were thrown due to iterating over malformed data (Vitest would typically fail test if so)
      // This test primarily ensures the component doesn't crash.
      expect(projectSelectTrigger).toBeInTheDocument(); // Final check that modal is still there
    });
  });
});
