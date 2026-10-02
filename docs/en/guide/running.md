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
   [Mobile app tests](./mobile-apps#in-a-test-plan) can be picked too: they run once per run, on
   the device and grid they name, whatever the browsers.
3. **Settings**: screenshots (on failed steps by default, always, or never), timeouts, what to do
   when a step or a prerequisite fails, how many times to re-run a failed test, and
   notifications.

## Plan settings

**Settings** on a plan's row changes how its next run behaves:

| Setting | What it does |
|---|---|
| **Browsers** | Every test runs once per browser listed, each on the desktop or as a phone or tablet ([devices](#mobile-devices)). None listed: the browser from your own settings. |
| **Languages** | Language codes such as `it-IT, en-US` (at most 10). Every test runs once per language on each browser; see [Testing in several languages](#languages). Empty: the browser's own language. |
| **Run at most (tests at once)** | 1 to 16 browser sessions at the same time. 1 runs the plan one test at a time, browser by browser. |
| **Workers sharing a run** | 1 to 8 runners for one run, each running the number above at once; see [One run on several runners](#shards). 1 keeps the run on one runner. |
| **Keep a recording of the run** | A **video** and a Playwright **trace** of each test — never, when the test fails, or always — and the **network** traffic as a HAR file. They answer what a screenshot cannot, and use disk on every run. |
| **Visual testing** | Compares each step's screenshot with its baseline; see [Visual testing](./results#visual-testing). |
| **Run on** | This server's runners, a pool of [local agents](../LOCAL_AGENT) inside your own network, or a [browser grid](#browser-grids). |
| **File failures in** | An issue tracker (Jira, Azure DevOps) connected by an owner. With **Open an issue when a test fails**, each failing test and browser gets one issue; the same failure later is added to it as a comment. |
| **Publish results to** | TestRail, Xray or Zephyr Scale, connected in **Settings → Test management**: every finished run is published there case by case; see [Publishing to TestRail, Xray or Zephyr](./results#test-management). |
| **Send notification when** and the webhook URL | A message to a Slack or Microsoft Teams incoming webhook, or any URL that accepts a POST, when a run passes, fails, is not executed or is stopped. The e-mail addresses listed there are mailed too, when the installation sends e-mail. |

**Suites** on the row adds [suites](./organizing#suites): they run after the plan's own tests, in the
order ticked, and a test in more than one runs once.

### One run on several runners {#shards}

A long plan finishes sooner when several runners share it. With **Workers sharing a run** above 1,
the runner that takes the run writes its work down — one piece per test on each browser and language
— and asks the queue for helpers. Every runner that joins, the first included, takes the next piece
nobody holds, runs it, and takes another, so a slow test never holds up a fixed batch.

- The report is one run, as always: one set of results, one verdict, one notification.
- A plan whose API tests capture values for later requests keeps them together: each browser and
  language is one piece, run in order on one runner.
- A runner that stops while it holds a piece (a crash, a lost machine) stops answering; after two
  minutes another runner takes that piece back and runs it.
- A stop policy (for example *stop the run* on a failure) stops every runner: tests not started yet
  are recorded as skipped, with the reason.
- Helpers are ordinary jobs on the queue: they take free runners, and only help if there are any.
  With no free runner the first one runs every test itself, and the log says so.

### Browser grids {#browser-grids}

The runners have Chromium, Firefox and WebKit on the system they are installed on. For Windows
and macOS, branded Chrome and Edge, or an older version, a plan can borrow its browsers from a
**browser grid**, added in **Settings → Browser grids**:

| Provider | Needs | OS and versions |
|---|---|---|
| **BrowserStack** | Username and access key | Honoured |
| **LambdaTest** | Username and access key | Honoured |
| **Playwright server** — your own `npx playwright run-server`, Browserless, Moon… | Its `ws://` or `wss://` address, and a token if it asks for one (where the address has `{token}` it goes there, otherwise as a bearer token) | Not honoured: it runs the browsers it has |
| **Local Appium (agent)** | A pool of local agents and Appium's address | Runs [mobile app tests](./mobile-apps#local-appium) only, not a plan's browsers |

The key is stored encrypted and never shown again. **Test connection** opens one short Chromium
session on the grid and says whether it worked. A Playwright server must run the same Playwright
version as the runners.

With **Run on** set to a grid, each browser row of the plan also takes an **operating system**
(Windows or macOS), its **version** (`11`, `Sonoma`) and a **browser version** (`latest` when
empty). Each row is a pass of the run, and the report labels it with its machine — *chrome ·
Windows 11*, *chrome · macOS Sonoma*. Without an OS, WebKit runs on macOS and everything else on
Windows 11. Safari on a grid is still Playwright's WebKit.

Each test is a session on the provider's dashboard, named after the test, grouped under the run,
and marked passed or failed. Deleting a grid sends the plans that used it back to the server's
runners. A plan runs on a grid or on local agents, never both.

### Phones and tablets {#mobile-devices}

**Device** on a browser row of the plan's settings makes that browser a phone or a tablet:
iPhone 15, iPhone 15 Pro Max, iPhone 14, iPhone SE, iPhone 13 Mini, Pixel 7, Pixel 5, Galaxy S24,
Galaxy A55, iPad Pro 11, iPad Mini, Galaxy Tab S9 (tablets also in landscape). The page then sees
that device: its screen size and pixel density, touch instead of a mouse (`pointer: coarse`), the
mobile layout (`<meta name="viewport">` is honoured) and its user agent, so a responsive site shows
the menus, sizes and pages it shows on that phone. Each row is a pass of its own: Chromium on the
desktop and Chromium as a Pixel 7 are two results per test, and the report says which is which
(`chromium · Pixel 7`).

Choose the engine the device's own browser is built on — **WebKit** for an iPhone or an iPad,
**Chromium** or **Chrome** for Android — for the closest result. **Firefox** cannot emulate a device;
the choice is not offered for it. Devices are set in the plan's settings (not in the plan wizard),
and work on the server's runners, on [local agents](../LOCAL_AGENT) and on a [browser grid](#browser-grids),
whose desktop browser then shows the device.

This is emulation, not a real phone: what depends on the device itself — iOS Safari's own
behaviour, the on-screen keyboard, the phone's speed, native apps — needs real devices, which come
with mobile app testing.

### Testing in several languages {#languages}

With **Languages** set, each language is a run of the plan of its own on each browser: two
browsers and three languages are six passes. In each one the browser starts in that language —
the `Accept-Language` header the application receives, `navigator.language`, and the number and
date formats of the page — and <code v-pre>{{locale}}</code> holds the code, for UI and API tests
alike.

A check whose text changes with the language goes inside an **If** on
<code v-pre>{{locale}}</code> (see [conditions and loops](./web-tests#conditions-and-loops)):

| Step | Value |
|---|---|
| If (no element) | <code v-pre>{{locale}} == it-IT</code> |
| Assert Text Contains | `Accedi` |
| Else | |
| Assert Text Contains | `Sign in` |
| End if | |

The report labels every result with its browser and language (`chromium · it-IT`), and with
visual testing each language is compared with its own baselines.

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

### Running only what a change affects {#impact}

A pipeline that runs the whole plan on every commit waits for tests the commit cannot have
broken. **Settings → Impact map** says which files affect which tests: each rule maps a file
pattern to one of your [tags](./organizing#the-test-library) — `src/checkout/**` → `checkout`. A rule with
**No test** marks files that affect nothing, such as `docs/**` or `*.md`.

Start the run with the files the commit changed — `wfm run <plan> --changed-since origin/main`, or
the `changed-since` input of the GitHub Action — and it runs:

- the tests carrying a tag a changed file maps to;
- the tests the map does not cover (none of their tags appears in a rule), since nothing says the
  change cannot break them;
- the tests that failed or errored in the plan's last finished run, so the run that should show a
  fix does.

It errs towards running more: a changed file **no rule matches** runs the whole plan, and with no
rules at all every test runs. The run's log, the API's `selection` field and the CLI say what was
decided — for example *3 changed file(s) affect the tags checkout: 7 of 40 tests run* — so a test
that did not run is a choice, not a gap. **Try it on a change** in the same settings section shows
which tests a list of files would run, without running them.

Patterns are git-style: `**` any path, `*` and `?` within one folder, `{ts,tsx}` either; a pattern
without `/` names a file anywhere (`*.md`), and one ending in `/` a whole folder.
