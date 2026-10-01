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
| **Press key** | Presses a key or a combination — `Enter`, `Tab`, `Escape`, `Control+A` — on the element, or on whatever has focus when the step has none. |
| **Double-click** / **Right-click** | Double-clicks, or opens the element's context menu. |
| **Drag and drop** | Drags the element onto the one whose selector is the value. |
| **Upload file** | Gives a file input — or the button that opens the file chooser — a file made from the value: `invoice.csv`, or `invoice.csv\|its content`. |
| **Answer dialog** | Says how to answer the next `alert`, `confirm` or `prompt`: `accept`, `dismiss`, or `accept:text`. Put it **before** the step that opens the dialog. A dialog nobody answered is dismissed. |
| **Switch tab** | Continues in another tab: empty for the newest, a number (from 1), or text in its address or title. |
| **Close tab** | Closes the current tab and goes back to the one that opened it. |
| **Store text in variable** | Reads the element's text, or a field's value, into the variable the value names, for later steps. |
| **Set variable** | `name=value`, for later steps. See [generated values](#generated-values). |
| **Wait for email** | Waits for the email sent to an address and reads its code and link into variables. See [emails](#emails). |
| **Query database** | Runs a SQL statement against the environment's database and reads the first row into variables. See [database](#database). |
| **Assert values** | Fails unless a comparison holds: <code v-pre>{{db.value}} == 1</code>, <code v-pre>{{total}} > 0</code>, <code v-pre>{{email.subject}} contains Welcome</code>. The same comparisons as a condition without an element. |
| **Set cookie** / **Clear cookies** | `name=value` for the current address; or deletes them all. |
| **Set localStorage** | `key=value` in the current page's storage. |
| **Run JavaScript** | Runs the value in the page. Fails when it throws or returns `false`, so it can check what no other step can. |
| **If** / **Else** / **End if** | Runs steps only when a condition holds. See [conditions and loops](#conditions-and-loops). |
| **Repeat** / **Repeat while** / **End loop** | Runs steps a number of times, or while a condition holds. |

Every action already waits for its element to be ready before acting, so a fixed **Wait** is
rarely needed; when a step fails because something was slow, wait for the thing itself.

Change a step's action or element from the step, remove it with its bin, and **Clear** to start
again.

A recorded **Enter** is replayed as a **Press key** step after the value of the field it was
pressed in, so a search submitted with Enter is submitted again on replay.

## Conditions and loops {#conditions-and-loops}

**If**, **Else** and **End if** are steps like any other, placed around the steps they govern;
**Repeat** or **Repeat while** and **End loop** likewise. The builder indents what is inside a
block, and lists the blocks that do not close; a test with one fails before a browser is opened,
naming the step.

A condition takes one of two forms:

- **With an element**: the state it is in *now* — `visible`, `hidden`, `exists`, `missing`,
  `checked`, `unchecked`, `enabled`, `disabled`, or `contains:text` / `not contains:text`. The
  answer is immediate: "if the cookie banner is visible, close it" moves on at once when there is
  no banner. For something still loading, put a wait step before the condition.
- **Without an element**: a comparison of values — <code v-pre>{{status}} == Paid</code>,
  <code v-pre>{{count}} > 3</code>, <code v-pre>{{title}} contains Order</code>, with `==`, `!=`,
  `>`, `<`, `>=`, `<=`, `contains`, `not contains` — or a variable holding `true` or `false`.

**Repeat** takes a number of times; inside it <code v-pre>{{loopIndex}}</code> counts from 1.
**Repeat while** asks its condition before every pass. A loop stops the test after 200 passes,
so a condition that never turns false does not hold a worker forever. With visual testing, each
pass of a loop is compared with its own baseline.

## Trying it

**Execute Test** runs the sequence in a browser on the server and plays the result back step by
step in the preview, with a screenshot of each step. A failed step says why. Nothing is saved by
running.

## Debugging {#debugging}

**Debug** runs the sequence so that it can stop, be corrected and go on, while the browser is
still open:

- **Breakpoints**: click a step's dot to turn it red. The run stops before that step. A breakpoint
  on a step group call stops at the group's first step. Breakpoints can be set and cleared while a
  session runs.
- **Where a step fails** the run does not end: it stops there, with the error.

When it stops, the **Debugger** panel shows why, the page at that moment and its address, the
steps run so far and the variables (values that come from the environment are secrets: only their
names are shown). The step it stopped at has a coloured outline on the canvas. From there:

| Command | Does |
|---|---|
| **Continue** | Runs on to the next breakpoint, failure or the end. |
| **Step** | Runs this step and stops before the next one. |
| **Retry** | After a failure: runs the step again, with the correction if there is one. |
| **Skip** | Passes over this step. Not offered for if, else, loops and their ends. |
| **Stop** | Ends the run and closes the browser. |
| **Pause** | While running: stops before the next step. |

The step's **selector** and **value** can be corrected before continuing, stepping or retrying.
A correction to one of the test's own steps is also copied into the canvas; **save** the test to
keep it. A correction to a step inside a step group applies to that run only.

A run that passed over a step is never reported as passed. A data-driven test is debugged with one
row of its dataset, chosen next to **Debug** (the first unless you pick another). A session left paused for 15 minutes closes its browser. Each person has one session at
a time: starting another stops the first.

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
the rest is read by the model as well (lines marked **AI**). Without AI that includes keys
(`Press Enter in the Password field`), `Double-click …` / `Right-click …`, `Upload invoice.pdf to
the Attachment field`, `Accept the dialog` / `Accept the prompt with "42"`, tabs, cookies and
`Save the text of … as orderNumber`.

## Variables and environments {#variables-and-environments}

Any value in a step can contain <code v-pre>{{name}}</code> placeholders, filled in when the test
runs:

- from the **environment** chosen in the builder, the plan's run, or the schedule: its secrets
  (**Settings → Environments**), for example <code v-pre>{{ADMIN_PASSWORD}}</code>. A secret named
  `baseUrl` sets <code v-pre>{{baseUrl}}</code>, so one test can start at
  <code v-pre>{{baseUrl}}/login</code> on every environment;
- from a **dataset** row (below);
- <code v-pre>{{locale}}</code>, the language a plan runs the test in (see
  [Testing in several languages](./running#languages));
- from values captured by an API test earlier in the same run.

- from **Store text in variable** and **Set variable** steps earlier in the same test. Those
  values belong to that run only.

A placeholder nothing defines is not blanked: the step fails and names the missing variable.

### Generated values {#generated-values}

A placeholder starting with `$` makes up a value each time it is used, wherever variables are
accepted — a step, a URL, an API test:

| Placeholder | Value |
|---|---|
| <code v-pre>{{$randomEmail}}</code> | `test.k3v9…@example.com` (a domain that delivers nowhere) |
| <code v-pre>{{$uuid}}</code> | A random UUID |
| <code v-pre>{{$randomInt(1,100)}}</code> | A whole number between the two, included (0–1000 by default) |
| <code v-pre>{{$randomString(8)}}</code> | Letters and digits |
| <code v-pre>{{$randomDigits(6)}}</code> | Digits only |
| <code v-pre>{{$today}}</code>, <code v-pre>{{$today(+7)}}</code> | A date, `yyyy-mm-dd`, today or that many days away |
| <code v-pre>{{$now}}</code>, <code v-pre>{{$timestamp}}</code> | The current time, ISO or in milliseconds |
| <code v-pre>{{$totp(secret_mfa)}}</code> | The code an authenticator app shows now for the seed in the variable named; see [two-step sign-in](#totp) |

Each placeholder is a new value. To use one twice — register with an address, then log in with
it — give it a name first: **Set variable** <code v-pre>email={{$randomEmail}}</code>, then
<code v-pre>{{email}}</code>. A misspelt generator fails the step like a missing variable.

Secret values are encrypted, never shown again after saving, and masked in logs.

### Two-step sign-in with an authenticator app {#totp}

When the application asks for the six-digit code of an authenticator app (Google Authenticator,
Microsoft Authenticator…), <code v-pre>{{$totp(name)}}</code> types the code the app would show at
that moment. Enrol the test account once, and keep what the application showed as a secret of the
environment, say `secret_mfa`: the key written under the QR code (`JBSW Y3DP EHPK 3PXP`, spaces
and case do not matter), or the address the QR code holds (`otpauth://totp/…?secret=…`), which
also carries the number of digits, the period and the algorithm when they are not the usual 6, 30
seconds and SHA-1. Then the step **Type** <code v-pre>{{$totp(secret_mfa)}}</code> in the code field.

The argument is the variable's **name**, never the key itself, so the key stays encrypted and out
of the test. A name the environment does not define, or a value that is not a key, fails the step
and names it. The code is worked out from the runner's clock, which must be right to within a few
seconds.

### Starting signed in

To skip the login in every test: choose the environment in the builder, start a recording, sign in
inside the recording window, and press **Save login for this environment**. Runs against that
environment then start with that session; the environment shows as *signed in* in the picker. Save
it again when the session expires.

### Emails: codes and links {#emails}

Sign-up, password reset and two-step sign-in send an email the test has to read. The
**Wait for email** step reads it from the environment's **test inbox**, a
[Mailpit](https://mailpit.axllent.org): a mail catcher that accepts everything the application
sends to its SMTP port, for any address. Point the application's SMTP at it in the test environment
(port 1025) and every address has a mailbox, including made-up ones.

A sign-up, start to end:

| Action | Value |
|---|---|
| Set variable | <code v-pre>email={{$randomEmail}}</code> |
| Type | <code v-pre>{{email}}</code> in the address field, then submit the form |
| Wait for email | <code v-pre>{{email}}\|Confirm your account</code> |
| Type | <code v-pre>{{email.otp}}</code> in the code field — or **Navigate** to <code v-pre>{{email.link}}</code> |

The value is the address, optionally followed by `|` and text the subject contains, and by a
second `|` and a regular expression for the code: <code v-pre>{{email}}|Your code|code: ([A-Z0-9-]+)</code>
reads what its first group matches. The step waits up to 60 seconds for the newest email to that
exact address (in To, Cc or Bcc) that arrived **after the test started**, so a fixed address such
as a seeded user's does not read the email of the previous run. Then it sets:

| Variable | Holds |
|---|---|
| <code v-pre>{{email.otp}}</code> | The code: the first 4–8 digit number after a word such as *code*, *OTP*, *PIN* or *verification*, or the only one in the email; with a pattern, what the pattern found |
| <code v-pre>{{email.link}}</code> | The first link to follow, skipping unsubscribe links, images and stylesheets |
| <code v-pre>{{email.subject}}</code>, <code v-pre>{{email.from}}</code>, <code v-pre>{{email.text}}</code> | The subject, the sender's address and the text (an HTML-only email is turned into text) |

A variable the email did not provide — no code, no link — is left undefined, so a later step that
uses it fails and names it, rather than typing a value from an earlier email. A pattern that
matches nothing fails the step.

**Which inbox.** The environment's secrets `mailpit.url` (for example `https://mail.staging.example`)
and, when it asks for them, `mailpit.username` and `mailpit.password`; `mailpit.timeout` changes
the wait, in seconds. Without them, the server's own (`MAILPIT_URL`, which the docker-compose stack
sets to its bundled Mailpit, open at http://localhost:8025). The inbox is read from where the
browser runs, so a plan on a local agent reaches a Mailpit on the agent's network.

### Database: checking and preparing data {#database}

What a screen does not show — the row the checkout wrote, the flag an admin page set — or what a
test must prepare without clicking through ten screens, a **Query database** step reads or writes
directly. Its value is a SQL statement, with variables:

| Action | Value |
|---|---|
| Query database | <code v-pre>SELECT status, total FROM orders WHERE email = '{{email}}'</code> |
| Assert values | <code v-pre>{{db.status}} == Paid</code> |

It sets:

| Variable | Holds |
|---|---|
| <code v-pre>{{db.value}}</code> | The first column of the first row (empty when there is no row) |
| <code v-pre>{{db.column}}</code> | Each column of the first row by its name — <code v-pre>{{db.status}}</code>, <code v-pre>{{db.total}}</code>; characters other than letters, digits, `_` and `.` become `_`, so name computed columns (`count(*) AS n`) |
| <code v-pre>{{db.rowCount}}</code> | The rows returned, or those an INSERT, UPDATE or DELETE changed |
| <code v-pre>{{db.json}}</code> | The first 100 rows, as JSON |

Dates are ISO, empty values are empty text. Each query forgets the previous one's columns, so a
column this query did not return is undefined rather than left over. A statement the database
refuses fails the step with the database's message.

**Which database.** The environment's secret `db.url`, an address whose scheme picks the database:

| Database | Address |
|---|---|
| PostgreSQL | `postgres://user:password@host:5432/shop` (`?sslmode=require` for TLS) |
| MySQL, MariaDB | `mysql://user:password@host:3306/shop` |
| SQL Server | `sqlserver://user:password@host:1433/Shop` — `sqlserver://…@host%5CSQLEXPRESS/Shop` for a named instance; `?encrypt=false` for a server without TLS, `?trustServerCertificate=true` for a self-signed certificate |

Characters such as `@` or `/` in the password are written as `%40` and `%2F`. For a second
database, name it: `db.reporting.url` and the value <code v-pre>@reporting SELECT …</code>.
`db.timeout` changes the 30-second limit, in seconds. At most 1000 rows are kept.

The statement runs with the rights of the user in the address: use a user that can read only what
the tests check, and write only what they prepare, and never a production database. The query runs
from the WebFlowMaster runner, not from the browser — also on a local agent — so the runner must
reach the database. Values are put into the SQL as they are: quote text (`'{{email}}'`), and use
variables whose values the test controls.

## Preconditions

**Preconditions** are API calls that run before the steps, to put the application in the state the
test needs — create a customer, empty a cart. Pick them from your saved
[API tests](./api-tests); they run in the order listed. A test whose precondition fails is reported
as blocked, not as failed.

## Datasets

To run the same test over several inputs, give it a **dataset**: a table whose column names become
variables. The test runs once per row. Build it by adding columns and rows, or **Paste from a
spreadsheet**: copy the block from Excel or Google Sheets, header row included.

When the rows are shared with other tests, keep them in a [shared data set](./organizing#test-data)
and choose it in **Use a shared data set** instead: the test keeps only a link, runs over the
set's rows as they are at the time of the run, and follows the set if it is renamed. **Use a copy
as this test's own rows** turns the link back into rows of its own.

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
  generated values. A missing or unknown argument, or a value without `=`, fails the test before
  the browser opens — in the builder's **Run test** as in a plan — naming the argument.
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
