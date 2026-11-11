# Live demo script (English)

A 15-minute demo of WebFlowMaster's features, written for a manager: every step shows a concrete
result and says in one sentence why it matters. It runs on the **Northwind Commerce** organization
of the collaudo stack, with real data: every test, run, log, video and trace is genuine. Only the
run dates are spread over the last two weeks, so there is a trend to show.

Total time: 15 minutes (blocks A–H). Blocks marked _optional_ are skipped when time is short; the
times in brackets are indicative. The Italian version is [demo.md](demo.md).

## The day before

1. Start Docker Desktop, then from the repository root:

   ```powershell
   pwsh marketing/presentazione-direzione/prepara-demo.ps1
   ```

   It starts the collaudo stack and the demo shop, creates the organization and launches about 40
   real runs (15–20 minutes). It ends with «PRONTO per la demo» (ready) or with the list of what to
   fix.

2. Do a full, timed dress rehearsal following this script.
3. Create an **API key** for block F: _Settings → API keys_, scopes `runs:write` and `runs:read`,
   ideally on a service account. Keep it in an environment variable of the demo terminal, never on
   screen:

   ```powershell
   $env:WFM_URL = 'https://wfm.collaudo.test'
   $env:WFM_API_KEY = '<the key>'
   $env:NODE_EXTRA_CA_CERTS = "$PWD\collaudo\collaudo-root.crt"
   Invoke-WebRequest "$env:WFM_URL/cli/wfm.mjs" -OutFile wfm.mjs -SkipCertificateCheck
   ```

   Note the ID of the «Checkout smoke» plan (it's in the URL when you open the plan).

4. Record a full pass of the demo with OBS (or `Win+Alt+R`): it's **plan B** if something doesn't
   start on the day. Otherwise use the promo video (`marketing/promo-video/`) and the brochure
   screenshots (`marketing/brochure/assets/en/`).

5. Install the collaudo CA once among Windows’ trusted roots, otherwise the browser shows a
   certificate warning in front of your manager (Windows asks for confirmation):

   ```powershell
   Import-Certificate -FilePath collaudo\collaudo-root.crt -CertStoreLocation Cert:\CurrentUser\Root
   ```

## One hour before

```powershell
pwsh marketing/presentazione-direzione/prepara-demo.ps1 -SoloVerifica
```

- Interface in **English** (_Settings → Language_), browser zoom at 125%, Windows notifications
  muted, unneeded tabs closed.
- Tabs open in demo order:
  1. `https://wfm.collaudo.test`, signed in as **maya** (`Demo.Video.2026!`), on the Dashboard;
  2. `http://127.0.0.1:6080` (the virtual screen where the recording browser opens);
  3. the PowerShell terminal with the variables from step 3 already set.
- Run the «Checkout smoke» plan once, so the first run of the day doesn't pay for the browsers'
  cold start.

## A. At a glance — Dashboard (1 min)

**Do:** start from the **Dashboard**. Point at the trend of the last 14 days, the pass rate, the
recent runs and the next scheduled run. Press `Ctrl+K` and type “checkout”: the command palette
opens any test or plan.

**Say:** “This is the first thing anyone sees when they open the platform in the morning: how last
night’s tests went, what broke and when. Nobody has to ask anybody where regression testing
stands.”

## B. Creating a test without writing code — Create Test (3 min)

**Do:** _Create Test_ → _Test Creation Mode_ → **Record user actions (auto-record)** → URL
`http://shop.northwind.test/login/` → **Start recording**. Switch to the `127.0.0.1:6080` tab (the
browser appears with the REC bar in about 15 seconds): enter username and password, press Sign In,
then use **Add assert** to add a check on the welcome text and press **Stop recording**. Back in the
builder the steps have appeared by themselves. Save it as “Demo – login”.

**Say:** “Whoever knows the application records the flow by using it, as they would by hand. Every
click becomes a readable step; checks are added with one click. No developer needed.”

Then show, on an existing test (“Sign in with valid credentials”):

- the **variables** `{{username}}` and `{{password}}`, resolved per environment: the same test runs
  in development, staging and production;
- the **element library** and reusable **step groups**: if the login page changes, it’s fixed in
  one place.

**Plan B:** if recording doesn’t start (noVNC down), build the test from actions: _Navigate_,
click, type, check text. The message stays the same.

## C. Running — Test Plans (2 min)

**Do:** _Test Plans_ → “Checkout smoke”. Show the included tests, the browsers (Chromium, Firefox,
WebKit) and the parallelism. Press **Run**. Show the live log and the test-by-test progress. While
it runs, open _Schedules_: “Nightly regression” starts by itself every night.

**Say:** “A plan is the regression that used to be done by hand before every release. You launch it
whenever you want, overnight with a schedule, or from the pipeline on every commit. It runs on three
browsers in parallel, and when it finishes it notifies by email, Slack or Teams.”

## D. Understanding a failure in a minute — Reports (3 min)

**Do:** _Test Plans_ → **“Catalog checks”** → history → open a **failed** run → _Report_. On a
passed test: steps, duration, screenshot. Then, in the **Failed tests** table, open the test that
fails on purpose (“Promo banner”, on chromium and firefox: _Element "#promo" did not contain…_) and
show, in order, from the row’s icons:

1. the **screenshot** at the moment of failure and the error message;
2. the run’s **video**;
3. the **Playwright trace**, replayed step by step with DOM and network;
4. the **network capture** (HAR).

Then **Export**: HTML, PDF, JUnit, Allure. Mention filing an issue (**File**, to Jira or Azure
DevOps) from the failure, with the evidence already attached.

**Say:** “This is where the most time is saved. A failure arrives with everything needed to
understand it: nobody has to reproduce it by hand, nobody has to ask ‘on which machine?’. The PDF is
the evidence to attach to the release or the audit.”

## E. Tests that maintain themselves — Reports → flaky tests and healing (1 min)

**Do:** in _Reports_ open **Tests that disagree with themselves**: tests whose outcome changes for
no reason, with the evidence of every attempt. Show **Quarantine**: the test keeps running but no
longer blocks releases (**Release** takes it out). If a run has a step with the **passed after
healing** badge, open it: written locator, locator used, **Approve** / **Reject**. _(The 11 November
rehearsal had no healing proposals: in that case tell the story with slide 9.)_

**Say:** “The hidden cost of automation is maintenance: tests that fail at random and locators that
break with every redesign. Here flaky tests are isolated with the evidence, and locator repairs are
proposed by the run but approved by a person: nothing happens silently.”

## F. API and CI — API Tester and terminal (2 min)

**Do:** _API Tester_ → “Orders API: create an order”. Send it: show the response, the assertions
(status 201, the order title in the body) and the extracted value `orderId`, used by the following
test “read it back”. Mention the **import** from OpenAPI, Swagger and Postman. The test calls a
public echo service (jsonplaceholder), so it needs an internet connection; without one, show a
finished run from the history.

Then in the terminal:

```powershell
node wfm.mjs run <Checkout smoke plan ID> --wait --junit junit.xml
echo $LASTEXITCODE
```

**Say:** “The same checks work for APIs, which are imported from their specifications instead of
being rewritten. And the pipeline launches everything with one command: zero means green, one
means red. There are ready-made integrations for Azure Pipelines, GitHub, GitLab, Jenkins,
Bitbucket and CircleCI.”

## G. The rest of the platform — one screen per item (2 min)

One sentence each, opening the page:

- **Mobile apps** — Android and iOS with Appium on BrowserStack, LambdaTest or our own devices,
  with the live inspector for choosing locators. _(If the emulator isn’t running, show the
  `marketing/brochure/assets/en/mobile.jpg` screenshot.)_
- **Load tests** — virtual users, ramp-up and thresholds, in the reports next to functional tests.
- **Requirements** and **Test Manager** — epics and stories with calculated coverage; results
  published to TestRail, Xray and Zephyr; the **QA test case hub** imports the team’s cases from a
  git repository.
- **Settings** — organizations isolated by the database, roles, SSO (OIDC/SAML), SCIM, audit log,
  explicit consent before AI is turned on.
- **What’s new** (`/whats-new`) — every change to the installation, with its pull request.

## H. Optional — Our own case: DMO (3 min)

The block that makes the demo concrete for AVEVA: the NCC cases that used to be rows in an Excel
sheet, run as automated tests against the local DMO installation.

**Prerequisites:** project “DMO NCC Demo” and plan “DMO NCC - Collaudo automatico” in the collaudo
stack, local DMO on `https://localhost:7000`, Windows agent of the `dmo-local` pool running on this
laptop. Try the plan the day before: local DMO sometimes shows the popup
_No keyed service for type 'NAF.IStaticDataService'_; the tests tolerate it with a bounded loop.

**Do:** open the plan, show a test and press **Run**.

**Say:** “The server runs in Docker and can’t see DMO. The run executes on the agent on this
laptop, which connects outbound to the platform: it’s the same mechanism for a staging
environment behind a VPN or in a customer’s network.”

## If something goes wrong

| Problem                                   | What to do                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The page doesn’t open                     | `prepara-demo.ps1 -SoloVerifica`; if the stack is down, switch to the plan B video             |
| Recording doesn’t start                   | Build the test from actions (block B’s plan B)                                                 |
| The run stays queued                      | Show a finished run from the history: the report is identical                                  |
| The `wfm` command returns 2               | Credentials or network: show the output and move on, the exit code is the point                |
| The DMO agent doesn’t connect             | Skip block H and show the video of the 8 October demo                                          |
| Certificate warning                       | The collaudo CA is missing: step 5 of the day before                                           |
| “Not applied as configured” in the report | The plan asks for a different OS than the worker’s: the run still executes, it’s only a notice |

General rule: don’t debug in front of your manager. Say “let’s look at it afterwards” and move on to
the next block or to the recording.

## Starting over

To recreate the organization: as maya, `DELETE /api/organization` with
`{"confirmName":"Northwind Commerce"}`, then `prepara-demo.ps1` again. The “Demo – login” test
created during the demo can be deleted from _Tests_.
