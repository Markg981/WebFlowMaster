# Web tests

A web test is a **sequence of steps** a browser performs on your application: go to a page, type
into a field, click, check what appears. You build it in **Create Test**.

## Loading the application

1. Enter the address in **Website URL to Test** and press **Load Website**. The page is opened by
   a real browser on the server, and a screenshot appears in **Website Preview**.
2. Press **Detect Elements**. The list of **Detected Elements** shows what can be clicked, typed
   into or checked on the page — buttons, fields, links, dropdowns — each with the selector the
   test will use to find it.

Only what is visible when the page is loaded is detected. For an element that appears later (a
menu that opens, a second page), add steps that get there, execute them, and detect again.

## Building the sequence

Drag an action from **Available Actions** into the **Test Sequence**, then drop a detected element
on it (or use **Set Element**). Fill in the value the action needs: the text to type, the option to
choose, the text to expect.

| Action | What it does |
|---|---|
| **Navigate** | Goes to an address. |
| **Click Element** | Clicks. |
| **Input Text** | Types into a field. |
| **Select Option** | Chooses an option of a native dropdown. |
| **Pick From Dropdown** | Opens a custom dropdown and picks an option by its text. |
| **Hover** | Moves the mouse over an element (for menus that open on hover). |
| **Scroll** | Scrolls the page or an element. |
| **Ensure State** | Switches a checkbox or toggle on or off, only if it is not already. |
| **Wait** | Waits a fixed number of milliseconds. Prefer the waits below. |
| **Wait For Element** | Waits until an element is visible, or hidden. |
| **Wait For Text** | Waits until an element contains a text. |
| **Wait For Network** | Waits until the page's requests have settled. |
| **Assert Visible** | Fails unless the element is visible. |
| **Assert Text Contains** | Fails unless the element contains the text. |
| **Assert Element Count** | Fails unless the number of matching elements is right, e.g. `==1`, `>=5`, `<3`. |
| **Assert state** | Fails unless a control is checked, enabled, editable — or the opposite. |
| **Check accessibility** | Checks the page with axe-core at that point, and fails on violations at or above the severity you choose (serious by default). |

Every action already waits for its element to be ready before acting, so a fixed **Wait** is
rarely needed; when a step fails because something was slow, wait for the thing itself.

Change a step's action or element from the step, remove it with its bin, and **Clear** to start
again.

## Trying it

**Execute Test** runs the sequence in a browser on the server and plays the result back step by
step in the preview, with a screenshot of each step. A failed step says why. Nothing is saved by
running.

## Recording

With **Test Creation Mode → Record user actions**, **Start recording** opens a browser window where
you use the application as usual; each click and each thing typed becomes a step. Use **Add
assert** in the recorder's toolbar to record an expected result. **Stop recording** puts the steps
in the sequence, replacing what was there.

::: warning The recorder opens on the server's machine
The recording window is a real browser on the machine that runs WebFlowMaster, not a tab in your
browser. It works when the server runs on your own computer; on a shared server with no display,
recording is not available, and you build tests by dragging steps or describing them.
:::

Passwords typed while recording are not stored in the test: they become
<code v-pre>{{secret_…}}</code> placeholders, which you define as secrets of an environment.

## Describing a test in sentences

**Describe** turns plain instructions into steps, one per line, in the words a ticket uses:

```text
Go to https://example.com/login
Type "admin" into the Username field
Click the Sign in button
Check that the dashboard is visible
```

**Read the description** shows each line as the step it became before anything is inserted, so a
sentence read the wrong way is caught before it becomes a test that passes for the wrong reason.
Elements are matched against the detected elements, and against a project's element repository if
you choose one. Common phrasings are understood without AI; when the installation has an AI key,
the rest is read by the model as well (lines marked **AI**).

## Variables and environments {#variables-and-environments}

Any value in a step can contain <code v-pre>{{name}}</code> placeholders, filled in when the test
runs:

- from the **environment** chosen in the builder, the plan's run, or the schedule: its secrets
  (**Settings → Environments**), for example <code v-pre>{{ADMIN_PASSWORD}}</code>. A secret named
  `baseUrl` sets <code v-pre>{{baseUrl}}</code>, so one test can start at
  <code v-pre>{{baseUrl}}/login</code> on every environment;
- from a **dataset** row (below);
- from values captured by an API test earlier in the same run.

A placeholder nothing defines is not blanked: the step fails and names the missing variable.

Secret values are encrypted, never shown again after saving, and masked in logs.

### Starting signed in

To skip the login in every test: choose the environment in the builder, start a recording, sign in
inside the recording window, and press **Save login for this environment**. Runs against that
environment then start with that session; the environment shows as *signed in* in the picker. Save
it again when the session expires.

## Preconditions

**Preconditions** are API calls that run before the steps, to put the application in the state the
test needs — create a customer, empty a cart. Pick them from your saved
[API tests](./api-tests); they run in the order listed. A test whose precondition fails is reported
as blocked, not as failed.

## Datasets

To run the same test over several inputs, give it a **dataset**: a table whose column names become
variables. The test runs once per row. Build it by adding columns and rows, or **Paste from a
spreadsheet**: copy the block from Excel or Google Sheets, header row included.

## Step groups

A sequence used by many tests — signing in, choosing a customer — can be saved with **Save as
group**. It then appears under **Step groups** in the palette, and any test can include it. A test
runs the group as it is at the time of the run, so changing the group changes every test that
uses it.

## Custom actions {#custom-actions}

When no built-in action does what a test needs, an editor can write one: **Settings → Custom
actions → New custom action**, with a name, parameters and a script. The action appears under
**Custom actions** in the palette, and a test uses it like any other step.

- **Parameters** are listed separated by commas; a trailing `?` makes one optional
  (`code, qty?`). In the test, the step's value gives the arguments: `code=4711; qty=2`. Write
  `\;` for a semicolon inside a value. Arguments may contain <code v-pre>{{variables}}</code> and
  generated values.
- **The script** is the body of an async function that runs in the page under test. It reads
  its arguments as `args` (`args.code`) and, when the step has an element, that element as
  `element` (found with `document.querySelector`, so a CSS selector). It fails the step by
  throwing an error or returning `false`; whatever else it returns is shown in the report.

```js
const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(args.code));
if (!row) throw new Error(`No order ${args.code}`);
row.querySelector('button.open').click();
```

A custom action has the powers of a **Run JavaScript** step and no others: it runs in the
browser page, never on the server or the runner. Tests refer to the action rather than copying
it, so editing it changes every test that uses it on its next run; an action still used by a test
or a step group cannot be deleted, and the message names what uses it. Creating, changing and
deleting one is recorded in the audit log, without the script.

## Element repository {#element-repository}

When the same element is used by many tests, **keep** it: the bookmark on a detected element saves
it to a project with a name. Tests that use it read its selector from the project, so when the
application changes, correcting the selector once in **Settings → Element repository** fixes every
test.

When a step cannot find its element and the installation has an AI key, the run may **heal** it:
it asks for a new selector, retries, and marks the step *healed* in the report. A healed kept
element shows the old and the new selector in the repository, for you to confirm.

## Saving

**Save Test** asks for a name and, optionally, a project (you can create one there). Saving again
under the same name offers to overwrite. Every save is a new **version** in the test's history
(see [Organizing tests](./organizing#history-and-versions)).
