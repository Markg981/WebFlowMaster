# API Reference 🔌

This document provides a reference for the core backend REST API endpoints used by WebFlowMaster.

## Base URL

`http://localhost:5000`

---

## 1. Test Management

### Create a New Test

**POST** `/api/tests`

Creates a new test case with a defined sequence and associated element repository.

**Request Body:**

```json
{
  "name": "Login Flow",
  "url": "https://example.com/login",
  "projectId": 1,
  "sequence": [
    {
      "action": { "id": "click", "name": "Submit" },
      "targetElement": { "selector": "#btn-login", "tag": "button" }
    }
  ],
  "elements": [
    {
      "id": "elem-button-0",
      "selector": "#btn-login",
      "tag": "button"
    }
  ]
}
```

### List Tests

**GET** `/api/tests`

Returns a list of all tests for the authenticated user.

---

## 2. Excel Integration

### Upload Test Plan

**POST** `/api/upload-excel`

Uploads an Excel file containing business requirements. The server parses the columns to extract Test Case ID, Description, and Expected Results.

**Content-Type:** `multipart/form-data`
**Body:** `file`: (Binary Excel File)

**Response:**

```json
[
  {
    "testCaseId": "TC_001",
    "priority": "High",
    "functionalObjective": "Verify Login",
    "expectedOutcome": "User dashboard loads"
  }
]
```

### Save Mappings

**POST** `/api/excel-mappings`

Links an Excel Test Case ID to an automated Test Sequence ID.

---

## 3. Automation & AI

### Detect Elements

**POST** `/api/detect-elements`

Triggers a Playwright instance to scan a URL and return interactive elements.

**Request Body:**

```json
{ "url": "https://example.com/login" }
```

**Response:**

```json
{
  "success": true,
  "elements": [
    { "selector": "#username", "tag": "input", "type": "text" },
    { "selector": "#password", "tag": "input", "type": "password" }
  ]
}
```

### Run Tests

**POST** `/api/tests/:id/run` (or batch execution)

Executes a specific test sequence.

**Behavior:**

- Launches Browser.
- Executes steps sequentially.
- **Triggers AI Self-Healing** on failure.
- Updates database if healing is successful.

---

## 4. Reports

### Generate Report

**POST** `/api/reports/generate`

Triggers the generation of the Allure report from the latest results.
