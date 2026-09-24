# Results

## Dashboard

The **Dashboard** shows how the latest runs went, the pass and fail counts of the last 30 days,
the most recent reports and the next scheduled runs.

## Reports

**Reports** lists every finished run: its plan, status, when it started, how long it took, the
count of passed, failed and skipped tests, and who or what started it (a person, a schedule, a
pipeline). Filter by plan and status, and open a run with **View Report**.

## A run's report

The report lists each test in each browser with its result, and its steps with their timings.
Around it:

- **Build**: for a run started from CI, the repository, branch, commit and build it tested.
- **Ran on**: the runner or the local agents that ran it.
- **Attempts**: a test run again after failing shows its attempts; one that passed only on a later
  attempt is marked **flaky**.
- **Quarantine**: failures of tests in quarantine are shown but did not fail the run.
- How a run ended when it did not finish: **Cancelled**, **Timed out** or **Did not finish** (the
  runner stopped).

### A step's details

Opening a step shows its **screenshot**, the error it failed with, and — when kept by the plan —
the **video** and the **Playwright trace** of the test. Download the trace and open it with
`npx playwright show-trace` or at trace.playwright.dev: it replays every action with the page as it
was, the console and the network.

A step marked **healed** found its element only after its selector was replaced (see
[Element repository](./web-tests#element-repository)).

### Visual testing {#visual-testing}

With **Visual testing** on in a plan, each step's screenshot is compared with its **baseline**. The
first run after turning it on records the baselines. After that, a step whose screenshot differs
shows the **Baseline**, **This run** and the **Difference**.

### Network

When the plan keeps the network, the report summarizes each test's traffic: how many requests,
how many failed, how much was received, and the failed and slowest requests. **Download the HAR**
to open the whole capture in any browser's developer tools. It never contains request or
response bodies, cookies, tokens or passwords.

### Accessibility

A **Check accessibility** step shows which rules were broken, on which elements, and how serious
each is; which passed; and which need a person to check.

## Exporting a run

**Export** downloads the run as:

| Format | For |
|---|---|
| HTML report | One file that opens anywhere, screenshots included. |
| PDF | Attaching to a ticket or keeping for an audit. |
| Allure results (.zip) | `allure generate` or an Allure server. |
| JUnit XML | A CI system's test report. |

## Filing an issue

When an owner has connected Jira or Azure DevOps, a failed test in the report has **File**, which
opens an issue with the failure's details, and then **Open in the tracker**. A plan can also file
them by itself (see [Plan settings](./running#plan-settings)).

## Flaky tests and quarantine

**Reports** also shows **Tests that disagree with themselves**: over the last days, the tests whose
verdict changed from one run to the next with nothing to explain it. A test that broke and was
fixed is not listed, and neither is one whose verdict changed because it was edited.

A flaky test can be put in **quarantine**, with the reason. It keeps running and its results are
kept, but its failures stop failing runs, stopping plans, filing issues and breaking pipelines.
**Tests in quarantine** shows how each has done since; once it has been passing again,
**Release** it with a note of what fixed it.

## How long evidence is kept

Screenshots, videos, traces and network captures are removed after the period your installation
keeps them (90 days by default). The report then says so; its results and verdicts stay.
