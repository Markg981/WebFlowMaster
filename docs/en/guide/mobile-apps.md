# Mobile apps

**Mobile apps** tests a native Android or iOS app on a **real device** of a cloud grid —
BrowserStack App Automate or LambdaTest Real Devices — through Appium. It is a kind of test of its
own, beside web and API tests: a native screen has no web page, so its steps name elements the
way the app knows them.

For a responsive **website** on a phone, you do not need this: emulate the device in the plan's
browsers instead ([phones and tablets](./running#mobile-devices)).

## Before you start

- A **BrowserStack** or **LambdaTest** grid in **Settings → Browser grids**, with the account's
  username and access key. The same grid serves browsers and devices; a Playwright server of your
  own runs browsers only.
- Or your own devices: a [local Appium](#local-appium) next to a local agent — emulators,
  simulators, phones on USB.
- The app: an **.apk** or **.aab** for Android, an **.ipa** built for real devices for iOS.

### On your own devices (local Appium) {#local-appium}

Emulators, simulators and the phones on your desk run through an **Appium** server on a machine
with a [local agent](../LOCAL_AGENT). The agent carries the requests, so the server needs no way
into that network, and nothing new is installed beyond Appium itself.

1. On the agent's machine: install Appium and its drivers (`npm i -g appium`,
   `appium driver install uiautomator2`, `xcuitest` on a Mac), start the emulator or plug in the
   phone, and run `appium`.
2. **Settings → Browser grids → Add grid**, provider **Local Appium (agent)**: the **pool** of that
   agent and, when Appium does not listen on `http://127.0.0.1:4723`, its **address** as the
   agent's machine reaches it. No key. **Test connection** asks Appium for its `/status` through an
   agent of the pool and answers its version.
3. In a mobile test: **Device** is Appium's device name (`emulator-5554`, the phone's UDID, or
   `iPhone 15` for a simulator) and **App** is the file's path on the agent's machine
   (`/home/qa/shop.apk`, `C:\apps\shop.apk`) or an `http(s)://` address Appium downloads it
   from. There is nothing to upload.

Runs, plans, the inspector and everything else work as on the clouds. There is no dashboard and
no video: the report has the steps and the last screenshot. A local Appium runs mobile app tests
only; a plan's browsers cannot run on it.

## Writing a test

**Mobile apps** in the menu → **New mobile test**:

| Field | What it is |
|---|---|
| **Name** | Unique in the organization. |
| **Platform** | Android or iOS. |
| **App** | Where the grid finds it: **Upload .apk / .ipa** sends the file to the grid chosen next to it and fills in its address (`bs://…` or `lt://…`); or paste one uploaded before, or an https:// address the grid downloads it from. The file is not kept by WebFlowMaster. |
| **Device** | As the grid names it: `Google Pixel 8`, `Samsung Galaxy S24`, `iPhone 15` — see the grid's device list. |
| **OS version** | Optional: `14.0`, `17`. Empty: the grid's choice for that device. |
| **Project** | Like a web test's: in a [restricted project](./organizing) only its members see the test and its runs, and a viewer on it can neither change nor run it. |
| **Runs in test plans on** | The grid a [test plan](#in-a-test-plan) runs it on. A new test starts with the first BrowserStack or LambdaTest grid; **No grid** keeps it out of plan runs (a plan that includes it reports an error for it). |

Each step is an action, and for most an element:

| Action | What it does |
|---|---|
| **Tap** | Taps the element. |
| **Type** | Clears the field and types the value. |
| **Clear** | Empties the field. |
| **Wait for element** / **Assert visible** | Waits until the element is on screen (up to 15 seconds). |
| **Assert not visible** | Fails if the element is still on screen after up to 5 seconds. |
| **Assert text contains** | The element's text contains the value. |
| **Swipe** | `up`, `down`, `left` or `right`: the way the finger moves across the middle of the screen. |
| **Back** | The system's back (Android), or the app's back navigation. |
| **Hide keyboard** | Closes the on-screen keyboard when it covers what comes next. |
| **Wait (seconds)** | Up to 60 seconds. Waiting for the element is better. |

**Naming an element:**

| Write | Finds |
|---|---|
| `~login` | The **accessibility id**: `content-desc` on Android, `accessibilityIdentifier` on iOS. The one to ask developers for: it survives redesigns and translations. |
| `id=com.shop:id/login` | The resource id (Android) or name (iOS). |
| `text=Sign in` | An element showing exactly that text. |
| `//android.widget.Button[@text='OK']` | XPath through the app's view tree. |
| `android=new UiSelector().text("OK")` | Android's UiAutomator. |
| `ios=label == "OK"`, `chain=**/XCUIElementTypeButton` | iOS predicate strings and class chains. |

A step the platform cannot read — a CSS selector, `android=…` in an iOS test — is marked in red
and the test cannot be saved until it is corrected. Values can use the environment's
<code v-pre>{{variables}}</code> and [generated values](./web-tests#generated-values), including
<code v-pre>{{$totp(secret_mfa)}}</code>.

## The inspector {#inspector}

Finding what to call an element is the hard part of a mobile test. **Inspector**, under the steps
of the test's dialog, opens the app on a real device of the grid — the one the test runs on in
plans, else the one uploads go to — and shows its screen beside the list of its elements. It
needs the app and the device filled in; the grid takes a minute or two to find the device.

- **Click the screen** (or an element in the list): the element under the pointer is outlined,
  with its attributes and the locators a step can use for it — accessibility id, resource id,
  text, XPath — marked **unique** when they find only that element on this screen, unique ones
  first. When nothing else is unique, an XPath by position is offered; it works, but breaks as
  soon as the screen's layout changes.
- **+** next to a locator adds a step at the end of the test, as the action chosen in **Add as**
  (Tap by default; Assert visible, Wait for element, Assert not visible, Clear).
- To reach the next screen, drive the device from here: **Tap it on the device** and **Type it**
  on the selected element, **Tap on the device** to tap wherever you click the screen, the back
  and swipe buttons, and ↻ to read the screen again. A step that fails says why, as in a run.

### Recording a test {#recording}

**Record** turns walking through the app into steps. Every touch on the screen is done on the
device first, and becomes a step only if it worked:

- **A click** taps the element under the pointer, named with its sturdiest locator (the first one
  the element panel would offer). Where nothing can be named, the tap is done but not recorded,
  and the inspector says so.
- **A click on a text field** then asks what to type; **Type it** (or Enter) records a Type step.
  In a password field the text is masked and the step is marked **password**.
- **A drag** on the screen records a swipe in its direction (up, down, left or right). The back,
  swipe and hide-keyboard buttons are recorded too.
- **Check it is visible** or **Check its text**, then a click on an element, records an assertion
  — the text one with the text the element shows now. Both are also offered on the selected
  element.

Recorded steps wait in **Recorded steps**, not in the test. There you can correct an element or a
value, move a step up or down, or remove it; **Add N step(s) to the test** puts them at the end of
the test in that order, and **Discard** drops them. Closing the inspector with steps not added asks
first. Two badges ask for a look before adding:

- **fragile** — only its position in the screen names the element (an XPath by position): the
  step breaks when the layout changes. Give the element an accessibility id in the app, or write a
  sturdier locator.
- **password** — a password written into the test can be read by everyone who can open it. Replace
  it with <code v-pre>{{password}}</code> and set the value in the environment.

A swipe is recorded as a direction across the screen, not as the exact path of the drag; a long
press, pinch or a tap at fixed coordinates are not recorded.

The inspector has no environment: a value with a <code v-pre>{{variable}}</code> is refused with
its name. Type the value itself, then change it in the step (in the recorded list, before adding).

The device is yours while the inspector is open, and it costs grid minutes: closing the inspector
gives it back, and so does leaving it unused for five minutes. One inspector per person at a time:
opening another closes the first. Opening one is recorded in the audit log.

## Running it

**Run** (▶) on a test's row: choose the grid and, for its variables, the environment. The grid
finds the device and installs the app — a minute or two — and then each step appears as it runs,
with the reason when one fails; the steps after a failed one are skipped. At the end come the
device's screenshot and, on BrowserStack, **Video and logs on the grid**, the session's page with
its video. The grid's dashboard shows the session named after the test, marked passed or failed.

The list shows each test's last run. Viewers see the tests and their runs; editors write, run and
delete them.

## In a test plan

A plan can include mobile tests beside its web and API tests: in the plan wizard, **Add Test
Suites** lists them with the label **mobile**, and its tag filter narrows them like the others.
The plan's page lists them with *(mobile app)*.

In a run of the plan a mobile test:

- runs **once**, on the device it names and the grid chosen in **Runs in test plans on** — not once
  per browser or language of the plan, whose browsers and "run on" do not apply to a device;
- reads the variables of the run's environment, like the plan's other tests;
- follows the plan's **Re-Run On Failure** (the attempts appear on the result) and its failure
  policy: a failed mobile test fails the run, and can stop it;
- is a row of the [report](./results#a-runs-report) like any other: the device (`Google Pixel 8 · 14.0`) in the
  *Browser* column, its steps under the steps button with the reason of the failed one, the
  device's last screen as the screenshot and, on BrowserStack, **Open the session on the grid**
  for the video and logs.

Because it is part of the plan, it also runs in the plan's [schedules](./running#scheduling) and
[pipelines](./running#from-a-pipeline), and its result reaches the notifications, JUnit and the test management
tool with the rest.

A mobile test with no grid is reported as an error in the run, with the reason, without asking any
grid for a device.

## Suites, requirements and test management

A mobile test goes wherever a web or API test does:

- in a **suite** ([Suites](./organizing#suites)), and so in every plan that includes it: a static
  suite by choice, a dynamic one by the tags the test carries;
- as the coverage of a **requirement** ([Requirements](./organizing#requirements)): its latest
  result in a plan run counts like any other, and the matrix export says `mobile`;
- linked to a case of **TestRail, Xray or Zephyr Scale**
  ([test management](./results#test-management)): its result in a run is published to that case,
  with the device in the comment. A `[C123]` at the start of its name works as it does for a web
  test.

In each list it carries the label **Mobile**.

## Tags {#tags}

The **Tags** column of **Mobile apps** puts the organization's tags on a mobile test, as the test
library does for web tests (viewers see them). A tag is shared by every kind of test: a dynamic
suite with *smoke* runs the web, API and mobile tests carrying it.

## Quarantine {#quarantine}

A mobile test that fails for reasons outside the app (a device farm dropping the session, a
slow emulator) can be set aside with the shield button of its row, with the reason, like a web
or API test ([flaky tests and quarantine](./results#flaky-tests-and-quarantine)). It keeps
running in plans and its results are kept, but its failures no longer fail the run. The row shows
**In quarantine** (hover it for the reason); it is released from **Tests in quarantine** in
**Reports**, where it carries the **Mobile** label. In a restricted project only those who may
edit the test may quarantine or release it.

## Unstable tests {#unstable}

Mobile tests are part of **Tests that disagree with themselves** in **Reports**
([flaky tests and quarantine](./results#flaky-tests-and-quarantine)), with the **Mobile** label.
Each device counts on its own: a test that fails on one phone and passes on another is a fact
about the app, not indecision. From there it can be quarantined like any other test.

On **Mobile apps**, a test found unstable over the last 30 days carries the **Unstable** badge;
hover it to see on which device and how often its verdict changed. Mobile tests have no
versions, so every change of verdict counts, as for API tests.

## Versions and publication

Saved tests have [history, comparison and restore](./organizing#history-and-versions).
[Publication and reviews](./organizing#publishing-and-reviews) choose the revision plans execute;
saving or restoring a working copy leaves an existing publication in place. A debug run uses the saved mobile working copy captured when the run is requested.

## Conditions, loops and reusable groups

The native step editor supports `if` / `else` / `endIf`, `repeat` /
`repeatWhile` / `endLoop`, and `assertCondition`. Each block must close before
the test can be saved. With an element, a condition reads `visible`, `hidden`,
`contains:text` or `text:text` immediately. Put `waitFor` first when the screen
is still loading. Without an element, use a value comparison such as
`{{status}} == Paid`, `{{total}} > 0`, `contains` or `not contains`.

`repeat` takes 1–200 iterations, including a count from an environment variable.
`{{loopIndex}}` starts at 1; nested loops restore the outer index when they finish.
An endless `repeatWhile` fails after 200 iterations. The runner also limits
expanded steps to 2,000 and total executed step visits to 10,000 per device.
Reports identify the group and iteration when a step repeats.

**Reusable mobile groups** on the Mobile apps page holds named native sequences
for one platform. Create a group, then select **Call mobile group** in a test.
Groups can contain complete flow blocks, but cannot call other groups. The
project determines who can see/edit a group. A referenced group cannot be deleted
or switched to another platform. Missing or inaccessible dependencies cause an
explicit error. Edits apply to subsequent runs; already queued runs and retries
retain the resolved group content captured in their snapshot.

## Device/OS matrix

Add up to 20 distinct pairs under **Device/OS matrix** in the test editor. An
empty matrix uses the existing default device/OS. A nonempty matrix is the entire
target list; the default is not appended. The app, platform and grid are shared.
Use separate Android and iOS tests for different app binaries or native locators.

**Run** uses the default device; **Run device matrix** queues all configured
targets and follows each result separately. Standalone targets execute sequentially;
a failed target does not prevent the following ones from running. A depleted
execution budget rejects admission before any target is queued. Runtime budget
exhaustion is reported as an execution error.

Test plans use the matrix automatically. Each target has its own result, retries,
screenshot and session link, independently of web browser/language combinations.
Existing plan parallelism, quarantine and stop policies still apply.

## Mobile catalog files

**Tests as files** exports web, API and native tests in YAML/JSON bundle version 2.
Mobile exports contain the device matrix and referenced native groups. Group calls
use platform/name keys and are remapped to destination IDs during import. Preview
validates dependencies without creating tests, groups, versions or audit entries.
Changed native definitions create a new test version; unchanged imports do not.
Version 1 bundles remain readable. Gherkin exports web tests only.

New imports go to the selected editable project; existing tests/groups keep their
projects, and existing tests retain their grid. Configure a grid for new native
tests after import. App references are preserved as written: cloud upload handles
and local paths may require uploading or configuring the app at the destination.
The catalog contains definitions, not application binaries or execution artifacts.
