import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateTestPlanWizard from './CreateTestPlanWizard';

/**
 * The wizard sends what the plan's settings dialog can change afterwards: a plan created
 * here with a device, a video setting and a parallelism must not need a second save to
 * get them.
 *
 * Beyond that: each step refuses to go on without what it needs, the tests picked from the
 * selector and the machines added by hand reach the payload as the server stores them, and a
 * refusal from the server is shown without losing the form.
 */

const fetchMock = vi.fn();

const selectableTests = {
  items: [
    { id: 1, name: 'Checkout', type: 'ui', description: 'Pay by card' },
    { id: 2, name: 'Orders API', type: 'api' },
    { id: 3, name: 'Pay on Android', type: 'mobile' },
  ],
  totalItems: 3,
  totalPages: 1,
};

/** Radix opens a Select on keyboard activation only; JSDOM has no PointerEvent for a click. */
const choose = async (trigger: HTMLElement, option: string) => {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

const renderWizard = (onPlanCreated = vi.fn(), onClose = vi.fn()) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => [] } },
  });
  client.setQueryData(['tags'], []);
  render(
    <QueryClientProvider client={client}>
      <CreateTestPlanWizard isOpen onClose={onClose} onPlanCreated={onPlanCreated} />
    </QueryClientProvider>,
  );
  return onPlanCreated;
};

const postedPlan = () => {
  const call = fetchMock.mock.calls.find(([, i]: any[]) => i?.method === 'POST');
  return call ? JSON.parse(call[1].body) : undefined;
};

const next = () => fireEvent.click(screen.getByRole('button', { name: /Next/i }));
const nameThePlan = (name = 'Nightly') =>
  fireEvent.change(screen.getByLabelText(/Test Plan Name/i), { target: { value: name } });

/** Step 2 with one Linux/Chrome desktop machine, the least a plan needs to be created. */
const addLinuxChrome = async () => {
  await choose(screen.getByRole('combobox', { name: /Operating System/i }), 'Linux');
  await choose(screen.getByRole('combobox', { name: /OS Version/i }), 'Ubuntu 22.04');
  fireEvent.click(screen.getByRole('button', { name: /Add Machine Configuration/i }));
  await screen.findByText(/linux Ubuntu 22.04 - chrome latest \(UI\)/);
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () =>
        String(url).startsWith('/api/selectable-tests') ? selectableTests : { id: 'plan-1' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CreateTestPlanWizard', () => {
  it('offers the device, video and parallelism the settings dialog does, and sends them', async () => {
    const onPlanCreated = renderWizard();

    fireEvent.change(screen.getByLabelText(/Test Plan Name/i), {
      target: { value: 'Nightly' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // A browser as a phone: the device choice is the one the settings dialog offers.
    await choose(screen.getByRole('combobox', { name: /Operating System/i }), 'Linux');
    await choose(screen.getByRole('combobox', { name: /OS Version/i }), 'Ubuntu 22.04');
    await choose(screen.getByRole('combobox', { name: /Device/i }), 'Pixel 7');
    fireEvent.click(screen.getByRole('button', { name: /Add Machine Configuration/i }));
    // The added row, not the Select trigger that also reads "Pixel 7".
    expect(await screen.findByText(/chrome latest · Pixel 7/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await choose(screen.getByRole('combobox', { name: /^Video$/i }), 'Always');
    fireEvent.change(screen.getByLabelText(/Run at most/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));

    await waitFor(() => expect(onPlanCreated).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.find(([, i]: any[]) => i?.method === 'POST')!;
    expect(url).toBe('/api/test-plans');
    const body = JSON.parse(init.body);
    expect(body.captureVideo).toBe('always');
    expect(body.maxParallelTests).toBe(4);
    expect(body.testMachinesConfig).toEqual([
      expect.objectContaining({ browserName: 'chrome', device: 'Pixel 7' }),
    ]);
  });

  it('refuses a parallelism outside 1 to 16, like the settings dialog', async () => {
    const onPlanCreated = renderWizard();

    fireEvent.change(screen.getByLabelText(/Test Plan Name/i), {
      target: { value: 'Nightly' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    await choose(screen.getByRole('combobox', { name: /Operating System/i }), 'Linux');
    await choose(screen.getByRole('combobox', { name: /OS Version/i }), 'Ubuntu 22.04');
    fireEvent.click(screen.getByRole('button', { name: /Add Machine Configuration/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    fireEvent.change(screen.getByLabelText(/Run at most/i), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));

    expect(
      await screen.findByText('Run at most must be a whole number between 1 and 16.'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]: any[]) => i?.method === 'POST')).toBe(false);
    expect(onPlanCreated).not.toHaveBeenCalled();
  });

  describe('step 1', () => {
    it('does not go on without a name, and drops the complaint once one is typed', () => {
      renderWizard();
      expect(screen.getByText('Step 1: Create Test Plan')).toBeInTheDocument();

      nameThePlan('   ');
      next();
      expect(screen.getByText('Test Plan Name is required.')).toBeInTheDocument();
      expect(screen.getByText('Step 1: Create Test Plan')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Previous/i })).toBeNull();

      nameThePlan('Nightly');
      expect(screen.queryByText('Test Plan Name is required.')).toBeNull();
      next();
      expect(screen.getByText('Step 2: Test Machines & Suites')).toBeInTheDocument();
    });

    it('keeps what was typed when going back from step 2', () => {
      renderWizard();
      nameThePlan('Nightly');
      fireEvent.change(screen.getByLabelText(/^Description \(Optional\)$/i), {
        target: { value: 'Every night at two.' },
      });
      next();
      fireEvent.click(screen.getByRole('button', { name: /Previous/i }));
      expect(screen.getByText('Step 1: Create Test Plan')).toBeInTheDocument();
      expect(screen.getByLabelText(/Test Plan Name/i)).toHaveValue('Nightly');
      expect(screen.getByLabelText(/^Description \(Optional\)$/i)).toHaveValue(
        'Every night at two.',
      );
    });

    it('tells the opener it was cancelled', () => {
      const onClose = vi.fn();
      renderWizard(vi.fn(), onClose);
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('step 2', () => {
    it('does not go on with neither a machine nor a test', () => {
      renderWizard();
      nameThePlan();
      next();
      next();
      expect(
        screen.getByText(
          'Please add at least one machine configuration or select at least one test suite.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('Step 2: Test Machines & Suites')).toBeInTheDocument();
    });

    it('refuses a machine without an operating system', () => {
      renderWizard();
      nameThePlan();
      next();
      fireEvent.click(screen.getByRole('button', { name: /Add Machine Configuration/i }));
      expect(
        screen.getByText('All machine configuration fields are required.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Added Configurations:')).toBeNull();
    });

    it('lists the machines added, drops a removed one, and offers Firefox no device', async () => {
      renderWizard();
      nameThePlan();
      next();

      await choose(screen.getByRole('combobox', { name: /Operating System/i }), 'Windows');
      // The first version of the chosen OS is picked for you.
      expect(screen.getByRole('combobox', { name: /OS Version/i })).toHaveTextContent('11');
      await choose(screen.getByRole('combobox', { name: /Device/i }), 'iPhone 15');
      fireEvent.click(screen.getByLabelText('Headless'));
      fireEvent.click(screen.getByRole('button', { name: /Add Machine Configuration/i }));
      expect(
        await screen.findByText(/windows 11 - chrome latest · iPhone 15 \(Headless\)/),
      ).toBeInTheDocument();

      // Firefox has no mobile mode: the device goes back to the desktop and cannot be chosen.
      await choose(screen.getByRole('combobox', { name: 'Browser' }), 'Firefox');
      const device = screen.getByRole('combobox', { name: /Device/i });
      expect(device).toBeDisabled();
      expect(device).toHaveTextContent('Desktop');
      fireEvent.change(screen.getByLabelText(/Browser Version/i), { target: { value: '128' } });
      fireEvent.click(screen.getByRole('button', { name: /Add Machine Configuration/i }));
      expect(await screen.findByText(/windows 11 - firefox 128 \(Headless\)/)).toBeInTheDocument();

      // Removing the first leaves the second.
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove browser' })[0]);
      expect(screen.queryByText(/chrome latest · iPhone 15/)).toBeNull();
      expect(screen.getByText(/windows 11 - firefox 128 \(Headless\)/)).toBeInTheDocument();

      next();
      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));
      await waitFor(() => expect(postedPlan()).toBeDefined());
      expect(postedPlan().testMachinesConfig).toEqual([
        {
          os: 'windows',
          osVersion: '11',
          browserName: 'firefox',
          browserVersion: '128',
          headless: true,
          device: null,
        },
      ]);
    });

    it('adds the tests ticked in the selector and sends them by id and type', async () => {
      const onPlanCreated = renderWizard();
      nameThePlan();
      next();
      expect(screen.getByText('No test suites selected yet.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Add Test Suites/i }));
      const selector = await screen.findByRole('dialog', { name: 'Select Test Suites' });
      expect(await within(selector).findByText('Pay by card')).toBeInTheDocument();
      const addSelected = within(selector).getByRole('button', { name: /Add Selected/ });
      expect(addSelected).toBeDisabled();

      fireEvent.click(within(selector).getByRole('checkbox', { name: /Orders API/ }));
      fireEvent.click(within(selector).getByRole('checkbox', { name: /Pay on Android/ }));
      expect(addSelected).toHaveTextContent('Add Selected (2)');
      fireEvent.click(addSelected);

      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Select Test Suites' })).toBeNull(),
      );
      expect(screen.queryByText('No test suites selected yet.')).toBeNull();
      const picked = screen.getAllByRole('listitem').map((item) => item.textContent);
      expect(picked).toEqual(['Orders API api', 'Pay on Android mobile']);

      // Already-picked tests are not offered a second time.
      fireEvent.click(screen.getByRole('button', { name: /Add Test Suites/i }));
      const again = await screen.findByRole('dialog', { name: 'Select Test Suites' });
      expect(await within(again).findByRole('checkbox', { name: /Checkout/ })).toBeInTheDocument();
      expect(within(again).queryByRole('checkbox', { name: /Orders API/ })).toBeNull();
      fireEvent.click(within(again).getByRole('button', { name: /^Cancel$/ }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Select Test Suites' })).toBeNull(),
      );

      next();
      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));
      await waitFor(() => expect(onPlanCreated).toHaveBeenCalled());
      expect(postedPlan()).toMatchObject({
        testMachinesConfig: [],
        selectedTests: [
          { id: 2, type: 'api' },
          { id: 3, type: 'mobile' },
        ],
      });
    });
  });

  describe('step 3', () => {
    it('sends the defaults, in the units the server stores, when nothing is changed', async () => {
      const onPlanCreated = renderWizard();
      nameThePlan('Nightly');
      next();
      await addLinuxChrome();
      next();
      expect(screen.getByText('Step 3: Test Plan Settings')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));

      await waitFor(() => expect(onPlanCreated).toHaveBeenCalled());
      expect(postedPlan()).toEqual({
        name: 'Nightly',
        description: '',
        testMachinesConfig: [
          {
            os: 'linux',
            osVersion: 'Ubuntu 22.04',
            browserName: 'chrome',
            browserVersion: 'latest',
            headless: false,
            device: null,
          },
        ],
        captureScreenshots: 'on_failed_steps',
        visualTestingEnabled: false,
        captureVideo: 'never',
        maxParallelTests: 1,
        // Seconds on the form, milliseconds in the plan.
        pageLoadTimeout: 30000,
        elementTimeout: 30000,
        onMajorStepFailure: 'abort_and_run_next_test_case',
        onAbortedTestCase: 'delete_cookies_and_reuse_session',
        onTestSuitePreRequisiteFailure: 'stop_execution',
        onTestCasePreRequisiteFailure: 'stop_execution',
        onTestStepPreRequisiteFailure: 'abort_and_run_next_test_case',
        reRunOnFailure: 'none',
        notificationSettings: {
          passed: true,
          failed: true,
          notExecuted: true,
          stopped: true,
          webhookUrl: null,
        },
        selectedTests: [],
      });
    });

    it('sends every setting as changed', async () => {
      const onPlanCreated = renderWizard();
      nameThePlan('Nightly');
      fireEvent.change(screen.getByLabelText(/^Description \(Optional\)$/i), {
        target: { value: 'Every night at two.' },
      });
      next();
      await addLinuxChrome();
      next();

      await choose(screen.getByRole('combobox', { name: /Capture Screenshots/i }), 'Never');
      fireEvent.click(screen.getByLabelText(/Visual Testing/i));
      await choose(screen.getByRole('combobox', { name: /^Video$/i }), 'When the test fails');
      fireEvent.change(screen.getByLabelText(/Run at most/i), { target: { value: '8' } });
      fireEvent.change(screen.getByLabelText(/Page Load Timeout/i), { target: { value: '45' } });
      fireEvent.change(screen.getByLabelText(/Element Timeout/i), { target: { value: '10' } });
      await choose(screen.getByRole('combobox', { name: /On Major Step Failure/i }), 'Retry Step');
      await choose(
        screen.getByRole('combobox', { name: /On Aborted Test Case/i }),
        'Stop Execution',
      );
      await choose(
        screen.getByRole('combobox', { name: /On Test Suite Pre Requisite Failure/i }),
        'Skip Test Suite',
      );
      await choose(
        screen.getByRole('combobox', { name: /On Test Case Pre Requisite Failure/i }),
        'Continue Anyway',
      );
      await choose(
        screen.getByRole('combobox', { name: /On Test Step Pre Requisite Failure/i }),
        'Skip Test Step',
      );
      await choose(screen.getByRole('combobox', { name: /Re-Run On Failure/i }), 'Twice');
      fireEvent.click(screen.getByLabelText('Passed'));
      fireEvent.click(screen.getByLabelText('Not Executed'));
      fireEvent.change(screen.getByLabelText(/webhook URL/i), {
        target: { value: '  https://hooks.slack.com/services/T000/B000/XXXX  ' },
      });
      // The description is carried over for reading, not editing.
      expect(screen.getByLabelText(/^Description \(Optional\)$/i)).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));
      await waitFor(() => expect(onPlanCreated).toHaveBeenCalled());
      expect(postedPlan()).toMatchObject({
        name: 'Nightly',
        description: 'Every night at two.',
        captureScreenshots: 'never',
        visualTestingEnabled: true,
        captureVideo: 'on_failure',
        maxParallelTests: 8,
        pageLoadTimeout: 45000,
        elementTimeout: 10000,
        onMajorStepFailure: 'retry_step',
        onAbortedTestCase: 'stop_execution',
        onTestSuitePreRequisiteFailure: 'skip_test_suite',
        onTestCasePreRequisiteFailure: 'continue_anyway',
        onTestStepPreRequisiteFailure: 'skip_test_step',
        reRunOnFailure: 'twice',
        notificationSettings: {
          passed: false,
          failed: true,
          notExecuted: false,
          stopped: true,
          webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
        },
      });
    });

    it('refuses timeouts outside 1 to 600 seconds and a webhook that is not a URL', async () => {
      const onPlanCreated = renderWizard();
      nameThePlan();
      next();
      await addLinuxChrome();
      next();

      fireEvent.change(screen.getByLabelText(/Page Load Timeout/i), { target: { value: '0' } });
      fireEvent.change(screen.getByLabelText(/Element Timeout/i), { target: { value: '700' } });
      fireEvent.change(screen.getByLabelText(/webhook URL/i), {
        target: { value: 'hooks.slack.com/services/x' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));

      expect(
        await screen.findByText('Page Load Timeout must be a positive number.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Timeouts must be between 1 and 600 seconds.')).toBeInTheDocument();
      expect(
        screen.getByText('The notification URL must start with http:// or https://.'),
      ).toBeInTheDocument();
      expect(postedPlan()).toBeUndefined();
      expect(onPlanCreated).not.toHaveBeenCalled();

      // Put right, the plan goes through.
      fireEvent.change(screen.getByLabelText(/Page Load Timeout/i), { target: { value: '60' } });
      fireEvent.change(screen.getByLabelText(/Element Timeout/i), { target: { value: '600' } });
      fireEvent.change(screen.getByLabelText(/webhook URL/i), {
        target: { value: 'https://hooks.slack.com/services/x' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));
      await waitFor(() => expect(onPlanCreated).toHaveBeenCalled());
      expect(postedPlan()).toMatchObject({ pageLoadTimeout: 60000, elementTimeout: 600000 });
      expect(screen.queryByText('Page Load Timeout must be a positive number.')).toBeNull();
    });

    it("shows the server's refusal and keeps the wizard open on step 3", async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? {
                ok: false,
                status: 400,
                json: async () => ({
                  error: 'A plan of that name exists',
                  details: { formErrors: ['name taken'] },
                }),
              }
            : {
                ok: true,
                json: async () =>
                  String(url).startsWith('/api/selectable-tests') ? selectableTests : {},
              },
        ),
      );
      const onClose = vi.fn();
      const onPlanCreated = renderWizard(vi.fn(), onClose);
      nameThePlan();
      next();
      await addLinuxChrome();
      next();
      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));

      expect(await screen.findByText('name taken')).toBeInTheDocument();
      expect(screen.getByText('Step 3: Test Plan Settings')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Create Plan/i })).toBeEnabled();
      expect(onPlanCreated).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('shows the field error of a 400 validation response', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? {
                ok: false,
                status: 400,
                json: async () => ({ formErrors: [], fieldErrors: { name: ['Required'] } }),
              }
            : {
                ok: true,
                json: async () =>
                  String(url).startsWith('/api/selectable-tests') ? selectableTests : {},
              },
        ),
      );
      renderWizard(vi.fn(), vi.fn());
      nameThePlan();
      next();
      await addLinuxChrome();
      next();
      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));

      expect(await screen.findByText('name: Required')).toBeInTheDocument();
    });

    it('closes once the plan is created', async () => {
      const onClose = vi.fn();
      const onPlanCreated = renderWizard(vi.fn(), onClose);
      nameThePlan();
      next();
      await addLinuxChrome();
      next();
      fireEvent.click(screen.getByRole('button', { name: /Create Plan/i }));
      await waitFor(() => expect(onPlanCreated).toHaveBeenCalled());
      expect(onClose).toHaveBeenCalled();
    });
  });
});
