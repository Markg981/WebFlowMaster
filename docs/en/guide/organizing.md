# Organizing tests

## The test library

**Test Library** lists every saved web test: its tags, where it starts, and when it was last saved.
Search by name, or filter by clicking a tag. From each row you can open its **History**, change its
tags, or **Delete** it (with its history).

**Tags** are your organization's own labels — `smoke`, `checkout`, `nightly` — added from the test's
row. They are what [dynamic suites](#suites) select by.

## Manual tests {#manual-tests}

Not everything is worth automating: a check done once a release, a flow that needs a person's
judgment, a device no browser can stand in for. **New manual test** in the library writes one: a
name and its steps, each an **action** to perform and the **expected result**. It shows in the
library with a **Manual** badge, and its pencil edits the steps.

A manual test is a test like the others: it has versions and reviews, carries tags, goes into
suites and plans. In a run it opens no browser — it waits in the run's report for somebody's
verdict (see [Manual results](./results#manual-results)), once per run whatever browsers and
languages the plan has.

## History and versions {#history-and-versions}

Every save of a test is a **version**, numbered from 1. **History** shows them newest first, with
who saved each one, how many steps it had, and how the runs that used it went.

**Restore** puts an earlier version back by saving it again as the newest version: nothing in
between is removed, so today's work stays recoverable too.

## Publishing and reviews {#publishing-and-reviews}

A saved test is a **working copy**. Plans run the **published** version when there is one; if a
test was never published, plans run its latest save — unless your organization requires reviews.

The publishing panel of a test says which version plans run and whether there are newer changes:

- **Publish version N** makes plans run that version from their next run.
- **Roll back to this**, in the history, makes plans run an earlier published version again.

When an owner turns on **Require a review to publish** (in **Reviews**), publishing a version takes
another member's approval:

1. The author uses **Ask for review of version N**, with a note for the reviewer.
2. Another member opens **Reviews**, reads the change, and either **Approve and publish**, or
   **Reject** with a comment saying what needs to change. Nobody approves their own change.
3. Until something is published, plans skip the test. Rolling back to a version that was live
   before stays possible without a review.

## Suites {#suites}

A **suite** is a list of tests kept once and included by as many plans as need it. **Suites → New
suite** makes one of two kinds:

- **Static**: these tests, in the order you pick them — web, API and [mobile app](./mobile-apps)
  tests alike.
- **Dynamic**: every test that carries **all** the chosen tags, worked out each time a run is
  created. A test tagged later is included in the next run without editing anything — web, API
  and [mobile app](./mobile-apps#tags) tests alike.

A suite shows which plans include it. Deleting one used by plans makes them stop running its
tests; runs already made keep what they ran.

## Requirements and coverage {#requirements}

**Requirements** answers the question asked before a release: which stories are tested, which are
failing, and which have no test at all.

A requirement is an **epic**, a **user story** or a plain **requirement**, with a key (`SHOP-142`,
`4711`, `REQ_12`), a title, and the epic it belongs to. Add one with **New requirement**, or
**Import from tracker** through a Jira or Azure DevOps already connected in
**Settings → Issue trackers**:

- **The project's epics and stories** (Jira: issue types Epic and Story; Azure DevOps: Epic,
  Feature, User Story, Product Backlog Item, Requirement);
- **These keys**: `SHOP-142, SHOP-143`, or work item ids;
- **A JQL query** (Jira) or **a WIQL query** (Azure DevOps), for example the stories of a release.

An imported story brings its epic along, and each lands under its parent. Importing again, or
**Sync imported**, updates titles, types and the tracker's status; a requirement typed by hand
with the same key becomes the imported one, keeping its tests. Nothing is ever written to the
tracker. At most 500 items come in at once.

**Tests** on a requirement links the web, API and [mobile app](./mobile-apps) tests that cover it. An epic counts its own tests
and every one of its stories', each once. Its coverage is worked out from the **latest result of
each test**, all browsers of that run together:

| Coverage | Means |
|---|---|
| **Passing** | Every covering test passed the last time it ran. |
| **Failing** | At least one failed (on any browser). |
| **Not run** | None failed, but some never ran, were skipped, or are manual tests waiting for a verdict. |
| **No tests** | Nothing covers it. |

**Results from** narrows which runs count: the latest run of each test anywhere, or the latest run
of one plan — the release plan, say. **Requirements covered** in a run's report opens the page with
exactly that run's results. The numbers above the table give the total, the share with at least
one test, and how many are in each state. The numbers of a row open its tests, each with its last
outcome and a link to that run's report.

**Export matrix (CSV)** downloads the traceability matrix for what is shown: one line per
requirement and covering test, with its last outcome, run and plan, and one line for each
requirement no test covers.

A linked test in a project you cannot see is counted (*+1 in projects you cannot see*) but not
named, left out of the state, and stays linked when you change the others. Viewers read; editors
add, import, link and delete. Deleting a requirement removes its links, never the tests; what it
contained moves to the top level.

### Tests from a story {#tests-from-a-story}

The sparkle button on a requirement's row proposes test cases for it, when the operator has set up
the AI model. It reads the story as the tracker has it **now** — its description and its acceptance
criteria (Jira: the fields named *Acceptance criteria*; Azure DevOps: *Acceptance Criteria*) — or,
for a requirement typed in here, its description. **Propose tests** asks for up to the number
chosen (6 by default, at most 12), written in the language of the interface: the main path, the
mistakes a user can make, and the limits, each with the criterion it covers, its preconditions and
its steps (an action and the result expected).

Nothing is created until you say so. Every case can be renamed and corrected — steps added,
removed, rewritten — and unticked; **Create** makes the ticked ones **manual tests**, linked to the
requirement, the preconditions as their first step. They run in plans like any manual test, and
their steps are sentences that [describing a test in sentences](./web-tests#describing-a-test-in-sentences) turns into an
automated test later. A name that is already taken refuses the lot and is shown in red; nothing is
half created. **Propose again** asks for new cases. Editors only; the story's text is sent to the
model (see [AI features](../security/#ai-features)), and nothing is written to the tracker.

## Test Manager

**Test Manager** is for teams whose test cases live in Excel. **Upload Excel** (.xlsx or .xls)
imports one case per row, with its id, priority and objective. Map each case to a saved test
(**Choose a sequence**), select the cases, and **Run selected**; the status and the latest report of
each case are shown next to it.
