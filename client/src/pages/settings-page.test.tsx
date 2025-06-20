import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage from './settings-page';
import { MemoryRouter } from 'wouter';

interface Project {
  id: number;
  name: string;
  userId: number;
  createdAt: string;
}

// Mock lucide-react icons
vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal() as any;
  const genericIcon = (props: any) => React.createElement('svg', { 'data-testid': `icon-${props.name || 'generic'}` , ...props });
  const icons: Record<string, React.FC<any>> = {};
  const originalIconsList = [
    'Moon', 'Sun', 'Globe', 'Monitor', 'Settings', 'Bell', 'User', 'Save',
    'ArrowLeft', 'Loader2', 'ListTree', 'Trash2', 'PlusCircle', 'Archive'
  ];
  originalIconsList.forEach(iconName => {
    icons[iconName] = (props: any) => genericIcon({...props, name: iconName.toLowerCase()});
  });
  return { ...original, ...icons, default: (props: any) => genericIcon({...props, name: 'default-icon'}) };
});

// Mocks for hooks and services
const mockInvalidateQueries = vi.fn();
const mockDeleteProjectMutate = vi.fn();
const mockCreateProjectMutate = vi.fn();
const mockUserSettingsMutate = vi.fn();
const mockSaveSystemSettingMutate = vi.fn();

let mockProjectsQuery: any = { data: [], isLoading: false, isError: false, error: null };
let mockSettingsQuery: any = { data: {}, isLoading: false, isError: false, error: null };
let mockSystemSettingsQuery: Record<string, any> = {};

// Store actual mutation options from the component
let actualDeleteProjectMutationOptions: any = null;
let actualCreateProjectMutationOptions: any = null;
let actualUserSettingsMutationOptions: any = null;
let actualSaveSystemSettingMutationOptions: any = null;


vi.mock('@tanstack/react-query', async () => {
  const original = await vi.importActual('@tanstack/react-query') as any;
  return {
    ...original,
    useQuery: (options: { queryKey: string[] }) => {
      const key = options.queryKey[0];
      if (key === 'projects') return mockProjectsQuery;
      if (key === 'settings') return mockSettingsQuery;
      if (key === 'systemSetting') return mockSystemSettingsQuery[options.queryKey[1]] || { data: null, isLoading: false, isError: false, error: null };
      return { data: undefined, isLoading: false, isError: false, error: null };
    },
    useMutation: (options: any) => {
      // Store the component's options to allow tests to call onSuccess/onError
      // This is a simplified way; a more complex app might need mutationKeys to differentiate
      const fnStr = options.mutationFn.toString(); // Or use options.mutationKey if available
      if (fnStr.includes('/api/projects') && fnStr.includes('DELETE')) {
        actualDeleteProjectMutationOptions = options;
        return { mutate: mockDeleteProjectMutate, isPending: false, data: undefined, error: null };
      }
      if (fnStr.includes('/api/projects') && fnStr.includes('POST')) {
        actualCreateProjectMutationOptions = options;
        return { mutate: mockCreateProjectMutate, isPending: false, data: undefined, error: null };
      }
      if (fnStr.includes('/api/settings')) {
        actualUserSettingsMutationOptions = options;
        return { mutate: mockUserSettingsMutate, isPending: false, data: undefined, error: null };
      }
      if (fnStr.includes('/api/system-settings')) {
        actualSaveSystemSettingMutationOptions = options;
        return { mutate: mockSaveSystemSettingMutate, isPending: false, data: undefined, error: null };
      }
      return { mutate: vi.fn(), isPending: false, data: undefined, error: null };
    },
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
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

vi.mock('../lib/settings', () => ({
    fetchSettings: vi.fn().mockResolvedValue({
        theme: "light", defaultTestUrl: "http://example.com", playwrightBrowser: "chromium",
        playwrightHeadless: true, playwrightDefaultTimeout: 30000, playwrightWaitTime: 1000, language: "en"
    }),
}));


const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

const AllTheProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = createTestQueryClient();
  return <MemoryRouter><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></MemoryRouter>;
};

const renderSettingsPage = () => render(<SettingsPage />, { wrapper: AllTheProviders });

const sampleProjectsData: Project[] = [
  { id: 1, name: 'Project Alpha', userId: 1, createdAt: new Date().toISOString() },
  { id: 2, name: 'Project Beta', userId: 1, createdAt: new Date().toISOString() },
];

describe('SettingsPage - Project Deletion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockProjectsQuery = { data: [...sampleProjectsData], isLoading: false, isError: false, error: null };
    mockSettingsQuery = {
      data: { theme: "light", defaultTestUrl: "", playwrightBrowser: "chromium", playwrightHeadless: true, playwrightDefaultTimeout: 30000, playwrightWaitTime: 1000, language: "en" },
      isLoading: false, isError: false, error: null
    };
    mockSystemSettingsQuery = {
        'logRetentionDays': { data: { key: 'logRetentionDays', value: '7' }, isLoading: false, isError: false, error: null },
        'logLevel': { data: { key: 'logLevel', value: 'info' }, isLoading: false, isError: false, error: null },
    };
  });

  it('opens AlertDialog with project name when delete icon is clicked', async () => {
    renderSettingsPage();
    const projectToDelete = sampleProjectsData[0];

    // Wait for projects to be loaded and displayed
    await screen.findByText(projectToDelete.name);

    const deleteButtons = screen.getAllByTestId('icon-trash2');
    // Assuming the first delete button corresponds to the first project
    fireEvent.click(deleteButtons[0].closest('button')!);

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    expect(screen.getByText(/Confirm Project Deletion/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Are you sure you want to delete project "${projectToDelete.name}"`, 'i'))).toBeInTheDocument();
  });

  it('closes AlertDialog and does not call delete mutation when Cancel is clicked', async () => {
    renderSettingsPage();
    const projectToDelete = sampleProjectsData[0];
    await screen.findByText(projectToDelete.name);

    const deleteButtons = screen.getAllByTestId('icon-trash2');
    fireEvent.click(deleteButtons[0].closest('button')!);

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(mockDeleteProjectMutate).not.toHaveBeenCalled();
  });

  it('calls delete mutation, invalidates queries, shows success toast, and closes dialog on successful deletion', async () => {
    renderSettingsPage();
    const projectToDelete = sampleProjectsData[0];
    await screen.findByText(projectToDelete.name);

    const deleteButtons = screen.getAllByTestId('icon-trash2');
    fireEvent.click(deleteButtons[0].closest('button')!);

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());


    // Simulate the component's mutate function being called
    mockDeleteProjectMutate(projectToDelete.id);

    // Now, manually trigger the component's onSuccess
    if (actualDeleteProjectMutationOptions && actualDeleteProjectMutationOptions.onSuccess) {
        await act(async () => {
            actualDeleteProjectMutationOptions.onSuccess(null, projectToDelete.id, null);
        });
    } else {
        throw new Error("onSuccess handler not captured for deleteProjectMutation");
    }

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["projects"] });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Project Deleted" }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows error toast and closes dialog on failed deletion', async () => {
    renderSettingsPage();
    const projectToDelete = sampleProjectsData[0];
    const errorMessage = "Failed to delete project spectacularly";
    await screen.findByText(projectToDelete.name);

    const deleteButtons = screen.getAllByTestId('icon-trash2');
    fireEvent.click(deleteButtons[0].closest('button')!);

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());

    // Simulate the component's mutate function being called
    mockDeleteProjectMutate(projectToDelete.id);

    // Manually trigger the component's onError
    if (actualDeleteProjectMutationOptions && actualDeleteProjectMutationOptions.onError) {
        await act(async () => {
            actualDeleteProjectMutationOptions.onError(new Error(errorMessage), projectToDelete.id, null);
        });
    } else {
        throw new Error("onError handler not captured for deleteProjectMutation");
    }

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Error Deleting Project", description: errorMessage, variant: "destructive" }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
