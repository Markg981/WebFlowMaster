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

The **Dashboard** shows how the latest runs went, the pass and fail counts of the last 30 days
(runs that hit their time limit are counted apart, as **Timed out**, in the status chart and its legend),
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
completed. A run in which every test was skipped (for example by the published-only policy) ends in
**error** with the reason "No test produced a verdict (all skipped)", shown in the report header:
before, it ended completed and green. This is a behaviour change. Once the run has ended, an editor opens the row, marks each step **OK**, **KO** or **Not
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

The same restriction covers the plan report, the live execution view and the JUnit export (including
the one fetched with an API key, which acts as the key's user): a test of a restricted project you
are not on shows only its name and verdict, without steps, logs, network capture or AI analysis, and
a run that includes such a test cannot be followed live.

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

#### Approve a new baseline {#approve-baseline}

When a visual difference is intended — a redesign, a new banner — an **editor** or **owner** can
accept it from the report: open the test's steps, and on the step with the difference press
**Approve as new baseline** and confirm. The image of that run replaces the stored baseline for
that test, step, browser and dataset row, and the step shows who approved it and when. The next run
is compared with the new image. The approval is written to the audit log
(`visual_baseline.approved`). In a restricted project it needs edit access to the project; viewers
do not see the button. The run's own verdict does not change: it stays failed.

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

## Comparing two environments {#comparing-environments}

A comparison runs one plan on two environments and sets the two runs side by side, test by test.
Use it to show that a new version behaves like the current one: the **baseline** is the
environment you trust, the **candidate** the one you are checking.

On **Test plans**, an editor clicks **Compare environments** on a plan, picks the baseline and the
candidate (two different [environments](web-tests.md#variables-and-environments)) and the order:

- **Baseline first, then candidate**: the candidate starts when the baseline run has finished.
- **Both at once**: the two runs start together.

Both runs replay the same frozen tests, so an edit made in the meantime cannot reach one side only.
Each run is an ordinary run with its own report, and that report links back to its comparison.
An editor can cancel a comparison while it runs; viewers can read it.

**Comparisons**, in the side menu, lists them. Once both runs have finished, a comparison's report
shows:

- the overall verdict and how many tests got each test verdict;
- **Parity by module**: the share of identical or equivalent tests in each module;
- the tests, filterable by verdict. Open one to see each difference: the step, the checkpoint, the
  kind (outcome, text, screenshot, duration…), what each side had, and whether it is blocking or
  informative. A screenshot difference shows both screenshots. A test you may not see is listed
  without its details.

| Test verdict    | When                                               |
| --------------- | -------------------------------------------------- |
| Identical       | No difference                                      |
| Equivalent      | Informative differences only                       |
| Different       | At least one blocking difference                   |
| Outcome differs | Passed on one side, failed on the other            |
| Failed on both  | Failed on both sides: it proves nothing either way |
| Not comparable  | One side has no result for the test                |

The overall verdict is **Regressions** if any test is different or its outcome differs; otherwise
**Inconclusive** if any failed on both sides or is not comparable; otherwise **Parity with accepted
differences** if any is equivalent; otherwise **Parity**.

What is compared, checkpoint by checkpoint, matched by name:

- the outcome of each test;
- **Checkpoint text**: the texts, in order;
- **Checkpoint table**: the cells, row by row and cell by cell. A row on one side only is one
  difference. A cell that reads as a number on both sides matches within the numeric tolerance;
- **Checkpoint chart**: the series, paired by name, and their points by argument (values within the
  numeric tolerance); the axis ranges; the reference lines;
- **Checkpoint network**: each call (method, path and query) since the previous network checkpoint,
  how many times it was made, its status and the hash of the request body, and of the response body
  if the tolerances ask for it;
- the screenshots of the same step, and the durations: the test's and, where the log records it, each
  step's. Faster is never a difference, and neither is a slowdown under 250 ms.

A test keeps at most 200 differences; the report says how many more were found.

### Tolerances

**Tolerances**, in the **Compare environments** dialog, set how strict the comparison is. The API
takes the same settings as `policy` in `POST /api/test-plans/{planId}/comparisons`.

| Group       | Setting                                                    | Default          |
| ----------- | ---------------------------------------------------------- | ---------------- |
| Text        | Collapse runs of spaces                                    | on               |
| Text        | Ignore case                                                | off              |
| Text        | Replace rules, one `pattern => replacement` per line       | none             |
| Numbers     | Absolute tolerance; relative tolerance (%)                 | 0; 0             |
| Network     | Paths compared (patterns, `*` matches anything)            | `**/api/**`      |
| Network     | Query parameters ignored; compare the response body hash   | none; off        |
| Screenshots | Off, informative or blocking; pixels allowed to differ (%) | informative; 1%  |
| Durations   | Off, informative or blocking; slowdown allowed (%)         | informative; 20% |

A replace rule is a regular expression applied to both sides before they are compared, everywhere
in the text: `\d{2}/\d{2}/\d{4} => DATE` makes two dates equal. A rule without `=>` deletes what
it matches.

### Reviewing a test and known differences {#known-differences}

In an open test, an editor clicks **Review** and says whether the differences are expected:

- **Accepted**: the difference is expected. A reason is required.
- **Defect**: the candidate is wrong. The note is optional.

The review and its note stay on the test; a viewer sees them but cannot review.

An accepted test can also teach later comparisons: **Expect these differences in later
comparisons** saves the chosen blocking differences (at most 50) as **known differences**, for this
test, every test of its project or every test of the organization, with an optional reference (a
ticket, for example) and expiry date. The review's reason becomes their reason. From then on, a
difference a known difference covers is marked **known** and no longer blocks: a test whose only
blocking differences are known is **Equivalent**. A known difference covers a difference of the same kind, on the same checkpoint (or
any, if it names none) and a path its pattern matches, until it expires. A comparison already made
keeps its verdict.

**Settings → Known differences** lists them all, marks the expired ones, and lets an editor add one
by hand or delete one. A known difference of a restricted project is visible only to those who can
see the project, and only those who can edit the project can add or delete it.

### Limits

- A table's rows are compared by position: a row inserted on one side shifts every row after it,
  and each shifted row is a difference (up to the 200 a test keeps). Record a table sorted the same
  way on both sides, or record the rows you need with `rows=` in the checkpoint.
- Network paths are filtered when the comparison runs, not when the run records them: a network
  checkpoint keeps every fetch and XHR call (or those matching its own patterns), so a later
  comparison can choose different paths.
- A web step's duration is not in the log, so the durations of web tests are compared for the whole
  test only.

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
