# Results

## Historical inputs and replay

Reports show captured test versions, published/working source, SHA-256 per definition and
fingerprints of datasets and retained configuration. HTML/PDF, Allure and JUnit exports include
provenance without snapshot values or credentials.

Editors and owners can choose **Replay historical configuration** and confirm a new manual run.
It uses retained tests, dataset values, browser choices and settings even after catalog or plan
changes. The new report links to its source and retains identical input fingerprints. Deleted
tests can produce results from saved definitions; the source plan must still exist. Reports
without verified queued inputs offer no historical replay.

Current access, review and quotas apply. Environment secrets, saved sessions, devices, browser
binaries, BDD profiles, integrations and the application under test use current state. External
changes can change the outcome. Replay does not update the original CI build status.

## Dashboard

The **Dashboard** shows how the latest runs went, the pass and fail counts of the last 30 days,
the most recent reports and the next scheduled runs.

## Reports

**Reports** lists every finished run: its plan, status, when it started, how long it took, the
count of passed, failed and skipped tests, and who or what started it (a person, a schedule, a
pipeline). Filter by plan and status, and open a run with **View Report**.

![Reports: every finished run](/screenshots/reports.webp)

## A run's report

![A run report: totals, duration and results by module](/screenshots/run-report.webp)

The report lists each test in each browser with its result, and its steps with their timings.
Around it:

- **Build**: for a run started from CI, the repository, branch, commit and build it tested.
- **Ran on**: the runner or the local agents that ran it.
- **Attempts**: a test run again after failing shows its attempts; one that passed only on a later
  attempt is marked **flaky**.
- **Quarantine**: failures of tests in quarantine are shown but did not fail the run.
- How a run ended when it did not finish: **Cancelled**, **Timed out** or **Did not finish** (the
  runner stopped).

![Failed tests in the report, with browser, reason and evidence](/screenshots/run-report-failure.webp)

The **charts** show how the run split — passed, failed and skipped, with the pass rate — and the
same split for each priority and each severity; hover a bar for its count. The **filters** narrow
the failed tests and the results by module to one component, one severity or one outcome; the
counts then are those of the tests shown, and **Clear filters** brings the whole run back.

### Manual results {#manual-results}

A run's [manual tests](./organizing#manual-tests) show in the **Manual tests** card, one row per
test, **Waiting** until somebody records its result; a run with tests waiting still ends as
completed. Once the run has ended, an editor opens the row, marks each step **OK**, **KO** or **Not
done** with a note, and records the verdict:

- **Passed** counts with the passed tests.
- **Failed** counts with the failed ones and fails the run; the reason shown is the note, or else
  the note of the first KO step.
- **Blocked** (it could not be performed) counts with the skipped ones.

Each verdict works out the run's totals and status again, so the report mixes manual and automated
results. A completed or failed run moves between the two like any run ending, so the commit
status, notifications and test-management publishing run again with the new outcome. A cancelled
or timed-out run keeps its ending and announces nothing. A verdict can be corrected by recording it
again; the row says who recorded it and when, and every recording goes into the audit log.

### Publishing to TestRail, Xray or Zephyr {#test-management}

A plan whose settings name a connection under **Publish results to** sends every finished run to
that tool, each test's result under its case:

| Tool                                        | What a run becomes                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **TestRail**                                | A test run in the project (and suite), with the run's cases only, and a result for each. |
| **Xray Cloud**, **Xray Server/Data Center** | A Test Execution issue, added to the Xray Test Plan if the connection names one.         |
| **Zephyr Scale** (Cloud)                    | A test cycle, with a test execution for each case.                                       |

**Which case a test is.** In **Settings → Test management**, **Test cases** on a connection lists
every test — web, API and mobile app — with a box for its key: `C123` in TestRail (or just `123`), `SHOP-45` in Xray,
`SHOP-T12` in Zephyr. A test whose name starts with a key in square brackets — `[C123] Login` —
needs nothing typed: the key is shown greyed in the box and used as it is. A key typed in the box
wins over the name. Tests with neither are left out, and the publication says how many; a case the
tool does not know would make the whole import fail.

**What is sent for a case.** Passed, failed or skipped, and **not run** for a test still waiting for
a manual verdict (Xray TODO, Zephyr Not Executed; TestRail gets no result for it). A test run on
several browsers, or two tests on the same case, make one result, failed if any failed, with every
browser's outcome, the reason for a failure (up to 1000 characters) and the address of the report
in its comment. The run's title is the plan's name and when it ended, in UTC.

The **Test management** card of the report lists where the run went, with a link to the TestRail
run or the Xray issue, how many cases were published and how many tests had no case, and why a
publication failed (a wrong token, a case the tool refused). A run where the tool took only some of
the cases is **Partially published**, and one where it took none is **Failed**, never Published; a
TestRail run created before its results failed is still linked. Requests that hit a network error,
429 or a 502-504 are retried up to three times. **Publish again** sends the run once
more — after the manual verdicts are in, or when the tool was down — to the plan's connection or to
another one; each time is a new run in the tool. A failed publication never changes the run's
result.

### AI failure analysis {#ai-failure-analysis}

When the installation has an AI key (`GEMINI_API_KEY`), each failed test in **Failed Tests** has an
**Analyse with AI** button. An editor clicks it and the AI reads what the report already holds: the
runner's reason, the steps around the failure with their errors, the failed and slow requests, and
the screenshot. It answers, in the interface's language, with:

- a **category**: **Locator** (the element is there but the test looks for it the wrong way),
  **Application bug**, **Timing**, **Test data**, **Environment**, or **Unclear**;
- how sure it is, and the step it blames;
- why it thinks so, and what to do next;
- for a locator, a **proposed selector**, to copy or to put in the step with **Apply to the test**.

**Apply to the test** changes that one step's selector and saves the test as a new version, which
the history can undo; plans use it once it is published. It is offered when the step is one of the
test's own — a step inside a step group is changed in the group — and for runs made from this
version of WebFlowMaster on, whose steps record which step of the test they were.

The analysis is kept on the result: opening it again, by anyone, costs nothing, and **Analyse
again** asks for a fresh one. It is a probable cause, not a verdict — check it against the steps.
Values that look like passwords, codes or keys are never sent (see
[AI features](../security/#ai-features)), and each analysis goes into the audit log.

### A step's details

Opening a step shows its **screenshot**, the error it failed with, and — when kept by the plan —
the **video** and the **Playwright trace** of the test. Download the trace and open it with
`npx playwright show-trace` or at trace.playwright.dev: it replays every action with the page as it
was, the console and the network.

#### Who can download a trace {#who-can-download-a-trace}

A trace is **raw evidence**: it keeps the page's content and every request with its body, so a
password typed during the test is in it, in clear. Only **editors** and **owners** can download
traces and HAR files; a viewer sees the rest of the report and a note saying that the trace exists.
The server decides this on every download, so knowing the address does not change it. An API key
also needs the `runs:evidence` scope.

| File                                                    | Viewer | Editor, owner |
| ------------------------------------------------------- | ------ | ------------- |
| Screenshots, visual diffs, video                        | ✓      | ✓             |
| Lighthouse report, files a test downloaded              | ✓      | ✓             |
| Playwright trace, HAR                                   | —      | ✓             |
| Any other file of the run (older or unrecognised names) | —      | ✓             |

The files of a test in a **restricted project** are available only to the people on that project
(and to owners). For everyone else they do not exist: they get the same answer as for a file that
was never written.

A test that visibly handles a credential — a `{{secret_…}}` value, or a field, selector or value
named _password_ — **records no trace**, even when the plan asks for one; the run log says so.
Video and screenshots are kept as asked.

::: warning Screenshots, videos and traces are not cleaned
Nothing removes a secret from a picture or from a recording. A browser draws a password field as
dots, but an application can show a token, a personal record or a one-time code anywhere on the
page, and that is what the screenshot and the video will contain. For flows that handle real
credentials or personal data: use dedicated test accounts, set **Trace** to _Never_ and **Video**
to _Never_ or _When the test fails_ in the plan, and keep `ARTIFACT_RETENTION_DAYS` short.
:::

#### Healed steps {#healed-steps}

A step marked **passed after healing** passed on a repaired locator, not on its own (see
[Runtime use, approval and publishing](./web-tests#healing-approval)). It is still a pass, and the
steps after it ran normally. Steps that passed on their own locator have no badge. The step details
show:

- the **written locator** and the one **used in this run**;
- what found it: a known fallback, or the AI;
- the **proposal** and its current state: _proposed_, _approved_ (with the working-copy version it
  became), _rejected_, or _out of date_ (the step changed after the run, so it can no longer be
  approved).

Editors and owners of the project see **Approve** and **Reject**. Approving writes the repair to
where the step is written, under the fingerprint the run recorded. It does not publish anything:
the new version goes live only through the usual publish or review step. The run's log has a warning
for each healed step. Proposals are also available from `GET /api/healing-proposals?testId=…`.

Results recorded before approvals existed show what the run did then (it wrote the repair itself).

The red outline that marks the element being acted on is removed after each action. Screenshots,
visual comparisons and the page sent to the AI show the application as it is.

#### Attempts and dataset rows {#attempts-and-rows}

Each row of the report is one test on one browser, in one language (and on one device for a mobile
test): a **unit** of the run. A unit's evidence is kept per **attempt** and, for a test with a
[dataset](./web-tests#datasets), per **row** of each attempt. A re-run does not overwrite the
first attempt's evidence, and one row does not overwrite another's.

When a result has more than one attempt, or dataset rows, its details open with two pickers:

- **Attempts**: _Attempt 1 · failed_, _Attempt 2 · passed · result_… The details open on the
  attempt the result stands on. Choose an earlier one to open the evidence of the failure that the
  re-run replaced: its screenshot, video, trace and HAR, and the reason it failed.
- **Dataset rows**: _All rows_, or one row with its own outcome and error. Choosing a row shows that
  row's steps and its own video, trace and HAR, nothing of the other rows.

The report keeps the steps of the attempt the result stands on. An earlier attempt shows its
evidence and its reason, and says its steps are in its trace. The rules above for who can download
a trace apply to every attempt and every row.

A link can open the report on one slice: add `?unit=<unit id>&attempt=<n>&row=<m>` to the report's
address (row from 0). The API gives the same view: `GET /api/v1/runs/{runId}/units` lists a run's
units, and `GET /api/v1/runs/{runId}/units/{unitId}` returns each attempt and row with links to its
files (see the [API](../reference/api)). From a pipeline, `wfm units <runId> [<unitId>]` prints
them.

Evidence of an attempt is written once. A late upload of the same attempt (for example from a
worker that lost its work) does not replace a file the report already links to. Runs from before
this version keep their links as they were. Their attempts and rows were not kept separately.

### Visual testing {#visual-testing}

With **Visual testing** on in a plan, each step's screenshot is compared with its **baseline**. The
first run after turning it on records the baselines. After that, a step whose screenshot differs
shows the **Baseline**, **This run** and the **Difference**.

A comparison can also fail to happen: the stored baseline is not a readable image, the artifact
store cannot be reached, or the step's screenshot cannot be taken. That step is **not verified**,
and the test ends as **Error** — never Passed, and never counted as a visual difference. The step
shows the cause (`baseline-corrupt`, `storage-unavailable`, `screenshot-unavailable`,
`comparison-failed`); the reason reads "Visual comparison could not run (…)". Exports agree: the
JSON report keeps the cause on the step, Allure shows the test and the step as _broken_ under
**Visual comparison errors**, and JUnit writes an `<error>`. A corrupt baseline is never replaced
on its own: start a run with `updateBaselines: true` (see the [API](../reference/api)) to accept
that run's screenshots as the new baselines.

### Network

When the plan keeps the network, the report summarizes each test's traffic: how many requests,
how many failed, how much was received, and the failed and slowest requests. **Download the HAR**
to open the whole capture in any browser's developer tools (editors and owners). It never contains
request or response bodies; cookies, authorization headers and query parameters with
credential-like names are replaced by `[redacted]`. A credential in some other form — in a path, in
a custom header — is not recognised, which is why the HAR is raw evidence like the trace.

### Accessibility

A **Check accessibility** step shows which rules were broken, on which elements, and how serious
each is; which passed; and which need a person to check.

## Exporting a run

**Export** downloads the run as:

| Format                | For                                                 |
| --------------------- | --------------------------------------------------- |
| HTML report           | One file that opens anywhere, screenshots included. |
| PDF                   | Attaching to a ticket or keeping for an audit.      |
| Allure results (.zip) | `allure generate` or an Allure server.              |
| JUnit XML             | A CI system's test report.                          |

An export contains the results and the screenshots of failed tests, and nothing else of the
run's evidence: no trace, HAR or video, and no link to one, whoever exports it. A screenshot of a
test in a restricted project the exporting person is not on is left out.

Attempts and dataset rows never count as tests of their own: an export has one test per unit, as
the report does. The HTML report lists them under **Attempts and dataset rows**. Allure attaches
them to their test as _Attempts and dataset rows_. JUnit keeps one `<testcase>` per unit and puts
them in the `wfm.attempts` property.

A run that ended **error**, **timed out** or **cancelled** never exports as only its green tests.
JUnit adds an `<error>` test case named after the ending (for example _Run cancelled_), and Allure
adds a _broken_ result of the same name, both carrying the run's reason. The report header shows
the run's status whether it finished or not: the same verdict as the API, the CLI exit code and
every export.

**Requirements covered** shows the [requirements](./organizing#requirements) with exactly this run's
results, and exports them as a traceability matrix.

## Filing an issue

When an owner has connected Jira or Azure DevOps, a failed test in the report has **File**, which
opens an issue with the failure's details, and then **Open in the tracker**. A plan can also file
them by itself (see [Plan settings](./running#plan-settings)).

## Flaky tests and quarantine

**Reports** also shows **Tests that disagree with themselves**: over the last days, the tests whose
verdict changed from one run to the next with nothing to explain it. A test that broke and was
fixed is not listed, and neither is one whose verdict changed because it was edited. Each test is
counted on its own, not by name: two different tests called the same are kept apart, and a renamed
test keeps its history under its new name. Mobile tests are counted per device
([mobile apps](./mobile-apps#unstable)).

A test that **passed on retry** is listed too, even when every run ended green and no verdict
ever changed: three runs that each passed on the second attempt show **3× passed on retry**, and a
last run that is green does not take the test off the list. Retries, changes of verdict, runs that
never ran because of an infrastructure error, and edits are counted apart and never added up into
one another. Only comparable runs share a history: the same test, running the same definition (a
rename alone does not split it, a change to its steps, data or dependencies does), against the same
browser, environment, locale and device. **Evidence** lists what happened, newest first, each item
linked to the report of the run, opened on the attempt that shows it — for a retry, the first
attempt that failed and why. A run recorded before attempts were kept says the cause was not
recorded rather than guess one.

A flaky test can be put in **quarantine**, with the reason. It keeps running and its results are
kept, but its failures stop failing runs, stopping plans, filing issues and breaking pipelines.
**Tests in quarantine** shows how each has done since; once it has been passing again,
**Release** it with a note of what fixed it. Web, API and [mobile](./mobile-apps#quarantine)
tests can all be quarantined.

## How long evidence is kept

Screenshots, videos, traces and network captures are removed after the period your installation
keeps them (90 days by default). The report then says so; its results and verdicts stay.
