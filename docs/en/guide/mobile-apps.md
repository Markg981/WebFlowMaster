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
- **Record what I do here as steps** adds each tap, text, back and swipe that succeeds to the test
  as a step, so walking through the app writes the test.

The inspector has no environment: a value with a <code v-pre>{{variable}}</code> is refused with
its name. Type the value itself, then change it in the step.

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
Suites** lists them with the label **mobile** (a tag filter leaves them out: they have no tags).
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

- in a **static suite** ([Suites](./organizing#suites)), and so in every plan that includes it —
  a dynamic suite matches tags, and mobile tests have none;
- as the coverage of a **requirement** ([Requirements](./organizing#requirements)): its latest
  result in a plan run counts like any other, and the matrix export says `mobile`;
- linked to a case of **TestRail, Xray or Zephyr Scale**
  ([test management](./results#test-management)): its result in a run is published to that case,
  with the device in the comment. A `[C123]` at the start of its name works as it does for a web
  test.

In each list it carries the label **Mobile**.

## Not yet

Mobile tests carry no tags (so no dynamic suite includes them) and are not quarantined or
counted as flaky; their project cannot be chosen yet.
