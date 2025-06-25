import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n'; // Your i18n instance
import ScheduleWizard from './ScheduleWizard';
import { TestPlanScheduleWithPlanName } from '@/lib/api/schedules';
import * as testPlansApi from '@/lib/api/test-plans';
import * as schedulesApi from '@/lib/api/schedules';

// Mocks
vi.mock('@/lib/api/test-plans');
vi.mock('@/lib/api/schedules');

// useToast is globally mocked in setupTests.ts, so we can spy on its returned toast function
import { useToast } from '@/hooks/use-toast';
const { toast } = useToast(); // Get the mocked toast function

const mockTestPlans = [
  { id: 'tp1', name: 'Test Plan Alpha' },
  { id: 'tp2', name: 'Test Plan Beta' },
];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // Disable retries for tests
      gcTime: Infinity, // Prevent garbage collection during tests
    },
  },
});

const AllTheProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        {children}
      </I18nextProvider>
    </QueryClientProvider>
  );
};

describe('ScheduleWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear(); // Clear TanStack Query cache
    (testPlansApi.fetchTestPlansAPI as vi.Mock).mockResolvedValue(mockTestPlans);
    (schedulesApi.createSchedule as vi.Mock).mockResolvedValue({ id: 'new-sched-1', name: 'New Schedule' });
    (schedulesApi.updateSchedule as vi.Mock).mockResolvedValue({ id: 'edited-sched-1', name: 'Updated Schedule' });
  });

  const renderWizard = (props: Partial<React.ComponentProps<typeof ScheduleWizard>> = {}) => {
    const defaultProps: React.ComponentProps<typeof ScheduleWizard> = {
      isOpen: true,
      onClose: vi.fn(),
      onScheduleSaved: vi.fn(),
      ...props,
    };
    return render(<ScheduleWizard {...defaultProps} />, { wrapper: AllTheProviders });
  };

  it('renders step 1 correctly with test plans loaded', async () => {
    renderWizard();
    expect(await screen.findByText('scheduleWizard.createTitle')).toBeInTheDocument(); // Using a key from the component
    expect(screen.getByText('scheduleWizard.steps.step1.title')).toHaveClass('font-semibold'); // Active step

    expect(screen.getByLabelText('scheduleWizard.steps.step1.testPlanLabel')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('scheduleWizard.loading')).not.toBeInTheDocument());
    // Find by role combobox for SelectTrigger, then click to open
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /select test plan/i }));
    expect(await screen.findByText('Test Plan Alpha')).toBeInTheDocument();
    expect(screen.getByText('Test Plan Beta')).toBeInTheDocument();
  });

  it('allows navigation through steps', async () => {
    renderWizard();
    // Step 1
    fireEvent.change(screen.getByLabelText('scheduleWizard.steps.step1.scheduleNameLabel'), { target: { value: 'My Test Schedule' } });
    // Select a test plan (assuming first one if not preselected)
    const testPlanSelect = screen.getByRole('combobox', { name: /select test plan/i });
    fireEvent.mouseDown(testPlanSelect);
    fireEvent.click(await screen.findByText(mockTestPlans[0].name));

    await act(async () => {
      fireEvent.click(screen.getByText('scheduleWizard.buttons.next'));
    });
    expect(screen.getByText('scheduleWizard.steps.step2.title')).toHaveClass('font-semibold'); // Now on Step 2

    // Step 2: Select a browser
    fireEvent.click(screen.getByLabelText('chromium')); // Assuming 'chromium' is a label for a checkbox

    await act(async () => {
      fireEvent.click(screen.getByText('scheduleWizard.buttons.next'));
    });
    expect(screen.getByText('scheduleWizard.steps.step3.title')).toHaveClass('font-semibold'); // Now on Step 3
  });

  it('validates required fields before proceeding to next step', async () => {
    renderWizard();
    await act(async () => {
      fireEvent.click(screen.getByText('scheduleWizard.buttons.next'));
    });
    // Still on Step 1 because scheduleName and testPlanId are required by schema
    expect(screen.getByText('scheduleWizard.steps.step1.title')).toHaveClass('font-semibold');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({variant: "destructive"}));
  });

  it('handles "once" frequency selection and date/time input in Step 3', async () => {
    renderWizard({ initialTestPlanId: 'tp1' }); // Pre-select plan to speed up to step 3
    // Navigate to Step 3
    fireEvent.change(screen.getByLabelText('scheduleWizard.steps.step1.scheduleNameLabel'), { target: { value: 'Step3 Test' } });
    await act(async () => { fireEvent.click(screen.getByText('scheduleWizard.buttons.next')); }); // to step 2
    fireEvent.click(screen.getByLabelText('chromium'));
    await act(async () => { fireEvent.click(screen.getByText('scheduleWizard.buttons.next')); }); // to step 3

    // Select 'once' frequency
    const frequencySelect = screen.getByRole('combobox'); // Assuming only one Select on this step for frequency
    fireEvent.mouseDown(frequencySelect);
    fireEvent.click(await screen.findByText('scheduleWizard.frequencies.once'));

    // Check if date picker is available
    const datePickerButton = screen.getByText('scheduleWizard.steps.step3.pickDateTime');
    expect(datePickerButton).toBeInTheDocument();
    fireEvent.click(datePickerButton); // Open calendar popover
    fireEvent.click(await screen.findByText('15')); // Click on a day, e.g., 15th
    // Time input is also there
    expect(screen.getByRole('textbox', { name: ''})).toHaveAttribute('type', 'time'); // Basic time input check
  });


  it('submits form data for creating a new schedule on the last step', async () => {
    const onScheduleSavedMock = vi.fn();
    const onCloseMock = vi.fn();
    renderWizard({ onScheduleSaved: onScheduleSavedMock, onClose: onCloseMock });

    // Fill Step 1
    fireEvent.change(screen.getByLabelText('scheduleWizard.steps.step1.scheduleNameLabel'), { target: { value: 'Full Create Test' } });
    const tpSelect = screen.getByRole('combobox', { name: /select test plan/i });
    fireEvent.mouseDown(tpSelect);
    fireEvent.click(await screen.findByText(mockTestPlans[0].name));
    await act(async () => { fireEvent.click(screen.getByText('scheduleWizard.buttons.next')); });

    // Fill Step 2 (Browsers)
    fireEvent.click(screen.getByLabelText('chromium'));
    await act(async () => { fireEvent.click(screen.getByText('scheduleWizard.buttons.next')); });

    // Fill Step 3 (Frequency - default is 'once', ensure date is set)
    // Assuming nextRunAtOnce defaults to a valid date or is set
    // For simplicity, let's assume default is fine for this test path
    await act(async () => { fireEvent.click(screen.getByText('scheduleWizard.buttons.next')); });

    // Step 4 (Notifications) - defaults are fine
    await act(async () => { fireEvent.click(screen.getByText('scheduleWizard.buttons.next')); });

    // Step 5 (Parameters & Advanced) - defaults are fine
    await act(async () => { fireEvent.click(screen.getByText('scheduleWizard.buttons.next')); });

    // Step 6 (Summary)
    expect(screen.getByText('scheduleWizard.steps.step6.summaryTitle')).toBeInTheDocument();

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByText('scheduleWizard.buttons.createSchedule'));
    });

    await waitFor(() => expect(schedulesApi.createSchedule).toHaveBeenCalledTimes(1));
    // Check some key parts of the payload
    expect(schedulesApi.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleName: 'Full Create Test',
        testPlanId: mockTestPlans[0].id,
        browsers: ['chromium'],
        frequency: 'once', // Default or how it's derived
      })
    );
    expect(onScheduleSavedMock).toHaveBeenCalled();
    expect(onCloseMock).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'scheduleWizard.toast.success.createTitle' }));
  });

  it('pre-fills form and submits for updating an existing schedule', async () => {
    const mockScheduleToEdit: TestPlanScheduleWithPlanName = {
      id: 'sched-edit-1',
      testPlanId: mockTestPlans[1].id,
      testPlanName: mockTestPlans[1].name,
      scheduleName: 'Old Schedule Name',
      frequency: 'daily@10:00', // This will be parsed by parseBackendScheduleToFormData
      nextRunAt: Math.floor(new Date().getTime() / 1000),
      environment: 'Staging',
      browsers: ['firefox'],
      isActive: true,
      retryOnFailure: 'once',
      createdAt: Date.now(),
    };
    (schedulesApi.updateSchedule as vi.Mock).mockResolvedValue({ ...mockScheduleToEdit, scheduleName: 'New Edited Name'});


    const onScheduleSavedMock = vi.fn();
    renderWizard({ scheduleToEdit: mockScheduleToEdit, onScheduleSaved: onScheduleSavedMock });

    await waitFor(() => {
      expect(screen.getByLabelText('scheduleWizard.steps.step1.scheduleNameLabel')).toHaveValue('Old Schedule Name');
    });
    // Check if test plan is selected (might need to open dropdown to verify selection if value not directly on trigger)
    expect(screen.getByRole('combobox', { name: /select test plan/i })).toHaveTextContent(mockTestPlans[1].name);
    // Check if frequency is set correctly
    expect(screen.getByRole('combobox', { name: /frequency/i })).toHaveTextContent('scheduleWizard.frequencies.daily');


    // Navigate to last step (or just modify one field and submit from step 1 if validation passes for all)
    // For simplicity, let's assume we are on step 1, change name, then navigate to submit
    fireEvent.change(screen.getByLabelText('scheduleWizard.steps.step1.scheduleNameLabel'), { target: { value: 'New Edited Name' } });

    // Navigate to last step
    for (let i = 0; i < 5; i++) {
      await act(async () => { fireEvent.click(screen.getByText('scheduleWizard.buttons.next')); });
    }

    await act(async () => {
      fireEvent.click(screen.getByText('scheduleWizard.buttons.saveChanges'));
    });

    await waitFor(() => expect(schedulesApi.updateSchedule).toHaveBeenCalledTimes(1));
    expect(schedulesApi.updateSchedule).toHaveBeenCalledWith(
      mockScheduleToEdit.id,
      expect.objectContaining({
        scheduleName: 'New Edited Name', // The changed value
        testPlanId: mockTestPlans[1].id, // Original value if not changed
      })
    );
    expect(onScheduleSavedMock).toHaveBeenCalled();
  });

});
