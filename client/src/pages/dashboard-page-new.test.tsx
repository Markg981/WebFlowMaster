import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import DashboardPageNew from './dashboard-page-new';
import { MemoryRouter } from 'wouter';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// Define Project type locally for the test
interface Project {
  id: number;
  name: string;
}

// Mock lucide-react icons
vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal() as any;
  const genericIcon = (props: any) => React.createElement('svg', { 'data-testid': `icon-${props.name || 'generic'}` , ...props });
  const icons: Record<string, React.FC<any>> = {};
  const originalIcons = [
    'Globe', 'Search', 'CheckCircle', 'Settings', 'Bell', 'User', 'Loader2',
    'Play', 'Pause', 'StopCircle', 'ArrowLeft', 'XCircle', 'PlusSquare',
    'TestTube', 'MousePointerSquare', 'Trash2', 'GripVertical',
    'Keyboard', 'Clock', 'Scroll', 'CheckSquare', 'ListChecks', 'Hand', 'ChevronDown'
  ];
  originalIcons.forEach(iconName => {
    icons[iconName] = (props: any) => genericIcon({...props, name: iconName.toLowerCase()});
  });
  return { ...original, ...icons, default: (props: any) => genericIcon({...props, name: 'default-icon'}) };
});

// Mock API calls & react-query
const mockInvalidateQueries = vi.fn();
const mockSaveTestMutateSpy = vi.fn();
const mockCreateProjectMutateSpy = vi.fn(); // For SaveTestModal's own mutation

let mockProjectsQueryData: { data: Project[] | undefined; isLoading: boolean; isError: boolean; error: Error | null } = {
  data: [], isLoading: false, isError: false, error: null,
};
let mockSettingsQueryData: { data: any; isLoading: boolean; isError: boolean; error: Error | null } = {
  data: { defaultTestUrl: 'http://default.com', theme: 'light' },
  isLoading: false, isError: false, error: null,
};

// Store the actual options passed to useMutation by the component
let actualSaveTestMutationOptions: any = null;

vi.mock('@tanstack/react-query', async () => {
  const original = await vi.importActual('@tanstack/react-query') as any;
  return {
    ...original,
    useQuery: (options: { queryKey: string[] }) => {
      if (options.queryKey[0] === 'projects') return mockProjectsQueryData;
      if (options.queryKey[0] === 'settings') return mockSettingsQueryData;
      return { data: undefined, isLoading: false, isError: false, error: null };
    },
    useMutation: (options: any) => {
      // Check if this is the saveTestMutation from DashboardPageNew
      // This check might need to be more robust, e.g., based on a mutationKey if used
      const mutationFnString = options.mutationFn.toString();
      if (mutationFnString.includes('/api/tests')) { // Heuristic for saveTestMutation
        actualSaveTestMutationOptions = options; // Store the component's options
        return { mutate: mockSaveTestMutateSpy, isPending: false, data: undefined, error: null };
      }
      // Fallback for other mutations (e.g., createProject in SaveTestModal, though that's better mocked in its own test file)
      return { mutate: mockCreateProjectMutateSpy, isPending: false, data: undefined, error: null };
    },
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ toast: mockToast }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'testuser' },
    logoutMutation: { mutate: vi.fn(), isPending: false },
  }),
}));

const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({ apiRequest: mockApiRequest }));

const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

const AllTheProviders: React.FC<{ children: React.ReactNode, client?: QueryClient }> = ({ children, client }) => {
  const [queryClient] = React.useState(() => client || createTestQueryClient());
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DndProvider backend={HTML5Backend}>{children}</DndProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

const renderDashboardPageNew = (client?: QueryClient) => {
  return render(<DashboardPageNew />, { wrapper: ({children}) => <AllTheProviders client={client}>{children}</AllTheProviders> });
};

const sampleProjectsData: Project[] = [ { id: 1, name: 'Project Alpha' }, { id: 2, name: 'Project Beta' }];

describe('DashboardPageNew - General Test Saving', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockProjectsQueryData = { data: sampleProjectsData, isLoading: false, isError: false, error: null };
    mockSettingsQueryData = { data: { defaultTestUrl: 'http://default.com', theme: 'light' }, isLoading: false, isError: false, error: null };
    actualSaveTestMutationOptions = null;
    mockSaveTestMutateSpy.mockClear(); // Clear spy calls
    mockApiRequest.mockClear(); // Clear apiRequest calls
    mockToast.mockClear(); // Clear toast calls
  });

  it('saveTestMutation is called with projectId from modal and shows success toast', async () => {
    const testNameFromModal = "Test With Project ID";
    const projectIdFromModal = sampleProjectsData[1].id;
    const testUrl = "http://currenturl.com";
    const testSequenceData: any[] = []; // Keep empty for this test, as SaveTestModal mock doesn't use it
    const testElementsData: any[] = []; // Keep empty

    // Mock SaveTestModal to call its onSave prop
    vi.mock('@/components/SaveTestModal', () => ({
      default: ({ isOpen, onSave }: {
        isOpen: boolean;
        onSave: (name: string, projectId?: number) => void;
      }) => {
        useEffect(() => {
          if (isOpen) { // When DashboardPageNew sets isSaveModalOpen to true
            onSave(testNameFromModal, projectIdFromModal); // Simulate modal save
          }
        }, [isOpen, onSave]);
        return isOpen ? <div data-testid="mocked-save-test-modal-open" /> : null;
      },
    }));

    // Mock TestSequenceBuilder to allow opening the modal via onSaveTest
    // The button needs to be clickable, so testSequence.length > 0 is assumed by component
    // For the test, we'll just make the button call onSaveTest directly.
    vi.mock('@/components/TestSequenceBuilder', () => ({
        TestSequenceBuilder: ({ onSaveTest }: { onSaveTest: () => void; }) => (
            <button data-testid="tsb-save-button" onClick={onSaveTest}>Save Test in TSB</button>
        )
    }));

    mockApiRequest.mockImplementation(async (method: string, url: string, payload: any) => {
      if (url === '/api/tests' && method === 'POST') {
        return Promise.resolve({ id: 12345, ...payload }); // Simulate successful save
      }
      return Promise.resolve({});
    });

    renderDashboardPageNew();

    // Simulate changing URL in the page to match what we expect in payload
    const urlInput = screen.getByPlaceholderText('https://example.com');
    fireEvent.change(urlInput, { target: { value: testUrl } });

    // Click the mocked TestSequenceBuilder's save button
    // This calls `handleSaveTest` in DashboardPageNew, which sets `isSaveModalOpen = true`
    // This, in turn, makes the mocked SaveTestModal call its `onSave` prop (which is `handleConfirmSaveTest`)
    fireEvent.click(screen.getByTestId('tsb-save-button'));

    // Assert that saveTestMutation.mutate (mockSaveTestMutateSpy) was called with the correct payload
    await waitFor(() => {
      expect(mockSaveTestMutateSpy).toHaveBeenCalledWith(expect.objectContaining({
        name: testNameFromModal,
        projectId: projectIdFromModal,
        url: testUrl,
        // sequence and elements will be DashboardPageNew's current state (empty arrays in this test setup)
      }));
    });

    // Now, simulate the success of the mutation by calling the stored onSuccess handler
    // This is to check if DashboardPageNew's own onSuccess logic (showing toast) works.
    const mockSavedTestData = { id: 12345, name: testNameFromModal, projectId: projectIdFromModal };
    if (actualSaveTestMutationOptions && actualSaveTestMutationOptions.onSuccess) {
        act(() => {
            actualSaveTestMutationOptions.onSuccess(mockSavedTestData, {/* variables */}, {/* context */});
        });
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Test saved",
      }));
    });
  });

  it('shows error toast when saveTestMutation (POST /api/tests) fails', async () => {
    const testNameFromModal = "My Failing Test";
    const projectIdFromModal = sampleProjectsData[1].id;
    const errorMessage = "Simulated Server Error For Save";

    vi.mock('@/components/SaveTestModal', () => ({
      default: ({ isOpen, onSave }: { isOpen: boolean; onSave: (name: string, projectId?: number) => void; }) => {
        useEffect(() => { if (isOpen) { onSave(testNameFromModal, projectIdFromModal); } }, [isOpen, onSave]);
        return isOpen ? <div data-testid="mocked-save-test-modal-open" /> : null;
      },
    }));
    vi.mock('@/components/TestSequenceBuilder', () => ({
      TestSequenceBuilder: ({ onSaveTest }: { onSaveTest: () => void; }) => (
          <button data-testid="tsb-save-button" onClick={onSaveTest}>Save Test in TSB</button>
      )
    }));

    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (url === '/api/tests' && method === 'POST') {
        return Promise.reject(new Error(errorMessage)); // Simulate failed save
      }
      return Promise.resolve({});
    });

    renderDashboardPageNew();
    fireEvent.click(screen.getByTestId('tsb-save-button'));

    await waitFor(() => {
      expect(mockSaveTestMutateSpy).toHaveBeenCalledWith(expect.objectContaining({
        name: testNameFromModal,
        projectId: projectIdFromModal,
      }));
    });

    // Simulate the error of the mutation by calling the stored onError handler
    if (actualSaveTestMutationOptions && actualSaveTestMutationOptions.onError) {
        act(() => {
            actualSaveTestMutationOptions.onError(new Error(errorMessage), {/* variables */}, {/* context */});
        });
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to save test",
        description: errorMessage,
        variant: "destructive",
      }));
    });
  });
});
