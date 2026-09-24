# Running tests

Tests run in **test plans**. A plan says which tests, in which browsers, how many at once, what to
keep of each run, and whom to tell.

## Creating a plan

**Test plans → + Test Plan** opens a wizard in three steps:

1. **Name** and description.
2. **Browsers and tests**. Each machine configuration adds a browser — Chrome, Edge, Firefox or
   WebKit (Safari's engine), shown or headless; Chrome and Edge must be installed on the runner. **Add Test Suites** picks the plan's tests (search by name
   or tag). The operating system and browser version fields are recorded but not applied: tests
   run on the runner's own system, with the browsers installed there, and the report says so.
3. **Settings**: screenshots (on failed steps by default, always, or never), timeouts, what to do
   when a step or a prerequisite fails, how many times to re-run a failed test, and
   notifications.

## Plan settings

**Settings** on a plan's row changes how its next run behaves:

| Setting | What it does |
|---|---|
| **Browsers** | Every test runs once per browser listed. None listed: the browser from your own settings. |
| **Run at most (tests at once)** | 1 to 16 browser sessions at the same time. 1 runs the plan one test at a time, browser by browser. |
| **Keep a recording of the run** | A **video** and a Playwright **trace** of each test — never, when the test fails, or always — and the **network** traffic as a HAR file. They answer what a screenshot cannot, and use disk on every run. |
| **Visual testing** | Compares each step's screenshot with its baseline; see [Visual testing](./results#visual-testing). |
| **Run on** | This server's runners, or a pool of [local agents](../LOCAL_AGENT) inside your own network. |
| **File failures in** | An issue tracker (Jira, Azure DevOps) connected by an owner. With **Open an issue when a test fails**, each failing test and browser gets one issue; the same failure later is added to it as a comment. |
| **Send notification when** and the webhook URL | A message to a Slack or Microsoft Teams incoming webhook, or any URL that accepts a POST, when a run passes, fails, is not executed or is stopped. |

**Suites** on the row adds [suites](./organizing#suites): they run after the plan's own tests, in the
order ticked, and a test in more than one runs once.

## Running now

**Run** on the plan's row starts a run and opens its page: the progress, each test's status, and
the log as the run writes it. **View detailed report** opens the report.

A run waits in a queue when your organization is running as many plans as its limit allows, or
when no runner is online: **Settings → Run usage** says which.

To stop a run, **Cancel run** on its report. Tests that have not started are reported as skipped;
a test in progress stops at its next step.

### Re-running failures

With **Re-Run On Failure** set, a failed test is run again, up to three times. A test that passes
only on a later attempt is marked **flaky** in the report, and still counts as passed.

## Scheduling

**Scheduling → Create Schedule** runs a plan by itself:

- **Frequency**: once, every 5, 15 or 30 minutes, every 1, 6 or 12 hours, daily, weekly, monthly,
  or a **custom CRON** expression (minute, hour, day of month, month, day of week).
- **Timezone**: the schedule runs at that local time all year, daylight saving included.
- **Environment** whose secrets the run uses, and the **browsers** to run in (headless: nobody is
  watching).
- **Retry on Failure**: run the whole plan again if it fails, once or twice.
- **Schedule Active**: switch it off without deleting it.

The dashboard lists the next scheduled runs.

## From a pipeline

A plan can be started by your CI system and its result can fail the build: with an API key and the
`wfm` command line, or with the plan's webhook. See [CI integration](../CI_INTEGRATION).
