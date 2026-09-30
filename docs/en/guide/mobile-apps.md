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
- The app: an **.apk** or **.aab** for Android, an **.ipa** built for real devices for iOS.

## Writing a test

**Mobile apps** in the menu → **New mobile test**:

| Field | What it is |
|---|---|
| **Name** | Unique in the organization. |
| **Platform** | Android or iOS. |
| **App** | Where the grid finds it: **Upload .apk / .ipa** sends the file to the grid chosen next to it and fills in its address (`bs://…` or `lt://…`); or paste one uploaded before, or an https:// address the grid downloads it from. The file is not kept by WebFlowMaster. |
| **Device** | As the grid names it: `Google Pixel 8`, `Samsung Galaxy S24`, `iPhone 15` — see the grid's device list. |
| **OS version** | Optional: `14.0`, `17`. Empty: the grid's choice for that device. |

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

## Running it

**Run** (▶) on a test's row: choose the grid and, for its variables, the environment. The grid
finds the device and installs the app — a minute or two — and then each step appears as it runs,
with the reason when one fails; the steps after a failed one are skipped. At the end come the
device's screenshot and, on BrowserStack, **Video and logs on the grid**, the session's page with
its video. The grid's dashboard shows the session named after the test, marked passed or failed.

The list shows each test's last run. Viewers see the tests and their runs; editors write, run and
delete them.

## What comes next

Mobile tests in **plans** (with their reports, schedules, requirements and test management) and an
**inspector** to pick elements from a live screenshot are the next steps. Until then a mobile test
runs from its own page.
