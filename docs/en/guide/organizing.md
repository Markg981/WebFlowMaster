# Organizing tests

## The test library

**Test Library** lists every saved web test: its tags, where it starts, and when it was last saved.
Search by name, or filter by clicking a tag. From each row you can open its **History**, change its
tags, or **Delete** it (with its history).

The library loads 25 summaries per page and shows the total matching your filters. Use
**Previous** and **Next** to browse. Name search ignores letter case and matches literal text
(including `%` and `_`); multiple selected tags require every tag. Project and status filters
apply before pagination, and changing a filter returns to the first page. API tests, mobile
tests and shared test data also use paginated lists. Each list loads full definitions only
when needed: editing a manual or BDD test fetches its steps, editing a data set fetches its
table, and loading or running an API/mobile test fetches its executable configuration.
List responses contain metadata and counts, rather than all steps or dataset values.

**Tags** are your organization's own labels — `smoke`, `checkout`, `nightly` — added from the test's
row. They are what [dynamic suites](#suites) select by.

## Manual tests {#manual-tests}

Use **Test Library → New manual test** to save a human procedure with its steps. A plan records
manual outcomes rather than turning sentences into browser actions. Review and publish it
through the same version workflow. Gherkin editing and execution are in [BDD tests](./bdd-tests).

**Gherkin/Cucumber files.** In **Files**, select **Gherkin (.feature)** to export web tests,
or open a `.feature` file and preview its import. Standard multilingual Gherkin includes Rule,
backgrounds, doc strings, step tables and tagged Examples. Choose manual execution or an authorized
Cucumber profile on your organization's dedicated agent. Executable portable imports require an
explicit destination binding; support definitions are operator-installed JavaScript/TypeScript.
WebFlowMaster metadata restores original browser actions or versioned BDD definitions. See
[Gherkin file details](../../gherkin-files).

## Comments

Open **Comments** on a saved web, API or mobile test, or on a test result in a report.
Reply, mention members who can read the target, and resolve conversations. See
[Conversations and dashboards](./collaboration#discussing-a-test-or-result) for permissions,
filters and deletion behavior.

## Dashboards

Keep several private dashboards or share them with your organization. Select a personal default
and customize widget instances, filters, titles and widths. Existing personal layouts are retained.
See [Conversations and dashboards](./collaboration#choosing-and-sharing-dashboards).

## Writing a manual test

Not everything is worth automating: a check done once a release, a flow that needs a person's
judgment, a device no browser can stand in for. **New manual test** in the library writes one: a
name and its steps, each an **action** to perform and the **expected result**. It shows in the
library with a **Manual** badge, and its pencil edits the steps. Every step needs its action:
empty steps are dropped on save, and a manual test with none is refused — through the API too.

A manual test is a test like the others: it has versions and reviews, carries tags, goes into
suites and plans. In a run it opens no browser — it waits in the run's report for somebody's
verdict (see [Manual results](./results#manual-results)), once per run whatever browsers and
languages the plan has.

## History and versions {#history-and-versions}

Web, API and mobile tests have their own **versions**, numbered from 1. Saving a changed
executable configuration creates a revision; saving an unchanged configuration does not.
**History** shows revisions newest first, with their author and date, and lets you compare them.
API comparisons include protocol, request, authorization, assertions, captures, performance and
cleanup; mobile comparisons include platform, app, device, OS, grid and steps.

**Restore** saves the earlier configuration as a new working-copy revision and keeps every
intermediate revision. It does not publish it or change the version plans execute.

Existing API and mobile tests start at version 1 with the configuration saved when the migration
runs. Earlier edits cannot be reconstructed; older results without a version remain unversioned.

## Tests as files {#tests-as-files}

**Test library → Files** exports a project's web and API tests — or all of them — as one YAML or
JSON file, to keep in a repository beside the application, review in pull requests and import into
another installation. The file holds what the tests are (steps, preconditions, cleanup, datasets,
requests, assertions, reporting fields) and nothing that belongs to this installation: no ids,
authors or dates, so a diff shows only what changed in the tests. A literal secret in an API test's
authorization is written as a variable (<code v-pre>{{bearer_token}}</code>…): set it in an
environment where the tests are imported.

**Import** reads such a file back. **Show what changes** lists each test as new, updated, unchanged
or not imported (with the reason); **Import** then saves: a test with the same name is updated and
gets a new [version](#history-and-versions), the others are created in the project chosen. Steps
that call a step group or a custom action, or name a shared element, refer to it by id, so those
tests import into their own organization; the export says how many there are. The CLI does the same
from a pipeline: `wfm tests export` and `wfm tests import` ([CLI](../reference/cli)).

**As a Playwright test.** The file icon on a web test downloads it as a Playwright Test file
(`*.spec.ts`), with the steps a run executes — step groups and custom actions expanded, shared
elements resolved. Variables come from environment variables named `WFM_<NAME>`
(`WFM_BASEURL` for <code v-pre>{{baseUrl}}</code>); preconditions run first through Playwright's
request fixture and the cleanup afterwards, whatever happened; a dataset becomes one test per row.
Steps with no equivalent outside WebFlowMaster — waiting for an email, a database query, the
accessibility scan — are written as comments, and the file's first lines say how many.

## Publishing and reviews {#publishing-and-reviews}

These rules apply to **web, API and mobile** tests. A saved test is a **working copy**. Plans run the **published** version when there is one; if a
test was never published, plans run its latest save — unless your organization requires reviews.

The publishing panel of a test says which version plans run and whether there are newer changes:

- **Publish version N** makes plans run that version from their next run.
- **Roll back to this**, in the history, makes plans run an earlier published version again.

When an owner turns on **Require a review to publish** (in **Reviews**), publishing a version takes
another authorized member's approval. The shared **Reviews** page includes all three test kinds:

1. The author uses **Ask for review of version N**, with a note for the reviewer.
2. Another member opens **Reviews**, reads the change, and either **Approve and publish**, or
   **Reject** with a comment saying what needs to change. Nobody approves their own change.
3. Until something is published, plans skip the test. Rolling back to a version that was live
   before stays possible without a review.

History, publishing and review operations respect organization and restricted-project access.
Editing after publication leaves plans on the published revision. A direct API test or mobile
debug run uses the saved working copy; the mobile run captures that configuration when requested,
so a later edit cannot change an already requested run. Plan results record the revision executed.

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

| Coverage     | Means                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| **Passing**  | Every covering test passed the last time it ran.                                          |
| **Failing**  | At least one failed (on any browser).                                                     |
| **Not run**  | None failed, but some never ran, were skipped, or are manual tests waiting for a verdict. |
| **No tests** | Nothing covers it.                                                                        |

**Results from** narrows which runs count: the latest run of each test anywhere, or the latest run
of one plan — the release plan, say. **Requirements covered** in a run's report opens the page with
exactly that run's results. The numbers above the table give the total, the share with at least
one test, and how many are in each state. The numbers of a row open its tests, each with its last
outcome and a link to that run's report.

**Export matrix (CSV)** downloads the traceability matrix for what is shown: one line per
requirement and covering test, with its last outcome, run and plan, and one line for each
requirement no test covers.

A linked test in a project you cannot see is counted (_+1 in projects you cannot see_) but not
named, left out of the state, and stays linked when you change the others. Viewers read; editors
add, import, link and delete. Deleting a requirement removes its links, never the tests; what it
contained moves to the top level.

### Tests from a story {#tests-from-a-story}

The sparkle button on a requirement's row proposes test cases for it, when the operator has set up
the AI model. It reads the story as the tracker has it **now** — its description and its acceptance
criteria (Jira: the fields named _Acceptance criteria_; Azure DevOps: _Acceptance Criteria_) — or,
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

## Shared test data {#test-data}

The same customers, products or cards used to be copied into test after test, and drifted apart.
**Test data** keeps them once for the whole organization: a set has a name (`customers`), a
description and a table. Viewers can read the sets; editors create and change them.

The manager lists names, descriptions and row/column counts in pages of 25, with the matching
total and **Previous/Next** controls. Search by literal name, ignoring letter case. Open
**Edit** to load the selected set's columns and rows; browsing the list does not download
every table. Creating, changing or deleting a set refreshes the list.

A set is used two ways:

- **Values, in any test.** <code v-pre>{{data.customers.email}}</code> is the `email` column of the
  first row of `customers`, in a UI step, an API request or a mobile step, in plans and in the
  builder alike. Environment values with the same name win, so an environment can override one.
- **Rows, for a UI test.** In the test's dataset, **Use a shared data set** makes the test run once
  per row of the set, with its columns as <code v-pre>{{column}}</code> — see
  [Datasets](./web-tests#datasets).

Names are lowercase letters, digits and underscores; columns are letters, digits and underscores,
so a placeholder can name them. A set holds up to 1,000 rows and 50 columns. A set that a test runs
over cannot be deleted until that test stops using it; the refusal names the tests. Creating,
changing and deleting a set are recorded in the audit log.
