import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RunTestNowButton from './RunTestNowButton'; // Adjust path as needed
import { useToast } from '@/hooks/use-toast'; // To verify toast calls

// Mock the actual triggerTestRun API function if it were in a separate module
// For now, useMutation will use the one defined in the component, but we can spy on its call.
// Or, more cleanly, mock the module containing triggerTestRun if it were separate.

// useToast is globally mocked in setupTests.ts. We can get a reference to the mock.
const mockedToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockedToast, // Use the specific mock instance for this test file
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('lucide-react')>();
  return {
    ...original,
    PlayCircle: (props: any) => <svg data-testid="play-icon" {...props} />,
    Loader2: (props: any) => <svg data-testid="loader-icon" {...props} />,
  };
});

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false }, // Disable retries for mutations during testing
  },
});

describe('RunTestNowButton', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    mockedToast.mockClear(); // Clear toast mock calls before each test
    // vi.spyOn(console, 'log').mockImplementation(() => {}); // Optional: spy on console.log
    // vi.spyOn(console, 'error').mockImplementation(() => {});// Optional: spy on console.error
  });

  const renderWithClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    );
  };

  it('renders the button with correct text and icon', () => {
    renderWithClient(<RunTestNowButton />);
    expect(screen.getByRole('button', { name: /Esegui test ora/i })).toBeInTheDocument();
    expect(screen.getByTestId('play-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('loader-icon')).not.toBeInTheDocument();
  });

  it('calls the mutation when clicked and shows loading state', async () => {
    renderWithClient(<RunTestNowButton />);
    const button = screen.getByRole('button', { name: /Esegui test ora/i });

    // We don't have direct access to the mock of triggerTestRun here
    // as it's defined inside the component. We test its effects.
    fireEvent.click(button);

    // Check for loading state
    expect(button).toBeDisabled();
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('play-icon')).not.toBeInTheDocument();

    // Wait for mutation to settle (success or error)
    await waitFor(() => expect(button).not.toBeDisabled(), { timeout: 2000 }); // Wait for re-enable
  });

  it('shows success toast and re-enables button on successful mutation', async () => {
    renderWithClient(<RunTestNowButton />);
    const button = screen.getByRole('button', { name: /Esegui test ora/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Test Run Started',
        description: expect.stringContaining('Test suite \'Critical Path Tests\' execution started successfully!'),
      }));
      expect(button).not.toBeDisabled();
      expect(screen.getByTestId('play-icon')).toBeInTheDocument();
    }, { timeout: 2000 }); // Timeout for mock API call
  });

  // To test error case, we'd need to make the mock triggerTestRun fail.
  // This is hard without direct mock access or splitting triggerTestRun to its own module.
  // For now, this test is more of an integration style for the success path.
  // If we could mock `triggerTestRun` to throw an error:
  /*
  it('shows error toast and re-enables button on failed mutation', async () => {
    // Mock triggerTestRun to throw an error (would need module mocking)
    // e.g. import * as api from './api'; vi.spyOn(api, 'triggerTestRun').mockRejectedValueOnce(new Error('Network Failure'));

    renderWithClient(<RunTestNowButton />);
    const button = screen.getByRole('button', { name: /Esegui test ora/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Error Triggering Test',
        description: 'Network Failure', // Or the default error message
        variant: 'destructive',
      }));
      expect(button).not.toBeDisabled();
      expect(screen.getByTestId('play-icon')).toBeInTheDocument();
    }, { timeout: 2000 });
  });
  */
});
