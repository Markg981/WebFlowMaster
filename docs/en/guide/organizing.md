# Organizing tests

## The test library

**Test Library** lists every saved web test: its tags, where it starts, and when it was last saved.
Search by name, or filter by clicking a tag. From each row you can open its **History**, change its
tags, or **Delete** it (with its history).

**Tags** are your organization's own labels — `smoke`, `checkout`, `nightly` — added from the test's
row. They are what [dynamic suites](#suites) select by.

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

- **Static**: these tests, in the order you pick them.
- **Dynamic**: every test that carries **all** the chosen tags, worked out each time a run is
  created. A test tagged later is included in the next run without editing anything.

A suite shows which plans include it. Deleting one used by plans makes them stop running its
tests; runs already made keep what they ran.

## Test Manager

**Test Manager** is for teams whose test cases live in Excel. **Upload Excel** (.xlsx or .xls)
imports one case per row, with its id, priority and objective. Map each case to a saved test
(**Choose a sequence**), select the cases, and **Run selected**; the status and the latest report of
each case are shown next to it.
