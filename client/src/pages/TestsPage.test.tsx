import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestsPage from './TestsPage'; // Adjust path if necessary
import { MemoryRouter } from 'wouter'; // TestsPage uses Link from wouter

// Mock lucide-react icons to avoid rendering them in tests
vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    // Mock specific icons used in TestsPage if they cause issues, or return a generic component
    FileText: () => <svg data-testid="icon-filetext" />,
    ArrowLeft: () => <svg data-testid="icon-arrowleft" />,
    PlusCircle: () => <svg data-testid="icon-pluscircle" />,
    Search: () => <svg data-testid="icon-search" />,
    RefreshCcw: () => <svg data-testid="icon-refreshccw" />,
    ChevronLeft: () => <svg data-testid="icon-chevronleft" />,
    ChevronRight: () => <svg data-testid="icon-chevronright" />,
    Play: () => <svg data-testid="icon-play" />,
    CalendarDays: () => <svg data-testid="icon-calendardays" />,
    MoreVertical: () => <svg data-testid="icon-morevertical" />,
    Edit3: () => <svg data-testid="icon-edit3" />,
    Trash2: () => <svg data-testid="icon-trash2" />,
    Copy: () => <svg data-testid="icon-copy" />,
    // Add any other icons used by the component
  };
});


// Mock react-query
const mockInvalidateQueries = vi.fn();
const mockMutate = vi.fn();
const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn(() => ({
  mutate: mockMutate,
  isPending: false,
  // Add other properties like isError, error if needed by your component
}));

vi.mock('@tanstack/react-query', async () => {
  const original = await vi.importActual('@tanstack/react-query');
  return {
    ...original,
    useQuery: (options: any) => mockUseQuery(options),
    useMutation: (options: any) => mockUseMutation(options),
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

// Helper to create a new QueryClient for each test to ensure isolation
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // Disable retries for tests
      staleTime: Infinity, // Prevent immediate refetching
    },
  },
});

const AllTheProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queryClient] = React.useState(() => createTestQueryClient());
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </MemoryRouter>
  );
};

const renderTestsPage = () => {
  return render(<TestsPage />, { wrapper: AllTheProviders });
};

// Sample data for schedules (mirroring backend structure)
const sampleSchedules = [
  { id: 's1', scheduleName: 'Daily Sync', testPlanId: 'tp1', testPlanName: 'Plan A', frequency: 'Daily', nextRunAt: Math.floor(new Date('2024-01-01T10:00:00Z').getTime() / 1000), createdAt: Math.floor(new Date().getTime() / 1000) - 3600, updatedAt: null },
  { id: 's2', scheduleName: 'Weekly Report', testPlanId: 'tp2', testPlanName: 'Plan B', frequency: 'Weekly', nextRunAt: Math.floor(new Date('2024-01-07T18:00:00Z').getTime() / 1000), createdAt: Math.floor(new Date().getTime() / 1000) - 7200, updatedAt: null },
];

describe('TestsPage - Schedules Tab', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockInvalidateQueries.mockClear();
    mockMutate.mockClear();
    mockUseQuery.mockReset();
    mockUseMutation.mockReset().mockImplementation(() => ({ // Ensure mockUseMutation is reset correctly
        mutate: mockMutate,
        isPending: false,
    }));

    // Default mock for useQuery (schedules) - success state
    mockUseQuery.mockReturnValue({
      data: sampleSchedules,
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it('renders the Schedules tab and displays schedules', async () => {
    renderTestsPage();

    // Click on the "Schedules" tab
    fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));

    // Check if schedules are displayed
    await waitFor(() => {
      expect(screen.getByText('Daily Sync')).toBeInTheDocument();
      expect(screen.getByText('Weekly Report')).toBeInTheDocument();
    });
    // Check for formatted date (example, actual format depends on date-fns output)
    // Example: format(fromUnixTime(sampleSchedules[0].nextRunAt), 'yyyy-MM-dd HH:mm') -> "2024-01-01 10:00"
    expect(screen.getByText(new RegExp(sampleSchedules[0].scheduleName))).toBeInTheDocument();
    expect(screen.getByText(/2024-01-01 10:00/i)).toBeInTheDocument();
  });

  it('shows loading state for schedules', async () => {
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      error: null,
    });
    renderTestsPage();
    fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));
    expect(screen.getByText('Loading schedules...')).toBeInTheDocument();
  });

  it('shows error state for schedules', async () => {
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: { message: 'Failed to fetch' },
    });
    renderTestsPage();
    fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));
    expect(screen.getByText(/Error loading schedules: Failed to fetch/i)).toBeInTheDocument();
  });

  // More tests will be added here for Create, Edit, Delete, Search
});

describe('TestsPage - Create Schedule', () => {
    beforeEach(() => {
        mockInvalidateQueries.mockClear();
        mockMutate.mockClear();
        mockUseQuery.mockReset().mockReturnValue({ data: sampleSchedules, isLoading: false, isError: false, error: null });
        mockUseMutation.mockReset().mockImplementation((options) => ({
            mutate: (vars: any) => {
                mockMutate(vars); // Call the spy
                // Simulate onSuccess behavior from react-query options if provided
                if (options && options.onSuccess) {
                    options.onSuccess({}, vars, {});
                }
            },
            isPending: false,
        }));
    });

    it('opens Create Schedule modal, allows input, and submits', async () => {
        renderTestsPage();
        fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));

        // Click "Create Schedule" button
        fireEvent.click(screen.getByRole('button', { name: /Create Schedule/i }));

        // Modal should be open
        expect(screen.getByRole('dialog', { name: /Create New Schedule/i })).toBeInTheDocument();

        // Fill form
        fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'New Test Schedule' } });
        fireEvent.change(screen.getByLabelText(/Test Plan ID/i), { target: { value: 'tp-new' } });
        fireEvent.change(screen.getByLabelText(/Test Plan Name/i), { target: { value: 'My New Test Plan' } });
        // For Select (Frequency), assuming Radix Select. This might need adjustment based on actual component structure.
        // This is a simplified way; real interaction might involve clicking trigger then item.
        // For now, we'll assume direct change works or test this part more deeply if Select is complex.
        // fireEvent.change(screen.getByLabelText(/Frequency/i), { target: { value: 'Monthly' } });
        // More robust:
        const frequencySelect = screen.getByRole('combobox', { name: /Frequency/i }); // This might be the trigger
        fireEvent.mouseDown(frequencySelect); // Open select
        // Wait for items to appear if they are dynamically rendered
        // fireEvent.click(await screen.findByText('Monthly')); // Click the option
        // For now, we'll skip direct select interaction due to complexity with ShadCN/Radix.
        // We'll assume `newFrequency` state is correctly set by `onValueChange` which is hard to test here.

        fireEvent.change(screen.getByLabelText(/Next Run At/i), { target: { value: '2024-12-31T12:00' } });

        // Click "Create Schedule" button in modal footer
        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

        await waitFor(() => {
            expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
                scheduleName: 'New Test Schedule',
                testPlanId: 'tp-new',
                testPlanName: 'My New Test Plan',
                // frequency: 'Monthly', // This depends on how Select is handled
                nextRunAt: Math.floor(new Date('2024-12-31T12:00:00Z').getTime() / 1000),
            }));
            expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['schedules'] });
        });
        // Modal should close on success (assuming onSuccess closes it)
        // This requires mockUseMutation's onSuccess to simulate modal closing if it's part of that logic
        // For now, we check if mutate was called and queries invalidated.
    });
});
// Further describe blocks for Edit, Delete, Search...

describe('TestsPage - Edit Schedule', () => {
    beforeEach(() => {
        mockInvalidateQueries.mockClear();
        mockMutate.mockClear();
        mockUseQuery.mockReset().mockReturnValue({ data: sampleSchedules, isLoading: false, isError: false, error: null });
        mockUseMutation.mockReset().mockImplementation((options) => ({
            mutate: (vars: any) => {
                mockMutate(vars); // Spy on the original mockMutate
                if (options && options.onSuccess) {
                    act(() => { options.onSuccess({}, vars, {}); });
                }
            },
            isPending: false,
        }));
    });

    it('opens Edit Schedule modal, submits changes, and closes modal on success', async () => {
        renderTestsPage();
        fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));

        const moreButtons = await screen.findAllByTestId('icon-morevertical');
        fireEvent.click(moreButtons[0].closest('button')!);
        fireEvent.click(await screen.findByText('Edit'));

        const dialog = screen.getByRole('dialog', { name: new RegExp(`Edit Schedule: ${sampleSchedules[0].scheduleName}`, 'i') });
        expect(dialog).toBeInTheDocument();

        const newDateTime = '2025-02-15T14:30';
        const nextRunAtInput = within(dialog).getByLabelText(/Next Run At/i); // Ensure input is within dialog
        fireEvent.change(nextRunAtInput, { target: { value: newDateTime } });

        fireEvent.click(within(dialog).getByRole('button', { name: /Save Changes/i }));

        await waitFor(() => {
            expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
                id: sampleSchedules[0].id,
                nextRunAt: Math.floor(new Date(newDateTime).getTime() / 1000),
            }));
            expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['schedules'] });
        });
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: new RegExp(`Edit Schedule: ${sampleSchedules[0].scheduleName}`, 'i') })).not.toBeInTheDocument();
        });
    });

    it('shows alert on schedule update failure', async () => {
        const errorMessage = "Update Failed";
        mockUseMutation.mockReset().mockImplementation((options) => ({
            mutate: (vars: any) => {
                mockMutate(vars);
                if (options && options.onError) {
                    act(() => { options.onError(new Error(errorMessage), vars, {}); });
                }
            },
            isPending: false,
        }));
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        renderTestsPage();
        fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));
        const moreButtons = await screen.findAllByTestId('icon-morevertical');
        fireEvent.click(moreButtons[0].closest('button')!);
        fireEvent.click(await screen.findByText('Edit'));

        fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining(errorMessage)));
        expect(screen.getByRole('dialog', { name: new RegExp(`Edit Schedule: ${sampleSchedules[0].scheduleName}`, 'i') })).toBeInTheDocument(); // Stays open
        alertSpy.mockRestore();
    });
});

describe('TestsPage - Delete Schedule', () => {
    beforeEach(() => {
        mockInvalidateQueries.mockClear();
        mockMutate.mockClear();
        mockUseQuery.mockReset().mockReturnValue({ data: sampleSchedules, isLoading: false, isError: false, error: null });
        mockUseMutation.mockReset().mockImplementation((options) => ({
            mutate: (vars: any) => {
                mockMutate(vars);
                if (options && options.onSuccess) {
                     act(() => { options.onSuccess(null, vars, {}); });
                }
            },
            isPending: false,
        }));
    });

    it('opens Delete Confirmation, confirms deletion, and closes dialog on success', async () => {
        renderTestsPage();
        fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));

        const moreButtons = await screen.findAllByTestId('icon-morevertical');
        fireEvent.click(moreButtons[0].closest('button')!);
        fireEvent.click(await screen.findByText('Delete'));

        const dialog = screen.getByRole('alertdialog', { name: /Confirm Deletion/i });
        expect(dialog).toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => {
            expect(mockMutate).toHaveBeenCalledWith(sampleSchedules[0].id);
            expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['schedules'] });
        });
        await waitFor(() => {
            expect(screen.queryByRole('alertdialog', { name: /Confirm Deletion/i })).not.toBeInTheDocument();
        });
    });

    it('shows alert on schedule deletion failure', async () => {
        const errorMessage = "Delete Failed";
        mockUseMutation.mockReset().mockImplementation((options) => ({
            mutate: (vars: any) => {
                mockMutate(vars);
                if (options && options.onError) {
                    act(() => { options.onError(new Error(errorMessage), vars, {}); });
                }
            },
            isPending: false,
        }));
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        renderTestsPage();
        fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));
        const moreButtons = await screen.findAllByTestId('icon-morevertical');
        fireEvent.click(moreButtons[0].closest('button')!);
        fireEvent.click(await screen.findByText('Delete'));

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining(errorMessage)));
        // Dialog should close even on error as per current component logic in onError
        await waitFor(() => {
             expect(screen.queryByRole('alertdialog', { name: /Confirm Deletion/i })).not.toBeInTheDocument();
        });
        alertSpy.mockRestore();
    });
});

describe('TestsPage - Search Schedules', () => {
    beforeEach(() => {
        mockUseQuery.mockReset().mockReturnValue({ data: sampleSchedules, isLoading: false, isError: false, error: null });
    });

    it('filters schedules based on search term', async () => {
        renderTestsPage();
        fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));

        // Initially both schedules should be visible
        expect(screen.getByText('Daily Sync')).toBeInTheDocument();
        expect(screen.getByText('Weekly Report')).toBeInTheDocument();

        // Type into search input
        const searchInput = screen.getByPlaceholderText('Search schedules...');
        fireEvent.change(searchInput, { target: { value: 'Daily' } });

        // Only "Daily Sync" should be visible
        await waitFor(() => {
            expect(screen.getByText('Daily Sync')).toBeInTheDocument();
            expect(screen.queryByText('Weekly Report')).not.toBeInTheDocument();
        });

        // Clear search
        fireEvent.change(searchInput, { target: { value: '' } });
        await waitFor(() => {
            expect(screen.getByText('Daily Sync')).toBeInTheDocument();
            expect(screen.getByText('Weekly Report')).toBeInTheDocument();
        });
    });
});

// Refinement for Create Schedule tests to include error handling and modal closing
describe('TestsPage - Create Schedule (Refined)', () => {
    beforeEach(() => {
        mockInvalidateQueries.mockClear();
        mockMutate.mockClear();
        mockUseQuery.mockReset().mockReturnValue({ data: sampleSchedules, isLoading: false, isError: false, error: null });
    });

    it('closes modal on successful schedule creation', async () => {
        mockUseMutation.mockImplementation((options) => ({
            mutate: (vars: any) => {
                mockMutate(vars); // Spy on mutate call
                if (options && options.onSuccess) {
                    act(() => { // Wrap state updates in act
                        options.onSuccess({}, vars, {});
                    });
                }
            },
            isPending: false,
        }));

        renderTestsPage();
        fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));
        fireEvent.click(screen.getByRole('button', { name: /Create Schedule/i }));

        expect(screen.getByRole('dialog', { name: /Create New Schedule/i })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Successful Schedule' } });
        fireEvent.change(screen.getByLabelText(/Next Run At/i), { target: { value: '2024-11-01T10:00' } });

        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

        await waitFor(() => {
            expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['schedules'] });
        });
        // Check if modal is closed
        // The component's onSuccess should set isCreateModalOpen to false
        // We need to wait for the state update and re-render
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: /Create New Schedule/i })).not.toBeInTheDocument();
        });
    });

    it('shows alert on schedule creation failure', async () => {
        const errorMessage = "Network Error";
        mockUseMutation.mockImplementation((options) => ({
            mutate: (vars: any) => {
                mockMutate(vars);
                if (options && options.onError) {
                     act(() => {
                        options.onError(new Error(errorMessage), vars, {});
                     });
                }
            },
            isPending: false,
        }));

        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        renderTestsPage();
        fireEvent.click(screen.getByRole('tab', { name: /Schedules/i }));
        fireEvent.click(screen.getByRole('button', { name: /Create Schedule/i }));

        fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Failing Schedule' } });
        fireEvent.change(screen.getByLabelText(/Next Run At/i), { target: { value: '2024-11-01T10:00' } });

        fireEvent.click(screen.getByRole('button', { name: 'Create Schedule' }));

        await waitFor(() => {
            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining(errorMessage));
        });

        // Modal should still be open after error (current behavior)
        expect(screen.getByRole('dialog', { name: /Create New Schedule/i })).toBeInTheDocument();

        alertSpy.mockRestore();
    });
});
