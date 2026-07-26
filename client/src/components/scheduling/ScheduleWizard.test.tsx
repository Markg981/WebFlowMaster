import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ScheduleWizard from './ScheduleWizard';
import * as testPlansApi from '@/lib/api/test-plans';
import * as schedulesApi from '@/lib/api/schedules';
import { BROWSER_OPTIONS, FREQUENCY_OPTIONS } from '@/lib/schemas/scheduleFormSchema';

vi.mock('@/lib/api/test-plans');
vi.mock('@/lib/api/schedules');

// A single stable spy: the global setupTests mock returns a fresh vi.fn() per call, so a
// module-level `const { toast } = useToast()` would never see the component's calls.
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
  toast: (...args: unknown[]) => mockToast(...args),
}));

const fetchTestPlansAPI = vi.mocked(testPlansApi.fetchTestPlansAPI);
const createSchedule = vi.mocked(schedulesApi.createSchedule);
const updateSchedule = vi.mocked(schedulesApi.updateSchedule);

const mockTestPlans = [
  { id: 'tp1', name: 'Test Plan Alpha' },
  { id: 'tp2', name: 'Test Plan Beta' },
];

// The `scheduleWizard.*` namespace has no English bundle, so i18next echoes the keys back.
// Asserting on them keeps the tests stable until the strings are actually translated.
const K = {
  createTitle: 'scheduleWizard.createTitle',
  editTitle: 'scheduleWizard.editTitle',
  stepTitle: (n: number) => `scheduleWizard.steps.step${n}.title`,
  scheduleNameLabel: 'scheduleWizard.steps.step1.scheduleNameLabel',
  testPlanLabel: 'scheduleWizard.steps.step1.testPlanLabel',
  next: 'scheduleWizard.buttons.next',
  createSchedule: 'scheduleWizard.buttons.createSchedule',
  saveChanges: 'scheduleWizard.buttons.saveChanges',
  summaryTitle: 'scheduleWizard.steps.step6.summaryTitle',
};

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });

let queryClient: QueryClient;

const renderWizard = (props: Partial<React.ComponentProps<typeof ScheduleWizard>> = {}) => {
  const defaultProps: React.ComponentProps<typeof ScheduleWizard> = {
    isOpen: true,
    onClose: vi.fn(),
    onScheduleSaved: vi.fn(),
    ...props,
  };
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...render(<ScheduleWizard {...defaultProps} />, { wrapper }), props: defaultProps };
};

/** The step indicator puts the active styling on the wrapper, not on the label span. */
const activeStepTitles = () =>
  screen
    .getAllByText(/^scheduleWizard\.steps\.step\d\.title$/)
    .filter((el) => el.parentElement?.className.includes('font-semibold'))
    .map((el) => el.textContent);

/** Radix needs focus + a keyboard activation; JSDOM has no PointerEvent. */
const openSelect = async (trigger: HTMLElement) => {
  await waitFor(() => expect(trigger).not.toBeDisabled());
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(screen.getAllByRole('option', { hidden: true }).length).toBeGreaterThan(0));
};

const clickNext = async () => {
  fireEvent.click(screen.getByText(K.next));
};

const fillStepOne = async (name: string) => {
  await waitFor(() => expect(fetchTestPlansAPI).toHaveBeenCalled());
  // The wizard defaults testPlanId to the first plan once the list resolves.
  await waitFor(() =>
    expect(screen.getByLabelText(K.testPlanLabel)).toHaveTextContent(mockTestPlans[0].name),
  );
  fireEvent.change(screen.getByLabelText(K.scheduleNameLabel), { target: { value: name } });
};

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = createQueryClient();
  fetchTestPlansAPI.mockResolvedValue(mockTestPlans as never);
  createSchedule.mockResolvedValue({ id: 'new-sched-1' } as never);
  updateSchedule.mockResolvedValue({ id: 'edited-sched-1' } as never);
});

describe('ScheduleWizard', () => {
  it('renders step 1 with the test plans loaded', async () => {
    renderWizard();

    expect(await screen.findByText(K.createTitle)).toBeInTheDocument();
    expect(activeStepTitles()).toEqual([K.stepTitle(1)]);
    expect(screen.getByLabelText(K.testPlanLabel)).toBeInTheDocument();

    await openSelect(screen.getByLabelText(K.testPlanLabel));

    // Radix mirrors the selected item into a hidden measurement node, so the currently
    // selected plan legitimately appears twice.
    const optionNames = screen
      .getAllByRole('option', { hidden: true })
      .map((option) => option.textContent);
    expect(optionNames).toContain('Test Plan Alpha');
    expect(optionNames).toContain('Test Plan Beta');
  });

  it('advances through the steps once step 1 is valid', async () => {
    renderWizard();
    await fillStepOne('My Test Schedule');

    await clickNext();
    await waitFor(() => expect(activeStepTitles()).toEqual([K.stepTitle(2)]));

    // Step 2 pre-selects the first browser; toggling a second one keeps the form valid.
    fireEvent.click(screen.getByLabelText(BROWSER_OPTIONS[1].label));

    await clickNext();
    await waitFor(() => expect(activeStepTitles()).toEqual([K.stepTitle(3)]));
  });

  it('blocks navigation and warns when required fields are missing', async () => {
    renderWizard();
    await waitFor(() => expect(fetchTestPlansAPI).toHaveBeenCalled());

    // scheduleName is left empty on purpose.
    await clickNext();

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      ),
    );
    expect(activeStepTitles()).toEqual([K.stepTitle(1)]);
  });

  it('submits a create payload from the summary step', async () => {
    const { props } = renderWizard();
    await fillStepOne('Full Create Test');

    // Walk to the summary step.
    for (let step = 1; step < 6; step++) {
      await clickNext();
      await waitFor(() => expect(activeStepTitles()).toEqual([K.stepTitle(step + 1)]));
    }

    expect(screen.getByText(K.summaryTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByText(K.createSchedule));

    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleName: 'Full Create Test',
        testPlanId: mockTestPlans[0].id,
        browsers: [BROWSER_OPTIONS[0].value],
        frequency: FREQUENCY_OPTIONS[0].value,
      }),
    );
    await waitFor(() => expect(props.onScheduleSaved).toHaveBeenCalled());
    expect(props.onClose).toHaveBeenCalled();
  });

  it('pre-fills from an existing schedule and submits an update', async () => {
    const scheduleToEdit = {
      id: 'sched-edit-1',
      testPlanId: mockTestPlans[1].id,
      testPlanName: mockTestPlans[1].name,
      scheduleName: 'Old Schedule Name',
      frequency: FREQUENCY_OPTIONS[0].value,
      nextRunAt: new Date('2025-07-15T10:00:00Z'),
      environment: 'Staging',
      browsers: ['firefox'],
      isActive: true,
      retryOnFailure: 'once',
      notificationConfigOverride: null,
      executionParameters: null,
      createdAt: new Date(),
      updatedAt: null,
    } as unknown as schedulesApi.TestPlanScheduleEnhanced;

    const { props } = renderWizard({ scheduleToEdit });

    expect(await screen.findByText(K.editTitle)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(K.scheduleNameLabel)).toHaveValue('Old Schedule Name'),
    );
    expect(screen.getByLabelText(K.testPlanLabel)).toHaveTextContent(mockTestPlans[1].name);

    fireEvent.change(screen.getByLabelText(K.scheduleNameLabel), {
      target: { value: 'New Edited Name' },
    });

    for (let step = 1; step < 6; step++) {
      await clickNext();
      await waitFor(() => expect(activeStepTitles()).toEqual([K.stepTitle(step + 1)]));
    }

    fireEvent.click(screen.getByText(K.saveChanges));

    await waitFor(() => expect(updateSchedule).toHaveBeenCalledTimes(1));
    expect(updateSchedule).toHaveBeenCalledWith(
      scheduleToEdit.id,
      expect.objectContaining({
        scheduleName: 'New Edited Name',
        testPlanId: mockTestPlans[1].id,
      }),
    );
    await waitFor(() => expect(props.onScheduleSaved).toHaveBeenCalled());
  });
});
