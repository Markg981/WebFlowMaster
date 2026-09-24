# Getting started

WebFlowMaster tests web applications and HTTP APIs. You build a test by recording, by dragging
steps, or by describing it in sentences; you group tests into **plans**; plans run on demand, on a
schedule or from a CI pipeline, in one or more browsers; and every run leaves a **report** with
screenshots, timings and, when you want them, a video, a Playwright trace and the network traffic.

This guide is for the people who write and run tests. Setting up an installation and managing an
organization are in [Administration](../admin/administration).

## Signing in

Sign in with the username and password your organization's owner gave you, usually through an
invitation link. Depending on how your organization is set up:

- **Two-factor authentication**: after the password you are asked for a six-digit code from your
  authenticator app. If your organization requires it and you have not set it up yet, the
  application asks you to do that first (**Settings → Security**).
- **Single sign-on**: choose **Sign in with SSO**, type your work e-mail address and sign in at
  your company's identity provider. If the sign-in page says your organization signs in with
  single sign-on, your password no longer works there: use this button.

Forgot your password? Ask an owner of your organization for a reset link.

## Finding your way around

The sidebar has everything:

| Section | What it is for |
|---|---|
| **Dashboard** | How the last runs went, the last 30 days, and the next scheduled runs. |
| **API Tester** | Building and saving API tests. See [API tests](./api-tests). |
| **Create Test** | The test builder for web tests. See [Web tests](./web-tests). |
| **Test Library** | Every saved test, with tags and history. See [Organizing tests](./organizing). |
| **Test Manager** | Importing test cases from Excel and mapping them to saved tests. |
| **Suites** | Lists of tests shared by several plans. |
| **Test plans** | What to run, where and how; the **Run** button. See [Running tests](./running). |
| **Reviews** | Changes waiting for approval, when your organization reviews tests before they run. |
| **Scheduling** | Plans that run by themselves. |
| **Reports** | Every finished run, flaky tests and the quarantine. See [Results](./results). |
| **Settings** | Your preferences and password, and, depending on your role, environments, projects, members, keys and the rest. |

What you can do depends on your **role**: viewers read tests and results; editors also create,
change and run them; owners also manage the organization. The buttons you cannot use are hidden or
disabled.

## Projects and environments

Two things are worth setting up before the first test, in **Settings**:

- A **project** groups the tests of one application. It keeps the test library tidy, and it is
  where the [element repository](./web-tests#element-repository) keeps shared elements. An owner
  can restrict a project to some members.
- An **environment** (Staging, Production…) holds the values a test needs on that target — its
  address, user names, passwords — as encrypted **secrets**. Tests refer to them as
  <code v-pre>{{name}}</code>, so the same test runs against Staging or Production by choosing the
  environment. See [Variables and environments](./web-tests#variables-and-environments).

## Your first test, end to end

1. **Create Test**: enter the address of the application and **Load Website**, then
   **Detect Elements**.
2. Drag actions into the **Test Sequence** and give each one its element, or record them. Press
   **Execute Test** to watch it run.
3. **Save Test**, in a project.
4. **Test plans → + Test Plan**: name the plan and add the test to it.
5. **Run** the plan, and open the report when it finishes.
6. When it passes reliably, **Scheduling → Create Schedule** to run it every night, or run it from
   your pipeline ([CI integration](../CI_INTEGRATION)).

## Personal settings

**Settings → Preferences** has the language of the interface (English, Italiano, Français,
Deutsch) and the theme; **Settings → Test defaults** the browser and timeouts the builder uses.
**Settings → Security** has your second factor, and **Settings → Account** your password.
