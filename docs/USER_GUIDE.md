# User Functional Guide 📘

This manual guides QA Engineers through the core workflows of WebFlowMaster.

## 1. Dashboard & Quick Actions 🏠

Upon logging in, you land on the **Dashboard Overview**.

- **Key Metrics**: View Total Tests, Pass/Fail Rates, and Recent Activity.
- **Quick Links**: Access common actions like "Create Test" or "View Reports" directly.

## 2. Using the Element Inspector 🔍

The Inspector allows you to identify element selectors without writing code.

1.  Navigate to **Create Test**.
2.  Enter the target URL (e.g., `https://example.com`) and click **Launch URL**.
3.  The browser view will load on the right. Toggle the **"Inspector Mode"** switch.
4.  **Hover** over any element on the page. You will see a green highlight box.
5.  **Click** an element to capture it. It will appear in the "Detected Elements" list with its Selector (CSS/XPath) and Attributes.

## 3. Building UI Test Sequences 🏗️

Create automated flows using the Drag & Drop Builder.

1.  On the left panel, find the **Action Library** (Click, Input, Scroll, Wait, etc.).
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
