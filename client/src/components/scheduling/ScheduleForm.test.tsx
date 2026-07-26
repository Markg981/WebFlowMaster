import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ScheduleForm from './ScheduleForm';
import { FREQUENCY_OPTIONS, BROWSER_OPTIONS } from '@/lib/schemas/scheduleFormSchema';
import { Toaster } from '@/components/ui/toaster'; // Needed for useToast

// Mock fetchTestPlansAPI
vi.mock('@/lib/api/test-plans', () => ({
  fetchTestPlansAPI: vi.fn(() => Promise.resolve([
    { id: 'plan1', name: 'Test Plan 1' },
    { id: 'plan2', name: 'Test Plan 2' },
  ])),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // Disable retries for tests
    },
  },
});

/**
 * Radix opens a Select on keyboard activation and only when the trigger has focus; JSDOM
 * has no PointerEvent, so a click on the trigger does nothing.
 */
const openSelect = async (trigger: HTMLElement) => {
  await waitFor(() => expect(trigger).not.toBeDisabled());
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
};

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    {children}
    <Toaster />
  </QueryClientProvider>
);

describe('ScheduleForm', () => {
  const mockOnSubmit = vi.fn(() => Promise.resolve());
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear(); // Clear query cache before each test
  });

  it('renders all basic fields', async () => {
    render(
      <ScheduleForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} isSubmitting={false} />,
      { wrapper: Wrapper }
    );

    expect(screen.getByLabelText(/Schedule Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Test Plan/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Frequency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Next Run At \(UTC\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Environment/i)).toBeInTheDocument();
    expect(screen.getByText('Browsers')).toBeInTheDocument(); // group caption, not a control label
    BROWSER_OPTIONS.forEach(opt => {
      expect(screen.getByLabelText(new RegExp(opt.label, "i"))).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Retry on Failure/i)).toBeInTheDocument();
    expect(document.getElementById('notificationConfigOverride')).toBeInTheDocument();
    expect(document.getElementById('executionParameters')).toBeInTheDocument();
    expect(screen.getByLabelText(/Schedule Active/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Schedule/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();

    // Wait for test plans to load and appear in the select
    await waitFor(() => {
      expect(screen.queryByText('Loading test plans...')).not.toBeInTheDocument();
    });
    // Check if Test Plan 1 is available after loading
    // User needs to click the trigger first to open the select content
    // fireEvent.click(screen.getByLabelText(/Test Plan/i)); // This might not be the trigger itself
    // For Shadcn Select, you might need to target the trigger more specifically
    // await screen.findByText('Test Plan 1'); // This checks if it's rendered somewhere
  });

  it('shows validation errors for required fields on submit', async () => {
    render(
      <ScheduleForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} isSubmitting={false} />,
      { wrapper: Wrapper }
    );

    const submitButton = screen.getByRole('button', { name: /Create Schedule/i });
    await waitFor(() => expect(submitButton).not.toBeDisabled());
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Schedule name is required')).toBeInTheDocument();
      expect(screen.getByText('Test plan is required')).toBeInTheDocument();
      // Next Run At is a date object, Zod handles its required_error
      // Browsers are optional overall (nullable), but if provided, min 1. Default has one.
    });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with transformed data when form is valid', async () => {
    render(
      <ScheduleForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} isSubmitting={false} />,
      { wrapper: Wrapper }
    );

    // Wait for plans to load
    await waitFor(() => expect(screen.queryByText('Loading test plans...')).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Schedule Name/i), { target: { value: 'My Test Schedule' } });

    // Select Test Plan
    await openSelect(screen.getByLabelText(/Test Plan/i));
    fireEvent.click(await screen.findByRole('option', { name: 'Test Plan 1' }));

    // Select Frequency (default is 'Once', which is fine)
    // Select Next Run At (default is new Date(), which is fine)

    // Select a browser (default is Chromium, which is fine)

    fireEvent.click(screen.getByRole('button', { name: /Create Schedule/i }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const submittedData = mockOnSubmit.mock.calls[0][0];
    expect(submittedData.scheduleName).toBe('My Test Schedule');
    expect(submittedData.testPlanId).toBe('plan1');
    expect(submittedData.frequency).toBe(FREQUENCY_OPTIONS[0].value); // Default 'Once'
    // The transform keeps a Date; the API client turns it into an ISO string on send.
    expect(submittedData.nextRunAt).toBeInstanceOf(Date);
    expect(submittedData.isActive).toBe(true);
  });

  it('displays custom CRON input when frequency is "custom_cron"', async () => {
    render(
      <ScheduleForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} isSubmitting={false} />,
      { wrapper: Wrapper }
    );

    await openSelect(screen.getByLabelText(/Frequency/i));
    fireEvent.click(await screen.findByRole('option', { name: 'Custom CRON' }));

    const cronInput = await waitFor(() => {
      const el = document.getElementById('customCronExpression');
      expect(el).toBeInTheDocument();
      return el as HTMLInputElement;
    });

    fireEvent.change(cronInput, { target: { value: '0 0 * * *' } });
    // Submit and check payload
     fireEvent.click(screen.getByRole('button', { name: /Create Schedule/i }));
     // ... (add more assertions for valid submission with CRON)
  });

  it('populates form with initialData for editing', async () => {
    const initialScheduleData: TestPlanScheduleEnhanced = {
      id: 'sched1',
      scheduleName: 'Existing Schedule',
      testPlanId: 'plan2',
      testPlanName: 'Test Plan 2',
      frequency: 'daily',
      nextRunAt: new Date('2025-07-15T10:00:00Z'),
      environment: 'QA',
      browsers: ['firefox'],
      isActive: false,
      retryOnFailure: 'once',
      notificationConfigOverride: { emails: ['test@example.com'] },
      executionParameters: { custom: 'value' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    render(
      <ScheduleForm initialData={initialScheduleData} onSubmit={mockOnSubmit} onCancel={mockOnCancel} isSubmitting={false} />,
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(screen.queryByText('Loading test plans...')).not.toBeInTheDocument());

    expect(screen.getByLabelText(/Schedule Name/i)).toHaveValue('Existing Schedule');
    // Check selected value for Test Plan (requires interaction or checking selected value in DOM)
    // For Shadcn Select, this is tricky. We can check the displayed value if SelectValue is used correctly.
    // await screen.findByDisplayValue('Test Plan 2'); // This might not work directly with Shadcn select

    expect(screen.getByLabelText(/Environment/i)).toHaveValue('QA');

    // Check if Firefox browser checkbox is checked
    expect(screen.getByLabelText('Firefox')).toBeChecked();
    expect(screen.getByLabelText('Schedule Active')).not.toBeChecked();

    // Check retry on failure selected value
    // Similar to test plan, need to interact or check displayed value.

    expect(document.getElementById('notificationConfigOverride')).toHaveValue(
      JSON.stringify({ emails: ['test@example.com'] }, null, 2),
    );
    expect(document.getElementById('executionParameters')).toHaveValue(
      JSON.stringify({ custom: 'value' }, null, 2),
    );

    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
  });

});
