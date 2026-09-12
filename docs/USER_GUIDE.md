# User Functional Guide 📘

This manual guides QA Engineers through the core workflows of WebFlowMaster.

## 1. Dashboard & Quick Actions 🏠

Upon logging in, you land on the **Dashboard Overview**.

- **Key Metrics**: View Total Tests, Pass/Fail Rates, and Recent Activity.
- **Quick Links**: Access common actions like "Create Test" or "View Reports" directly.

## 2. Finding Elements 🔍

Identify element selectors without writing code.

1.  Navigate to **Create Test**.
2.  Enter the target URL (e.g. `https://example.com`) and click **Detect Elements**.
3.  The page is loaded in a real browser, and **Website Preview** shows a full-page
    screenshot of it. Every interactive element found on the page appears in the
    **Detected Elements** list on the right, with its selector and attributes.
4.  **Hover** a row in that list. The matching element is outlined on the screenshot, and
    the preview scrolls to it — so you can tell which element a row refers to before you
    use it. Hovering is how you check; nothing is captured by hovering.
5.  **Drag** a row into a step's "Target Element" box to use it (see §3).

Two things worth knowing:

- The count badge reads e.g. `300 / 812` when the page has more interactive elements than
  the list returns. The cap keeps the list usable; raise it with the
  `ELEMENT_DETECTION_LIMIT` environment variable if you need to reach further down a large
  grid.
- Selectors prefer whatever survives a redeploy: a developer-chosen `id`, then
  `data-testid`, then the accessible label, then the element's role and text. Framework-
  generated ids (`mat-input-3`, `mat-button-9` and friends) are deliberately **not** used —
  Angular assigns them in render order, so a test keyed on one starts failing as soon as
  anything above the element changes.

## 3. Building UI Test Sequences 🏗️

Create automated flows using the Drag & Drop Builder.

1.  On the left panel, find the **Action Library** (Click, Input, Scroll, Wait, etc.).

    On an application that updates the page asynchronously — anything driven by SignalR,
    WebSockets or long-polling — reach for a conditional wait rather than **Wait**, which
    is a fixed number of milliseconds and therefore a guess:

    | Action | Waits until |
    | :--- | :--- |
    | **Wait For Element** | the element is visible (or hidden) |
    | **Wait For Text** | the element contains the text you give it |
    | **Wait For Network** | in-flight requests have settled |

    Use **Pick From Dropdown** rather than **Select Option** for anything that is not a
    native `<select>`. An Angular Material `mat-select` is a `div` whose options are
    rendered elsewhere in the document, and **Select Option** cannot drive it.
2.  **Drag** an action card into the central "Test Sequence" area.
3.  **Configure** the step:
    - **Action**: Select the type (e.g., `Click`).
    - **Target**: Drop a detected element from the right panel into the "Target Element" box.
    - **Value**: (Optional) Enter text for inputs or wait times.
4.  Click **Save Test** to persist the sequence.

## 4. API Tester (Postman-style) 🚀

WebFlowMaster includes a built-in API testing tool.

1.  Navigate to **API Tester** from the sidebar.
2.  **Request Setup**:
    - Select Method (`GET`, `POST`, `PUT`, `DELETE`).
    - Enter the Endpoint URL.
    - Add Headers and Body (JSON/Form) in the respective tabs.
3.  **Authentication**: Configure Basic Auth or Bearer Token if needed.
4.  **Send**: Click "Send Request" to execute.
5.  **Response**: View Status, Time, Size, and JSON Response body in the lower panel.
6.  **Save**: Save the request to a collection for reuse.

## 5. Excel Driven Testing (Test Manager) 📊

Run tests in bulk based on business requirements.

1.  Go to **Test Manager**.
2.  Click **Upload Excel** and select your test plan file.
3.  The system parses the rows into a table (Test Case ID, Objectives).
4.  **Map Sequences**: Use the dropdown in the "Mapped Sequence" column to link each Excel row to an automated UI or API test.
5.  **Run**: Select specific rows and click **Run Selected**.

## 6. Test Suites & Scheduling 🗓️

Organize and automate your execution.

### Test Suites

1.  Go to **Test Suites**.
2.  Create a **New Suite** (e.g., "Smoke Test", "Regression").
3.  Add existing tests (UI or API) to the suite.
4.  Run the entire suite with a single click.

### Scheduling

1.  Navigate to **Scheduling**.
2.  **Create Job**: Select a Test Suite and define a schedule (Cron expression or Date/Time).
3.  **Browsers**: Choose validation browsers (Chrome, Firefox, WebKit).
4.  The system will automatically run the suite at the configured time.

## 7. Understanding AI Analysis 🧠

When a test fails, WebFlowMaster uses AI to explain why.

1.  After execution, click **View Latest Report** (or go to **Reports**).
2.  The **Allure Report** opens.
3.  **Self-Healing**:
    - Look for steps marked with `[HEALED]`.
    - This indicates the selector was fixed automatically by Gemini during execution.
4.  **Failure Analysis (RCA)**:
    - If a test failed (Red), expand the details.
    - Open the attachment **"Root Cause Analysis (AI)"**.
    - Read the natural language explanation of the failure.
