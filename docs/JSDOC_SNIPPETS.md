# JSDoc Documentation Snippets 📝

Copy these JSDoc blocks into the respective files to enhance code maintainability and IDE intelligence.

## 1. Server: `playwright-service.ts`

### Function: `executeTestSequence`

Logic for running the sequence, handling the browser context, and invoking the definition of steps.

```typescript
/**
 * Executes a defined test sequence using Playwright.
 *
 * This function orchestrates the entire test verification process:
 * 1. Initializes a new Page/Context.
 * 2. Iterates through the `sequence` steps.
 * 3. Maps abstract actions (click, input) to actual Playwright commands.
 * 4. Integrates the `PlaywrightReporter` to capture Self-Healing events and detailed step results.
 * 5. Returns a comprehensive result object including duration and success status.
 *
 * @param {TestRecord} test - The full test object containing the sequence and element definitions.
 * @returns {Promise<TestResult>} The result of the execution, including steps, logs, and potential error details.
 */
```

## 2. Server: `ai-automation-service.ts`

### Function: `healSelector`

The core logic for recovering from a broken selector.

```typescript
/**
 * Attempts to heal a broken selector by asking GenAI (Gemini) to find the best match in the current DOM.
 *
 * @param {string} originalSelector - The failing selector that caused the error.
 * @param {string} pageContent - The current HTML snapshot of the page (truncated for token limits).
 * @param {string} error - The specific error message returned by Playwright (e.g., Timeout).
 * @returns {Promise<string | null>} The new, healed selector if confident; otherwise null.
 */
```

### Function: `updateSelectorInDb`

Persisting the fix.

```typescript
/**
 * Updates the database with the healed selector to ensure future reliability.
 *
 * This performs a dual update:
 * 1. Updates the specific step in the `sequence` JSON column for this Test ID.
 * 2. Searches the `elements` JSON column for the matching element definition and updates its selector there as well,
 *    ensuring that other tests reusing this element will also benefit from the fix.
 *
 * @param {number} testId - The primary key of the test.
 * @param {number} stepIndex - The index of the step that was healed.
 * @param {string} newSelector - The validated new CSS/XPath selector.
 */
```

## 3. Frontend (React/TS): `TestManager.tsx`

### Function: `handleUpload`

Handling Excel files.

```typescript
/**
 * Handles the upload of an Excel Test Plan.
 *
 * Sends the selected file to `/api/upload-excel` which parses the columns.
 * On success, populates the `parsedTestCases` state to display the mapping table.
 *
 * @returns {Promise<void>}
 */
```
