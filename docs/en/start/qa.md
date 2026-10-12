# Your first test in 10 minutes

For testers. You need an account with the **editor** role (ask an owner of your organization for
an invitation) and the address of a web application to test. Any public page will do for a first
try.

## 1. Sign in (1 minute)

Open the invitation link, choose a password and sign in. If your organization uses single sign-on,
choose **Sign in with SSO** and type your work address; if it requires two-factor authentication,
set it up when asked. Details: [Signing in](../guide/#signing-in).

## 2. A project to keep the test in (1 minute)

**Settings → Projects**: type the application's name in **New Project Name** and **Create
Project**. Skip it if the project already exists, or create it later from the save dialog
(**Create New Project**). Projects keep the library tidy and hold shared elements
([Projects and environments](../guide/#projects-and-environments)).

## 3. Build the test (4 minutes)

1. Open **Create Test**, type the address in **Website URL to Test** and press **Load Website**. A
   screenshot of the page appears.
2. Press **Detect Elements**: the buttons, fields and links of the page are listed with their
   selectors.
3. Drag **Input Text** from **Available Actions** into the **Test Sequence**, then drop a field on
   it from **Detected Elements** and type the value.
4. Add **Click Element** for the button, then **Assert Text Contains** with an element and the text
   you expect to see afterwards. A test without a check only proves the page did not crash.
5. Press **Execute Test** and watch each step turn green.

Prefer recording? **Record user actions (auto-record)** in the same page opens a browser window
and turns your clicks and typing into steps; it needs a display, so it works when WebFlowMaster
runs on your own machine ([Recording](../guide/web-tests#recording)). Prefer words? Describe the test in sentences
([Describing a test in sentences](../guide/web-tests#describing-a-test-in-sentences)).

## 4. Save it (30 seconds)

**Save Test**, give it a name a colleague will understand ("Login with a valid account") and pick
the project.

## 5. Put it in a plan and run it (2 minutes)

1. **Test plans → + Test Plan**: name the plan ("Smoke"), add the test, keep the default browser.
2. Press **Run**. The run is queued, picked up by a worker and executed.

## 6. Read the report (1 minute)

Open the run when it finishes, from the plan or from **Reports**. Each test shows its steps, a
screenshot of each, the time they took and, for a failure, the step that failed and why
([Results](../guide/results)).

## Next

- Run it every night: **Scheduling → Create Schedule** ([Scheduling](../guide/running#scheduling)).
- Same test against Staging and Production: put the address in an
  [environment](../guide/web-tests#variables-and-environments) and write <code v-pre>{{baseUrl}}</code>.
- Many rows of data: [Datasets](../guide/web-tests#datasets).
- Your API, your mobile app: [API tests](../guide/api-tests), [Mobile apps](../guide/mobile-apps).
- Hand it to your pipeline: [Your first run from a pipeline](./devops).
