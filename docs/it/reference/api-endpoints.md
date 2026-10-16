# Endpoint dell’API

Generata dal documento OpenAPI che il server espone in `/api/v1/openapi.json` (versione dell’API 1.2.0) con `npm run docs:api-reference`; non va modificata a mano. Le descrizioni restano in inglese, come nel documento. Autenticazione, scope, convenzioni e flussi completi sono spiegati nella [guida all’API REST](./api). Lo stesso documento si scarica come [openapi.json](/openapi.json) per importarlo in Postman, Insomnia o in un generatore di client.

**68 operazioni.** Ognuna indica lo scope che la chiave API deve avere; una chiave senza riceve 403.

## Projects

### `GET /api/v1/projects` {#listProjects}

List visible projects.

Scope `projects:read` · operation `listProjects`

| Parameter | In    | Type    | Required | Description             |
| --------- | ----- | ------- | -------- | ----------------------- |
| `limit`   | query | integer |          | 1–100, default `20`     |
| `offset`  | query | integer |          | at least 0, default `0` |

| Status | Meaning                                          | Body                                                                               |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 200    | Success.                                         | object { items: [Project](#schema-project)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                        |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                        |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                        |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                        |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                        |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                        |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                        |

### `POST /api/v1/projects` {#createProject}

Create an open project.

Scope `projects:write` · operation `createProject`

**Request body** (`application/json`)

[ProjectInput](#schema-projectinput)

| Status | Meaning                                          | Body                                            |
| ------ | ------------------------------------------------ | ----------------------------------------------- |
| 201    | Success.                                         | [Project](#schema-project) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)     |

### `GET /api/v1/projects/{projectId}` {#getProject}

Read a visible project.

Scope `projects:read` · operation `getProject`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `projectId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                            |
| ------ | ------------------------------------------------ | ----------------------------------------------- |
| 200    | Success.                                         | [Project](#schema-project) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)     |

### `PATCH /api/v1/projects/{projectId}` {#updateProject}

Update project name or description.

Scope `projects:write` · operation `updateProject`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `projectId` | path | integer | yes      | at least 1  |

**Request body** (`application/json`)

[ProjectPatch](#schema-projectpatch)

| Status | Meaning                                          | Body                                            |
| ------ | ------------------------------------------------ | ----------------------------------------------- |
| 200    | Success.                                         | [Project](#schema-project) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)     |

### `DELETE /api/v1/projects/{projectId}` {#deleteProject}

Delete a project the account created; its tests stay, detached.

Scope `projects:write` · operation `deleteProject`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `projectId` | path | integer | yes      | at least 1  |

| Status | Meaning                                             | Body                                        |
| ------ | --------------------------------------------------- | ------------------------------------------- |
| 204    | Success.                                            |                                             |
| 400    | Invalid body, identifier or referenced resource.    | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                               | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope or role, or `project_not_owned`. | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.           | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.              | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.                | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.       | [Error](#schema-error) (`application/json`) |

## Tests

### `GET /api/v1/tests` {#listTests}

List visible web, manual and BDD tests.

Scope `tests:read` · operation `listTests`

| Parameter   | In    | Type    | Required | Description             |
| ----------- | ----- | ------- | -------- | ----------------------- |
| `limit`     | query | integer |          | 1–100, default `20`     |
| `offset`    | query | integer |          | at least 0, default `0` |
| `projectId` | query | integer |          | at least 1              |

| Status | Meaning                                          | Body                                                                                         |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 200    | Success.                                         | object { items: [AuthoredTest](#schema-authoredtest)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                                  |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                                  |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                                  |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                                  |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                                  |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                                  |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                                  |

### `POST /api/v1/tests` {#createTest}

Create a test and its first version.

Scope `tests:write` · operation `createTest`

**Request body** (`application/json`)

[TestInput](#schema-testinput)

| Status | Meaning                                          | Body                                                      |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| 201    | Success.                                         | [AuthoredTest](#schema-authoredtest) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)               |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)               |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)               |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)               |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)               |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)               |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)               |

### `GET /api/v1/tests/{testId}` {#getTest}

Read a visible test definition.

Scope `tests:read` · operation `getTest`

| Parameter | In   | Type    | Required | Description |
| --------- | ---- | ------- | -------- | ----------- |
| `testId`  | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                                      |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| 200    | Success.                                         | [AuthoredTest](#schema-authoredtest) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)               |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)               |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)               |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)               |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)               |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)               |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)               |

### `PATCH /api/v1/tests/{testId}` {#updateTest}

Update the working copy and record a version.

Scope `tests:write` · operation `updateTest`

| Parameter | In   | Type    | Required | Description |
| --------- | ---- | ------- | -------- | ----------- |
| `testId`  | path | integer | yes      | at least 1  |

**Request body** (`application/json`)

[TestPatch](#schema-testpatch)

| Status | Meaning                                          | Body                                                      |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| 200    | Success.                                         | [AuthoredTest](#schema-authoredtest) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)               |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)               |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)               |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)               |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)               |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)               |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)               |

### `DELETE /api/v1/tests/{testId}` {#deleteTest}

Delete a test; its versions and plan membership go with it.

Scope `tests:write` · operation `deleteTest`

| Parameter | In   | Type    | Required | Description |
| --------- | ---- | ------- | -------- | ----------- |
| `testId`  | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 204    | Success.                                         |                                             |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

## Datasets

### `GET /api/v1/datasets` {#listDatasets}

List shared datasets.

Scope `datasets:read` · operation `listDatasets`

| Parameter | In    | Type    | Required | Description             |
| --------- | ----- | ------- | -------- | ----------------------- |
| `limit`   | query | integer |          | 1–100, default `20`     |
| `offset`  | query | integer |          | at least 0, default `0` |

| Status | Meaning                                          | Body                                                                               |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 200    | Success.                                         | object { items: [Dataset](#schema-dataset)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                        |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                        |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                        |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                        |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                        |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                        |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                        |

### `POST /api/v1/datasets` {#createDataset}

Create a shared dataset.

Scope `datasets:write` · operation `createDataset`

**Request body** (`application/json`)

[DatasetInput](#schema-datasetinput)

| Status | Meaning                                          | Body                                            |
| ------ | ------------------------------------------------ | ----------------------------------------------- |
| 201    | Success.                                         | [Dataset](#schema-dataset) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)     |

### `GET /api/v1/datasets/{datasetId}` {#getDataset}

Read a shared dataset.

Scope `datasets:read` · operation `getDataset`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `datasetId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                            |
| ------ | ------------------------------------------------ | ----------------------------------------------- |
| 200    | Success.                                         | [Dataset](#schema-dataset) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)     |

### `PUT /api/v1/datasets/{datasetId}` {#replaceDataset}

Replace a shared dataset.

Scope `datasets:write` · operation `replaceDataset`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `datasetId` | path | integer | yes      | at least 1  |

**Request body** (`application/json`)

[DatasetInput](#schema-datasetinput)

| Status | Meaning                                          | Body                                            |
| ------ | ------------------------------------------------ | ----------------------------------------------- |
| 200    | Success.                                         | [Dataset](#schema-dataset) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)     |

### `DELETE /api/v1/datasets/{datasetId}` {#deleteDataset}

Delete a dataset unused by tests.

Scope `datasets:write` · operation `deleteDataset`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `datasetId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 204    | Success.                                         |                                             |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

## Plans

### `GET /api/v1/plans` {#listPlans}

The organization's test plans, by name.

Scope `plans:read` · operation `listPlans`

| Parameter | In    | Type    | Required | Description             |
| --------- | ----- | ------- | -------- | ----------------------- |
| `limit`   | query | integer |          | 1–100, default `20`     |
| `offset`  | query | integer |          | at least 0, default `0` |

| Status | Meaning                                                                       | Body                                                                         |
| ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 200    | A page of plans.                                                              | object { items: [Plan](#schema-plan)[], limit, offset } (`application/json`) |
| 401    | No usable API key was sent.                                                   | [Error](#schema-error) (`application/json`)                                  |
| 403    | The key lacks the scope, or its account's role is below what the scope needs. | [Error](#schema-error) (`application/json`)                                  |

### `POST /api/v1/plans` {#createPlan}

Provision a plan with visible typed test references.

Scope `plans:write` · operation `createPlan`

**Request body** (`application/json`)

[PlanInput](#schema-planinput)

| Status | Meaning                                          | Body                                                      |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| 201    | Success.                                         | [AuthoredPlan](#schema-authoredplan) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)               |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)               |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)               |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)               |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)               |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)               |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)               |

### `GET /api/v1/plans/{planId}` {#getPlan}

Read a plan and its selected tests.

Scope `plans:read` · operation `getPlan`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `planId`  | path | string | yes      |             |

| Status | Meaning                                          | Body                                                      |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| 200    | Success.                                         | [AuthoredPlan](#schema-authoredplan) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)               |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)               |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)               |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)               |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)               |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)               |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)               |

### `PATCH /api/v1/plans/{planId}` {#updatePlan}

Update a plan and replace its test selection.

Scope `plans:write` · operation `updatePlan`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `planId`  | path | string | yes      |             |

**Request body** (`application/json`)

[PlanPatch](#schema-planpatch)

| Status | Meaning                                          | Body                                                      |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| 200    | Success.                                         | [AuthoredPlan](#schema-authoredplan) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)               |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)               |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)               |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)               |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)               |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)               |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)               |

### `DELETE /api/v1/plans/{planId}` {#deletePlan}

Delete a plan with its schedules, webhooks and run history.

Scope `plans:write` · operation `deletePlan`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `planId`  | path | string | yes      |             |

| Status | Meaning                                                           | Body                                        |
| ------ | ----------------------------------------------------------------- | ------------------------------------------- |
| 204    | Success.                                                          |                                             |
| 400    | Invalid body, identifier or referenced resource.                  | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                                             | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.                       | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.                         | [Error](#schema-error) (`application/json`) |
| 409    | `plan_running`: a run of the plan has not ended; cancel it first. | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.                              | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.                     | [Error](#schema-error) (`application/json`) |

## API tests

### `GET /api/v1/api-tests` {#listApiTests}

List visible API tests, literal secrets replaced by variables.

Scope `api-tests:read` · operation `listApiTests`

| Parameter   | In    | Type    | Required | Description             |
| ----------- | ----- | ------- | -------- | ----------------------- |
| `limit`     | query | integer |          | 1–100, default `20`     |
| `offset`    | query | integer |          | at least 0, default `0` |
| `projectId` | query | integer |          | at least 1              |

| Status | Meaning                                          | Body                                                                                               |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 200    | Success.                                         | object { items: [AuthoredApiTest](#schema-authoredapitest)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                                        |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                                        |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                                        |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                                        |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                                        |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                                        |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                                        |

### `POST /api/v1/api-tests` {#createApiTest}

Create an API test and its first version.

Scope `api-tests:write` · operation `createApiTest`

**Request body** (`application/json`)

[ApiTestInput](#schema-apitestinput)

| Status | Meaning                                          | Body                                                            |
| ------ | ------------------------------------------------ | --------------------------------------------------------------- |
| 201    | Success.                                         | [AuthoredApiTest](#schema-authoredapitest) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                     |

### `GET /api/v1/api-tests/{apiTestId}` {#getApiTest}

Read a visible API test definition.

Scope `api-tests:read` · operation `getApiTest`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `apiTestId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                                            |
| ------ | ------------------------------------------------ | --------------------------------------------------------------- |
| 200    | Success.                                         | [AuthoredApiTest](#schema-authoredapitest) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                     |

### `PATCH /api/v1/api-tests/{apiTestId}` {#updateApiTest}

Update an API test and record a version.

Scope `api-tests:write` · operation `updateApiTest`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `apiTestId` | path | integer | yes      | at least 1  |

**Request body** (`application/json`)

[ApiTestPatch](#schema-apitestpatch)

| Status | Meaning                                          | Body                                                            |
| ------ | ------------------------------------------------ | --------------------------------------------------------------- |
| 200    | Success.                                         | [AuthoredApiTest](#schema-authoredapitest) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                     |

### `DELETE /api/v1/api-tests/{apiTestId}` {#deleteApiTest}

Delete an API test.

Scope `api-tests:write` · operation `deleteApiTest`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `apiTestId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 204    | Success.                                         |                                             |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

## Mobile tests

### `GET /api/v1/mobile-tests` {#listMobileTests}

List visible native mobile tests.

Scope `mobile-tests:read` · operation `listMobileTests`

| Parameter   | In    | Type    | Required | Description             |
| ----------- | ----- | ------- | -------- | ----------------------- |
| `limit`     | query | integer |          | 1–100, default `20`     |
| `offset`    | query | integer |          | at least 0, default `0` |
| `projectId` | query | integer |          | at least 1              |

| Status | Meaning                                          | Body                                                                                                     |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 200    | Success.                                         | object { items: [AuthoredMobileTest](#schema-authoredmobiletest)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                                              |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                                              |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                                              |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                                              |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                                              |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                                              |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                                              |

### `POST /api/v1/mobile-tests` {#createMobileTest}

Create a mobile test and its first version.

Scope `mobile-tests:write` · operation `createMobileTest`

**Request body** (`application/json`)

[MobileTestInput](#schema-mobiletestinput)

| Status | Meaning                                          | Body                                                                  |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------- |
| 201    | Success.                                         | [AuthoredMobileTest](#schema-authoredmobiletest) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                           |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                           |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                           |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                           |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                           |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                           |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                           |

### `GET /api/v1/mobile-tests/{mobileTestId}` {#getMobileTest}

Read a visible mobile test definition.

Scope `mobile-tests:read` · operation `getMobileTest`

| Parameter      | In   | Type    | Required | Description |
| -------------- | ---- | ------- | -------- | ----------- |
| `mobileTestId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                                                  |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------- |
| 200    | Success.                                         | [AuthoredMobileTest](#schema-authoredmobiletest) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                           |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                           |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                           |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                           |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                           |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                           |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                           |

### `PATCH /api/v1/mobile-tests/{mobileTestId}` {#updateMobileTest}

Update a mobile test, checked as a whole, and record a version.

Scope `mobile-tests:write` · operation `updateMobileTest`

| Parameter      | In   | Type    | Required | Description |
| -------------- | ---- | ------- | -------- | ----------- |
| `mobileTestId` | path | integer | yes      | at least 1  |

**Request body** (`application/json`)

[MobileTestPatch](#schema-mobiletestpatch)

| Status | Meaning                                          | Body                                                                  |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------- |
| 200    | Success.                                         | [AuthoredMobileTest](#schema-authoredmobiletest) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                           |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                           |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                           |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                           |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                           |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                           |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                           |

### `DELETE /api/v1/mobile-tests/{mobileTestId}` {#deleteMobileTest}

Delete a mobile test.

Scope `mobile-tests:write` · operation `deleteMobileTest`

| Parameter      | In   | Type    | Required | Description |
| -------------- | ---- | ------- | -------- | ----------- |
| `mobileTestId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 204    | Success.                                         |                                             |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

## Suites

### `POST /api/v1/suites/export` {#exportSuite}

Export project tests using the versioned suite bundle.

Scope `suites:read` · operation `exportSuite`

**Request body** (`application/json`)

[SuiteExportInput](#schema-suiteexportinput)

| Status | Meaning                                          | Body                                                    |
| ------ | ------------------------------------------------ | ------------------------------------------------------- |
| 200    | Success.                                         | [SuiteExport](#schema-suiteexport) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)             |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)             |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)             |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)             |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)             |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)             |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)             |

### `POST /api/v1/suites/import` {#importSuite}

Validate or transactionally import a suite into a project.

Scope `suites:write` · operation `importSuite`

**Request body** (`application/json`)

[SuiteImportInput](#schema-suiteimportinput)

| Status | Meaning                                          | Body                                                    |
| ------ | ------------------------------------------------ | ------------------------------------------------------- |
| 200    | Validated dry run; no writes.                    | [SuiteImport](#schema-suiteimport) (`application/json`) |
| 201    | Success.                                         | [SuiteImport](#schema-suiteimport) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)             |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)             |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)             |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)             |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)             |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)             |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)             |

## Runs

### `GET /api/v1/runs/{runId}/evidence` {#listRunEvidence}

The files a run left behind: screenshots, videos, traces, logs and reports.

Each file carries the URL it is served from. A run whose evidence retention has removed answers an empty page with `purged: true`. Traces, HAR files and unrecognised files are listed only for a caller with the editor role and, on a scoped key, the `runs:evidence` scope; otherwise they are counted in `withheld`. Files of a test in a restricted project the caller is not on are neither listed nor counted.

Scope `runs:read` · operation `listRunEvidence`

| Parameter | In    | Type    | Required | Description             |
| --------- | ----- | ------- | -------- | ----------------------- |
| `runId`   | path  | string  | yes      |                         |
| `limit`   | query | integer |          | 1–100, default `20`     |
| `offset`  | query | integer |          | at least 0, default `0` |

| Status | Meaning                                                                 | Body                                                                                                          |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 200    | A page of files, by path, with how many there are.                      | object { items: [Evidence](#schema-evidence)[], limit, offset, total, withheld, purged } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource.                        | [Error](#schema-error) (`application/json`)                                                                   |
| 401    | No usable credential.                                                   | [Error](#schema-error) (`application/json`)                                                                   |
| 403    | Insufficient scope, role or project access.                             | [Error](#schema-error) (`application/json`)                                                                   |
| 404    | No such resource visible to this account.                               | [Error](#schema-error) (`application/json`)                                                                   |
| 409    | Name conflict or dataset still in use.                                  | [Error](#schema-error) (`application/json`)                                                                   |
| 429    | Rate limit or tenant quota exceeded.                                    | [Error](#schema-error) (`application/json`)                                                                   |
| 500    | The operation failed; writes are rolled back.                           | [Error](#schema-error) (`application/json`)                                                                   |
| 502    | The artifact store could not be reached (`artifact_store_unavailable`). | [Error](#schema-error) (`application/json`)                                                                   |

### `GET /api/v1/runs/{runId}/units` {#listRunUnits}

The units a run expected — one per test, browser, language and device — in plan order.

Each unit carries its single final result once written. Units of a test in a restricted project the caller is not on are left out. A run from before the manifest has none.

Scope `runs:read` · operation `listRunUnits`

| Parameter | In    | Type    | Required | Description             |
| --------- | ----- | ------- | -------- | ----------------------- |
| `runId`   | path  | string  | yes      |                         |
| `limit`   | query | integer |          | 1–100, default `20`     |
| `offset`  | query | integer |          | at least 0, default `0` |

| Status | Meaning                                          | Body                                                                                      |
| ------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 200    | A page of units, with how many there are.        | object { items: [RunUnit](#schema-rununit)[], limit, offset, total } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                               |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                               |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                               |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                               |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                               |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                               |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                               |

### `GET /api/v1/runs/{runId}/units/{unitId}` {#getRunUnit}

One unit with every attempt at it and every dataset row of each, with their evidence.

The first failure of a test that passed on a re-run keeps its own evidence, as does each dataset row. Links follow the rules of the artifacts endpoint: traces and HAR files only for the editor role and, on a scoped key, `runs:evidence`; otherwise null with `restricted: true`.

Scope `runs:read` · operation `getRunUnit`

| Parameter | In   | Type   | Required | Description                |
| --------- | ---- | ------ | -------- | -------------------------- |
| `runId`   | path | string | yes      |                            |
| `unitId`  | path | string | yes      | pattern `^u_[0-9a-f]{24}$` |

| Status | Meaning                                          | Body                                                        |
| ------ | ------------------------------------------------ | ----------------------------------------------------------- |
| 200    | Success.                                         | [RunUnitDetail](#schema-rununitdetail) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                 |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                 |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                 |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                 |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                 |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                 |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                 |

### `GET /api/v1/runs/{runId}/artifacts/{path}` {#getRunArtifact}

One evidence file, streamed with its content type.

Screenshots, videos, Lighthouse reports and downloaded files need `runs:read`. Traces, HAR files and unrecognised files are raw evidence that may hold credentials: they also need the editor role and, on a scoped key, the `runs:evidence` scope, and answer 403 otherwise.

Scope `runs:read` · operation `getRunArtifact`

| Parameter | In   | Type   | Required | Description                                                               |
| --------- | ---- | ------ | -------- | ------------------------------------------------------------------------- |
| `runId`   | path | string | yes      |                                                                           |
| `path`    | path | string | yes      | The file’s path below the run’s directory, as the evidence list gives it. |

| Status | Meaning                                                                 | Body                                        |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------- |
| 200    | The file.                                                               | string (binary) (`*/*`)                     |
| 400    | Invalid body, identifier or referenced resource.                        | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                                                   | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.                             | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.                               | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.                                  | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.                                    | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.                           | [Error](#schema-error) (`application/json`) |
| 502    | The artifact store could not be reached (`artifact_store_unavailable`). | [Error](#schema-error) (`application/json`) |

### `POST /api/v1/plans/{planId}/runs` {#startRun}

Start a run of a plan.

Queues the run and answers at once; poll `Location` until `status` is no longer queued, running or cancelling. Send an `Idempotency-Key` to make retrying the request safe: the same key returns the same run.

Scope `runs:write` · operation `startRun`

| Parameter         | In     | Type   | Required | Description          |
| ----------------- | ------ | ------ | -------- | -------------------- |
| `planId`          | path   | string | yes      |                      |
| `Idempotency-Key` | header | string |          | up to 255 characters |

**Request body** (`application/json`, optional)

| Field             | Type                           | Required | Description                                                                                                                                                                                             |
| ----------------- | ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environmentId`   | integer                        |          | The environment to run against.                                                                                                                                                                         |
| `updateBaselines` | boolean                        |          | Make this run's screenshots the new visual baselines.                                                                                                                                                   |
| `ci`              | [CiContext](#schema-cicontext) |          |                                                                                                                                                                                                         |
| `changedFiles`    | string[]                       |          | The files the change touched, relative to the repository root. The run is narrowed to the tests they affect, by the organization's impact map; a file no rule matches runs every test. up to 5000 items |

| Status | Meaning                                                                       | Body                                        |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------- |
| 202    | Queued.                                                                       | [Run](#schema-run) (`application/json`)     |
| 400    | The body or a header is not valid.                                            | [Error](#schema-error) (`application/json`) |
| 401    | No usable API key was sent.                                                   | [Error](#schema-error) (`application/json`) |
| 403    | The key lacks the scope, or its account's role is below what the scope needs. | [Error](#schema-error) (`application/json`) |
| 404    | No such plan, or no such environment, in this organization.                   | [Error](#schema-error) (`application/json`) |
| 429    | The organization's queue is full (`queue_quota_exceeded`).                    | [Error](#schema-error) (`application/json`) |
| 503    | The run could not be handed to a worker; retry with the same Idempotency-Key. | [Error](#schema-error) (`application/json`) |

### `GET /api/v1/runs` {#listRuns}

Runs, most recent first.

Scope `runs:read` · operation `listRuns`

| Parameter | In    | Type                                                                                               | Required | Description             |
| --------- | ----- | -------------------------------------------------------------------------------------------------- | -------- | ----------------------- |
| `limit`   | query | integer                                                                                            |          | 1–100, default `20`     |
| `offset`  | query | integer                                                                                            |          | at least 0, default `0` |
| `planId`  | query | string                                                                                             |          |                         |
| `status`  | query | one of `queued`, `running`, `completed`, `failed`, `error`, `cancelling`, `cancelled`, `timed_out` |          |                         |

| Status | Meaning                                                                       | Body                                                                       |
| ------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 200    | A page of runs.                                                               | object { items: [Run](#schema-run)[], limit, offset } (`application/json`) |
| 400    | An unknown status.                                                            | [Error](#schema-error) (`application/json`)                                |
| 401    | No usable API key was sent.                                                   | [Error](#schema-error) (`application/json`)                                |
| 403    | The key lacks the scope, or its account's role is below what the scope needs. | [Error](#schema-error) (`application/json`)                                |

### `GET /api/v1/runs/{runId}` {#getRun}

One run: its status and its counts.

Scope `runs:read` · operation `getRun`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `runId`   | path | string | yes      |             |

| Status | Meaning                                                                       | Body                                        |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------- |
| 200    | The run.                                                                      | [Run](#schema-run) (`application/json`)     |
| 401    | No usable API key was sent.                                                   | [Error](#schema-error) (`application/json`) |
| 403    | The key lacks the scope, or its account's role is below what the scope needs. | [Error](#schema-error) (`application/json`) |
| 404    | No such run in this organization.                                             | [Error](#schema-error) (`application/json`) |

### `POST /api/v1/runs/{runId}/cancel` {#cancelRun}

Stop a run.

A queued run is cancelled at once (200); a running one is asked to stop (202) and ends at its next step.

Scope `runs:write` · operation `cancelRun`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `runId`   | path | string | yes      |             |

| Status | Meaning                                                                       | Body                                        |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------- |
| 200    | Cancelled.                                                                    | [Run](#schema-run) (`application/json`)     |
| 202    | Asked to stop.                                                                | [Run](#schema-run) (`application/json`)     |
| 401    | No usable API key was sent.                                                   | [Error](#schema-error) (`application/json`) |
| 403    | The key lacks the scope, or its account's role is below what the scope needs. | [Error](#schema-error) (`application/json`) |
| 404    | No such run in this organization.                                             | [Error](#schema-error) (`application/json`) |
| 409    | The run has already ended.                                                    | [Error](#schema-error) (`application/json`) |

### `GET /api/v1/runs/{runId}/junit` {#getRunJUnit}

The run as JUnit XML, for the build's own test report.

Scope `runs:read` · operation `getRunJUnit`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `runId`   | path | string | yes      |             |

| Status | Meaning                                                                       | Body                                        |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------- |
| 200    | JUnit XML.                                                                    | string (`application/xml`)                  |
| 401    | No usable API key was sent.                                                   | [Error](#schema-error) (`application/json`) |
| 403    | The key lacks the scope, or its account's role is below what the scope needs. | [Error](#schema-error) (`application/json`) |
| 404    | No such run in this organization.                                             | [Error](#schema-error) (`application/json`) |

### `GET /api/v1/runs/{runId}/export/{format}` {#exportRun}

The run as a file to hand on: a self-contained HTML report, a PDF, or a zip of Allure results.

Scope `runs:read` · operation `exportRun`

| Parameter | In   | Type                                    | Required | Description |
| --------- | ---- | --------------------------------------- | -------- | ----------- |
| `runId`   | path | string                                  | yes      |             |
| `format`  | path | one of `html`, `pdf`, `allure`, `junit` | yes      |             |

| Status | Meaning                                                                                             | Body                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 200    | The file, as an attachment.                                                                         | string (`text/html`)<br>string (binary) (`application/pdf`)<br>string (binary) (`application/zip`) |
| 400    | Unknown format.                                                                                     | [Error](#schema-error) (`application/json`)                                                        |
| 401    | No usable API key was sent.                                                                         | [Error](#schema-error) (`application/json`)                                                        |
| 403    | The key lacks the scope, or its account's role is below what the scope needs.                       | [Error](#schema-error) (`application/json`)                                                        |
| 404    | No such run in this organization.                                                                   | [Error](#schema-error) (`application/json`)                                                        |
| 503    | PDF was asked for and the server has no browser to render it; the HTML export has the same content. | [Error](#schema-error) (`application/json`)                                                        |

## Schedules

### `GET /api/v1/schedules` {#listSchedules}

List plan schedules, newest first.

Scope `schedules:read` · operation `listSchedules`

| Parameter    | In    | Type    | Required | Description             |
| ------------ | ----- | ------- | -------- | ----------------------- |
| `limit`      | query | integer |          | 1–100, default `20`     |
| `offset`     | query | integer |          | at least 0, default `0` |
| `testPlanId` | query | string  |          |                         |

| Status | Meaning                                          | Body                                                                                 |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 200    | Success.                                         | object { items: [Schedule](#schema-schedule)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                          |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                          |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                          |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                          |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                          |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                          |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                          |

### `POST /api/v1/schedules` {#createSchedule}

Schedule a plan; runs are made on behalf of the key’s account.

Scope `schedules:write` · operation `createSchedule`

**Request body** (`application/json`)

[ScheduleInput](#schema-scheduleinput)

| Status | Meaning                                          | Body                                              |
| ------ | ------------------------------------------------ | ------------------------------------------------- |
| 201    | Success.                                         | [Schedule](#schema-schedule) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)       |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)       |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)       |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)       |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)       |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)       |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)       |

### `GET /api/v1/schedules/{scheduleId}` {#getSchedule}

Read a schedule.

Scope `schedules:read` · operation `getSchedule`

| Parameter    | In   | Type   | Required | Description |
| ------------ | ---- | ------ | -------- | ----------- |
| `scheduleId` | path | string | yes      |             |

| Status | Meaning                                          | Body                                              |
| ------ | ------------------------------------------------ | ------------------------------------------------- |
| 200    | Success.                                         | [Schedule](#schema-schedule) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)       |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)       |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)       |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)       |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)       |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)       |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)       |

### `PATCH /api/v1/schedules/{scheduleId}` {#updateSchedule}

Change a schedule; a change to when it runs recomputes its next run.

Scope `schedules:write` · operation `updateSchedule`

| Parameter    | In   | Type   | Required | Description |
| ------------ | ---- | ------ | -------- | ----------- |
| `scheduleId` | path | string | yes      |             |

**Request body** (`application/json`)

[SchedulePatch](#schema-schedulepatch)

| Status | Meaning                                          | Body                                              |
| ------ | ------------------------------------------------ | ------------------------------------------------- |
| 200    | Success.                                         | [Schedule](#schema-schedule) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)       |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)       |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)       |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)       |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)       |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)       |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)       |

### `DELETE /api/v1/schedules/{scheduleId}` {#deleteSchedule}

Delete a schedule.

Scope `schedules:write` · operation `deleteSchedule`

| Parameter    | In   | Type   | Required | Description |
| ------------ | ---- | ------ | -------- | ----------- |
| `scheduleId` | path | string | yes      |             |

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 204    | Success.                                         |                                             |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

### `POST /api/v1/schedules/{scheduleId}/pause` {#pauseSchedule}

Stop a schedule from firing, keeping it.

Scope `schedules:write` · operation `pauseSchedule`

| Parameter    | In   | Type   | Required | Description |
| ------------ | ---- | ------ | -------- | ----------- |
| `scheduleId` | path | string | yes      |             |

| Status | Meaning                                          | Body                                              |
| ------ | ------------------------------------------------ | ------------------------------------------------- |
| 200    | Success.                                         | [Schedule](#schema-schedule) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)       |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)       |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)       |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)       |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)       |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)       |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)       |

### `POST /api/v1/schedules/{scheduleId}/resume` {#resumeSchedule}

Let a paused schedule fire again.

Scope `schedules:write` · operation `resumeSchedule`

| Parameter    | In   | Type   | Required | Description |
| ------------ | ---- | ------ | -------- | ----------- |
| `scheduleId` | path | string | yes      |             |

| Status | Meaning                                          | Body                                              |
| ------ | ------------------------------------------------ | ------------------------------------------------- |
| 200    | Success.                                         | [Schedule](#schema-schedule) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)       |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)       |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)       |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)       |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)       |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)       |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)       |

## Environments

### `GET /api/v1/environments` {#listEnvironments}

List environments, by name.

Scope `environments:read` · operation `listEnvironments`

| Parameter | In    | Type    | Required | Description             |
| --------- | ----- | ------- | -------- | ----------------------- |
| `limit`   | query | integer |          | 1–100, default `20`     |
| `offset`  | query | integer |          | at least 0, default `0` |

| Status | Meaning                                          | Body                                                                                       |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 200    | Success.                                         | object { items: [Environment](#schema-environment)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                                |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                                |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                                |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                                |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                                |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                                |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                                |

### `POST /api/v1/environments` {#createEnvironment}

Create an environment; names are unique in the organization, ignoring case.

Scope `environments:write` · operation `createEnvironment`

**Request body** (`application/json`)

[EnvironmentInput](#schema-environmentinput)

| Status | Meaning                                          | Body                                                    |
| ------ | ------------------------------------------------ | ------------------------------------------------------- |
| 201    | Success.                                         | [Environment](#schema-environment) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)             |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)             |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)             |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)             |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)             |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)             |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)             |

### `GET /api/v1/environments/{environmentId}` {#getEnvironment}

Read an environment.

Scope `environments:read` · operation `getEnvironment`

| Parameter       | In   | Type    | Required | Description |
| --------------- | ---- | ------- | -------- | ----------- |
| `environmentId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                                    |
| ------ | ------------------------------------------------ | ------------------------------------------------------- |
| 200    | Success.                                         | [Environment](#schema-environment) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)             |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)             |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)             |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)             |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)             |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)             |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)             |

### `DELETE /api/v1/environments/{environmentId}` {#deleteEnvironment}

Delete an environment and its secrets.

Scope `environments:write` · operation `deleteEnvironment`

| Parameter       | In   | Type    | Required | Description |
| --------------- | ---- | ------- | -------- | ----------- |
| `environmentId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 204    | Success.                                         |                                             |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

### `GET /api/v1/environments/{environmentId}/secrets` {#listSecrets}

The names of an environment’s secrets, never their values.

Scope `environments:read` · operation `listSecrets`

| Parameter       | In    | Type    | Required | Description             |
| --------------- | ----- | ------- | -------- | ----------------------- |
| `environmentId` | path  | integer | yes      | at least 1              |
| `limit`         | query | integer |          | 1–100, default `20`     |
| `offset`        | query | integer |          | at least 0, default `0` |

| Status | Meaning                                          | Body                                                                             |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| 200    | Success.                                         | object { items: [Secret](#schema-secret)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                      |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                      |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                      |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                      |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                      |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                      |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                      |

## Secrets

### `PUT /api/v1/environments/{environmentId}/secrets/{keyName}` {#setSecret}

Set a secret (201) or rotate one that exists (200). The value is never read back.

Scope `secrets:write` · operation `setSecret`

| Parameter       | In   | Type    | Required | Description                       |
| --------------- | ---- | ------- | -------- | --------------------------------- |
| `environmentId` | path | integer | yes      | at least 1                        |
| `keyName`       | path | string  | yes      | pattern <code>^[&#92;w.]+$</code> |

**Request body** (`application/json`)

[SecretValue](#schema-secretvalue)

| Status | Meaning                                          | Body                                          |
| ------ | ------------------------------------------------ | --------------------------------------------- |
| 200    | Rotated: the stored value was replaced.          | [Secret](#schema-secret) (`application/json`) |
| 201    | Success.                                         | [Secret](#schema-secret) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)   |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)   |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)   |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)   |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)   |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)   |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)   |

### `DELETE /api/v1/environments/{environmentId}/secrets/{keyName}` {#deleteSecret}

Delete a secret.

Scope `secrets:write` · operation `deleteSecret`

| Parameter       | In   | Type    | Required | Description                       |
| --------------- | ---- | ------- | -------- | --------------------------------- |
| `environmentId` | path | integer | yes      | at least 1                        |
| `keyName`       | path | string  | yes      | pattern <code>^[&#92;w.]+$</code> |

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 204    | Success.                                         |                                             |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

## Tags

### `GET /api/v1/tags` {#listTags}

List tags, by name, with how many tests of each kind carry them.

Scope `tags:read` · operation `listTags`

| Parameter | In    | Type    | Required | Description             |
| --------- | ----- | ------- | -------- | ----------------------- |
| `limit`   | query | integer |          | 1–100, default `20`     |
| `offset`  | query | integer |          | at least 0, default `0` |

| Status | Meaning                                          | Body                                                                       |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------- |
| 200    | Success.                                         | object { items: [Tag](#schema-tag)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                |

### `POST /api/v1/tags` {#createTag}

Create a tag (201), or answer the one that already has the name (200).

Scope `tags:write` · operation `createTag`

**Request body** (`application/json`)

[TagInput](#schema-taginput)

| Status | Meaning                                               | Body                                        |
| ------ | ----------------------------------------------------- | ------------------------------------------- |
| 200    | A tag with this name, ignoring case, already existed. | [Tag](#schema-tag) (`application/json`)     |
| 201    | Success.                                              | [Tag](#schema-tag) (`application/json`)     |
| 400    | Invalid body, identifier or referenced resource.      | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                                 | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.           | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.             | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.                | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.                  | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.         | [Error](#schema-error) (`application/json`) |

### `GET /api/v1/tags/{tagId}` {#getTag}

Read a tag.

Scope `tags:read` · operation `getTag`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `tagId`   | path | string | yes      |             |

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 200    | Success.                                         | [Tag](#schema-tag) (`application/json`)     |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

### `PATCH /api/v1/tags/{tagId}` {#renameTag}

Rename a tag; every test carrying it follows.

Scope `tags:write` · operation `renameTag`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `tagId`   | path | string | yes      |             |

**Request body** (`application/json`)

[TagInput](#schema-taginput)

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 200    | Success.                                         | [Tag](#schema-tag) (`application/json`)     |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

### `DELETE /api/v1/tags/{tagId}` {#deleteTag}

Delete a tag and remove it from every test; says how many.

Scope `tags:write` · operation `deleteTag`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `tagId`   | path | string | yes      |             |

| Status | Meaning                                          | Body                                                    |
| ------ | ------------------------------------------------ | ------------------------------------------------------- |
| 200    | Success.                                         | [TagDeletion](#schema-tagdeletion) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)             |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)             |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)             |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)             |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)             |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)             |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)             |

## Quarantine

### `GET /api/v1/quarantine` {#listQuarantine}

The tests in quarantine, newest first, and how each has done since.

Scope `quarantine:read` · operation `listQuarantine`

| Parameter | In    | Type    | Required | Description             |
| --------- | ----- | ------- | -------- | ----------------------- |
| `limit`   | query | integer |          | 1–100, default `20`     |
| `offset`  | query | integer |          | at least 0, default `0` |

| Status | Meaning                                          | Body                                                                                                      |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 200    | A page of quarantined tests.                     | object { items: [QuarantinedTest](#schema-quarantinedtest)[], limit, offset, total } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                                               |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                                               |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                                               |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                                               |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                                               |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                                               |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                                               |

### `POST /api/v1/quarantine` {#quarantineTest}

Set a test aside: its failures no longer decide a run’s status.

Scope `quarantine:write` · operation `quarantineTest`

**Request body** (`application/json`)

[QuarantineInput](#schema-quarantineinput)

| Status | Meaning                                                   | Body                                                  |
| ------ | --------------------------------------------------------- | ----------------------------------------------------- |
| 201    | Success.                                                  | [Quarantine](#schema-quarantine) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource.          | [Error](#schema-error) (`application/json`)           |
| 401    | No usable credential.                                     | [Error](#schema-error) (`application/json`)           |
| 403    | Insufficient scope, role or project access.               | [Error](#schema-error) (`application/json`)           |
| 404    | No such resource visible to this account.                 | [Error](#schema-error) (`application/json`)           |
| 409    | `already_quarantined`: the test is already in quarantine. | [Error](#schema-error) (`application/json`)           |
| 429    | Rate limit or tenant quota exceeded.                      | [Error](#schema-error) (`application/json`)           |
| 500    | The operation failed; writes are rolled back.             | [Error](#schema-error) (`application/json`)           |

### `POST /api/v1/quarantine/{quarantineId}/release` {#releaseQuarantine}

Bring a test back: its failures count again from the next run.

Scope `quarantine:write` · operation `releaseQuarantine`

| Parameter      | In   | Type    | Required | Description |
| -------------- | ---- | ------- | -------- | ----------- |
| `quarantineId` | path | integer | yes      | at least 1  |

**Request body** (`application/json`)

[QuarantineRelease](#schema-quarantinerelease)

| Status | Meaning                                                  | Body                                                  |
| ------ | -------------------------------------------------------- | ----------------------------------------------------- |
| 200    | Success.                                                 | [Quarantine](#schema-quarantine) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource.         | [Error](#schema-error) (`application/json`)           |
| 401    | No usable credential.                                    | [Error](#schema-error) (`application/json`)           |
| 403    | Insufficient scope, role or project access.              | [Error](#schema-error) (`application/json`)           |
| 404    | No such resource visible to this account.                | [Error](#schema-error) (`application/json`)           |
| 409    | `already_released`: the test is no longer in quarantine. | [Error](#schema-error) (`application/json`)           |
| 429    | Rate limit or tenant quota exceeded.                     | [Error](#schema-error) (`application/json`)           |
| 500    | The operation failed; writes are rolled back.            | [Error](#schema-error) (`application/json`)           |

## Webhooks

### `GET /api/v1/plans/{planId}/webhooks` {#listWebhooks}

A plan’s webhooks, newest first; token prefixes only.

Scope `webhooks:read` · operation `listWebhooks`

| Parameter | In    | Type    | Required | Description             |
| --------- | ----- | ------- | -------- | ----------------------- |
| `planId`  | path  | string  | yes      |                         |
| `limit`   | query | integer |          | 1–100, default `20`     |
| `offset`  | query | integer |          | at least 0, default `0` |

| Status | Meaning                                          | Body                                                                               |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 200    | Success.                                         | object { items: [Webhook](#schema-webhook)[], limit, offset } (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                                        |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                                        |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                                        |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                                        |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                                        |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                                        |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                                        |

### `POST /api/v1/plans/{planId}/webhooks` {#createWebhook}

Create a webhook that starts the plan; the token is shown once.

Scope `webhooks:write` · operation `createWebhook`

| Parameter | In   | Type   | Required | Description |
| --------- | ---- | ------ | -------- | ----------- |
| `planId`  | path | string | yes      |             |

**Request body** (`application/json`)

[WebhookInput](#schema-webhookinput)

| Status | Meaning                                          | Body                                                          |
| ------ | ------------------------------------------------ | ------------------------------------------------------------- |
| 201    | Success.                                         | [WebhookCreated](#schema-webhookcreated) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)                   |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)                   |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)                   |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)                   |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)                   |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)                   |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)                   |

### `DELETE /api/v1/webhooks/{webhookId}` {#deleteWebhook}

Delete a webhook; its token stops working at once.

Scope `webhooks:write` · operation `deleteWebhook`

| Parameter   | In   | Type    | Required | Description |
| ----------- | ---- | ------- | -------- | ----------- |
| `webhookId` | path | integer | yes      | at least 1  |

| Status | Meaning                                          | Body                                        |
| ------ | ------------------------------------------------ | ------------------------------------------- |
| 204    | Success.                                         |                                             |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`) |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`) |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`) |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`) |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`) |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`) |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`) |

## Billing

### `GET /api/v1/billing` {#getBilling}

The organization’s plan, subscription status, the limits in force and its usage against them.

While `entitlement.runsBlocked` is true, starting a run answers `402 subscription_suspended`; reading runs and evidence still works.

Scope `billing:read` · operation `getBilling`

| Status | Meaning                                          | Body                                            |
| ------ | ------------------------------------------------ | ----------------------------------------------- |
| 200    | Success.                                         | [Billing](#schema-billing) (`application/json`) |
| 400    | Invalid body, identifier or referenced resource. | [Error](#schema-error) (`application/json`)     |
| 401    | No usable credential.                            | [Error](#schema-error) (`application/json`)     |
| 403    | Insufficient scope, role or project access.      | [Error](#schema-error) (`application/json`)     |
| 404    | No such resource visible to this account.        | [Error](#schema-error) (`application/json`)     |
| 409    | Name conflict or dataset still in use.           | [Error](#schema-error) (`application/json`)     |
| 429    | Rate limit or tenant quota exceeded.             | [Error](#schema-error) (`application/json`)     |
| 500    | The operation failed; writes are rolled back.    | [Error](#schema-error) (`application/json`)     |

## Schemas

### ApiTestInput {#schema-apitestinput}

| Field                  | Type                                                   | Required | Description                                                                                                                          |
| ---------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                 | string                                                 | yes      | up to 200 characters                                                                                                                 |
| `method`               | string                                                 | yes      | up to 20 characters                                                                                                                  |
| `url`                  | string                                                 | yes      | An absolute URL, or one starting with a variable such as &#123;&#123;baseUrl}}.                                                      |
| `projectId`            | integer \| null                                        |          | at least 1                                                                                                                           |
| `module`               | string \| null                                         |          |                                                                                                                                      |
| `featureArea`          | string \| null                                         |          |                                                                                                                                      |
| `scenario`             | string \| null                                         |          |                                                                                                                                      |
| `component`            | string \| null                                         |          |                                                                                                                                      |
| `priority`             | one of `Critical`, `High`, `Medium`, `Low`, `null`     |          |                                                                                                                                      |
| `severity`             | one of `Blocker`, `Critical`, `Major`, `Minor`, `null` |          |                                                                                                                                      |
| `queryParams`          | object \| null                                         |          |                                                                                                                                      |
| `requestHeaders`       | object \| null                                         |          |                                                                                                                                      |
| `requestBody`          |                                                        |          |                                                                                                                                      |
| `assertions`           | object[] \| null                                       |          |                                                                                                                                      |
| `extractions`          | object[] \| null                                       |          |                                                                                                                                      |
| `performance`          | object \| null                                         |          |                                                                                                                                      |
| `authType`             | string \| null                                         |          |                                                                                                                                      |
| `authParams`           | object \| null                                         |          | Reads replace literal secrets with &#123;&#123;&lt;type&gt;_&lt;parameter&gt;}}; sending that variable back keeps the stored secret. |
| `bodyType`             | string \| null                                         |          |                                                                                                                                      |
| `bodyRawContentType`   | string \| null                                         |          |                                                                                                                                      |
| `bodyFormData`         | object[] \| null                                       |          |                                                                                                                                      |
| `bodyUrlEncoded`       | object[] \| null                                       |          |                                                                                                                                      |
| `bodyGraphqlQuery`     | string \| null                                         |          |                                                                                                                                      |
| `bodyGraphqlVariables` | string \| null                                         |          |                                                                                                                                      |
| `protoDefinition`      | string \| null                                         |          |                                                                                                                                      |
| `protocolConfig`       | object \| null                                         |          |                                                                                                                                      |

### ApiTestPatch {#schema-apitestpatch}

| Field                  | Type                                                   | Required | Description                                                                                                                          |
| ---------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                 | string                                                 |          | up to 200 characters                                                                                                                 |
| `method`               | string                                                 |          | up to 20 characters                                                                                                                  |
| `url`                  | string                                                 |          | An absolute URL, or one starting with a variable such as &#123;&#123;baseUrl}}.                                                      |
| `projectId`            | integer \| null                                        |          | at least 1                                                                                                                           |
| `module`               | string \| null                                         |          |                                                                                                                                      |
| `featureArea`          | string \| null                                         |          |                                                                                                                                      |
| `scenario`             | string \| null                                         |          |                                                                                                                                      |
| `component`            | string \| null                                         |          |                                                                                                                                      |
| `priority`             | one of `Critical`, `High`, `Medium`, `Low`, `null`     |          |                                                                                                                                      |
| `severity`             | one of `Blocker`, `Critical`, `Major`, `Minor`, `null` |          |                                                                                                                                      |
| `queryParams`          | object \| null                                         |          |                                                                                                                                      |
| `requestHeaders`       | object \| null                                         |          |                                                                                                                                      |
| `requestBody`          |                                                        |          |                                                                                                                                      |
| `assertions`           | object[] \| null                                       |          |                                                                                                                                      |
| `extractions`          | object[] \| null                                       |          |                                                                                                                                      |
| `performance`          | object \| null                                         |          |                                                                                                                                      |
| `authType`             | string \| null                                         |          |                                                                                                                                      |
| `authParams`           | object \| null                                         |          | Reads replace literal secrets with &#123;&#123;&lt;type&gt;_&lt;parameter&gt;}}; sending that variable back keeps the stored secret. |
| `bodyType`             | string \| null                                         |          |                                                                                                                                      |
| `bodyRawContentType`   | string \| null                                         |          |                                                                                                                                      |
| `bodyFormData`         | object[] \| null                                       |          |                                                                                                                                      |
| `bodyUrlEncoded`       | object[] \| null                                       |          |                                                                                                                                      |
| `bodyGraphqlQuery`     | string \| null                                         |          |                                                                                                                                      |
| `bodyGraphqlVariables` | string \| null                                         |          |                                                                                                                                      |
| `protoDefinition`      | string \| null                                         |          |                                                                                                                                      |
| `protocolConfig`       | object \| null                                         |          |                                                                                                                                      |

### AttemptRow {#schema-attemptrow}

| Field           | Type                                          | Required | Description                                                                   |
| --------------- | --------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `datasetRow`    | integer                                       | yes      | at least 0                                                                    |
| `status`        | one of `passed`, `failed`, `error`, `skipped` | yes      |                                                                               |
| `error`         | string \| null                                |          |                                                                               |
| `screenshotUrl` | string \| null                                |          |                                                                               |
| `videoUrl`      | string \| null                                |          |                                                                               |
| `traceUrl`      | string \| null                                |          | Raw evidence: null unless the caller has the editor role and `runs:evidence`. |
| `harUrl`        | string \| null                                |          | Raw evidence, like the trace.                                                 |
| `restricted`    | boolean                                       | yes      | Raw evidence was kept for this slice and the caller may not open it.          |

### AuthoredApiTest {#schema-authoredapitest}

| Field                  | Type                                                   | Required | Description                                                                                                                          |
| ---------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | integer                                                |          | at least 1                                                                                                                           |
| `name`                 | string                                                 |          | up to 200 characters                                                                                                                 |
| `method`               | string                                                 |          | up to 20 characters                                                                                                                  |
| `url`                  | string                                                 |          | An absolute URL, or one starting with a variable such as &#123;&#123;baseUrl}}.                                                      |
| `projectId`            | integer \| null                                        |          | at least 1                                                                                                                           |
| `module`               | string \| null                                         |          |                                                                                                                                      |
| `featureArea`          | string \| null                                         |          |                                                                                                                                      |
| `scenario`             | string \| null                                         |          |                                                                                                                                      |
| `component`            | string \| null                                         |          |                                                                                                                                      |
| `priority`             | one of `Critical`, `High`, `Medium`, `Low`, `null`     |          |                                                                                                                                      |
| `severity`             | one of `Blocker`, `Critical`, `Major`, `Minor`, `null` |          |                                                                                                                                      |
| `queryParams`          | object \| null                                         |          |                                                                                                                                      |
| `requestHeaders`       | object \| null                                         |          |                                                                                                                                      |
| `requestBody`          |                                                        |          |                                                                                                                                      |
| `assertions`           | object[] \| null                                       |          |                                                                                                                                      |
| `extractions`          | object[] \| null                                       |          |                                                                                                                                      |
| `performance`          | object \| null                                         |          |                                                                                                                                      |
| `authType`             | string \| null                                         |          |                                                                                                                                      |
| `authParams`           | object \| null                                         |          | Reads replace literal secrets with &#123;&#123;&lt;type&gt;_&lt;parameter&gt;}}; sending that variable back keeps the stored secret. |
| `bodyType`             | string \| null                                         |          |                                                                                                                                      |
| `bodyRawContentType`   | string \| null                                         |          |                                                                                                                                      |
| `bodyFormData`         | object[] \| null                                       |          |                                                                                                                                      |
| `bodyUrlEncoded`       | object[] \| null                                       |          |                                                                                                                                      |
| `bodyGraphqlQuery`     | string \| null                                         |          |                                                                                                                                      |
| `bodyGraphqlVariables` | string \| null                                         |          |                                                                                                                                      |
| `protoDefinition`      | string \| null                                         |          |                                                                                                                                      |
| `protocolConfig`       | object \| null                                         |          |                                                                                                                                      |
| `createdAt`            | string (date-time)                                     |          |                                                                                                                                      |
| `updatedAt`            | string (date-time)                                     |          |                                                                                                                                      |
| `publishedVersion`     | integer \| null                                        |          |                                                                                                                                      |

### AuthoredMobileTest {#schema-authoredmobiletest}

| Field              | Type                    | Required | Description                                                                          |
| ------------------ | ----------------------- | -------- | ------------------------------------------------------------------------------------ |
| `id`               | integer                 |          | at least 1                                                                           |
| `name`             | string                  |          | up to 200 characters                                                                 |
| `platform`         | one of `android`, `ios` |          |                                                                                      |
| `app`              | string                  |          | bs://…, lt://…, an http(s):// address, or a local Appium path. up to 1000 characters |
| `deviceName`       | string                  |          | up to 120 characters                                                                 |
| `osVersion`        | string \| null          |          | up to 20 characters                                                                  |
| `deviceMatrix`     | object[]                |          | up to 20 items, default `[]`                                                         |
| `projectId`        | integer \| null         |          | at least 1                                                                           |
| `gridId`           | string \| null          |          | up to 100 characters                                                                 |
| `steps`            | object[]                |          | up to 200 items                                                                      |
| `createdAt`        | string (date-time)      |          |                                                                                      |
| `updatedAt`        | string (date-time)      |          |                                                                                      |
| `publishedVersion` | integer \| null         |          |                                                                                      |

### AuthoredPlan {#schema-authoredplan}

| Field                | Type                                        | Required | Description                          |
| -------------------- | ------------------------------------------- | -------- | ------------------------------------ |
| `id`                 | string                                      |          |                                      |
| `name`               | string                                      |          | up to 200 characters                 |
| `description`        | string \| null                              |          | up to 2000 characters                |
| `selectedTests`      | object { id, type }[]                       |          | up to 2000 items                     |
| `maxParallelTests`   | integer                                     |          | 1–16                                 |
| `shards`             | integer                                     |          | 1–8                                  |
| `pageLoadTimeout`    | integer                                     |          | 1000–600000                          |
| `elementTimeout`     | integer                                     |          | 1000–600000                          |
| `captureScreenshots` | one of `never`, `on_failed_steps`, `always` |          |                                      |
| `captureVideo`       | one of `never`, `on_failure`, `always`      |          |                                      |
| `captureTrace`       | one of `never`, `on_failure`, `always`      |          |                                      |
| `agentPool`          | string \| null                              |          | pattern `^[a-z0-9][a-z0-9_-]{0,39}$` |
| `locales`            | string[]                                    |          | up to 10 items                       |
| `createdAt`          | string (date-time)                          |          |                                      |
| `updatedAt`          | string (date-time)                          |          |                                      |

### AuthoredTest {#schema-authoredtest}

| Field              | Type                                | Required | Description                    |
| ------------------ | ----------------------------------- | -------- | ------------------------------ |
| `id`               | integer                             |          | at least 1                     |
| `name`             | string                              |          | up to 200 characters           |
| `url`              | string                              |          | up to 4000 characters          |
| `projectId`        | integer \| null                     |          | at least 1                     |
| `sequence`         | object[]                            |          | up to 2000 items               |
| `elements`         | object[]                            |          | up to 2000 items, default `[]` |
| `bdd`              |                                     |          |                                |
| `dataset`          |                                     |          |                                |
| `preconditions`    |                                     |          |                                |
| `cleanups`         |                                     |          |                                |
| `module`           | string \| null                      |          |                                |
| `featureArea`      | string \| null                      |          |                                |
| `scenario`         | string \| null                      |          |                                |
| `component`        | string \| null                      |          |                                |
| `priority`         | string \| null                      |          |                                |
| `severity`         | string \| null                      |          |                                |
| `status`           | one of `draft`, `ready`, `archived` |          |                                |
| `createdAt`        | string (date-time)                  |          |                                |
| `updatedAt`        | string (date-time)                  |          |                                |
| `publishedVersion` | integer \| null                     |          |                                |

### Billing {#schema-billing}

| Field              | Type                                                                                                                                                                                                     | Required | Description                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `provider`         | one of `none`, `stripe`                                                                                                                                                                                  | yes      |                                                                                                                |
| `plan`             | [BillingPlan](#schema-billingplan)                                                                                                                                                                       | yes      |                                                                                                                |
| `subscription`     | object { organizationId, planCode, status, interval, currentPeriodStart, currentPeriodEnd, trialEndsAt, pastDueSince, provider, providerCustomerId, providerSubscriptionId, suspendedReason, updatedAt } | yes      |                                                                                                                |
| `entitlement`      | object { runsBlocked, reason, graceEndsAt }                                                                                                                                                              | yes      |                                                                                                                |
| `quotas`           | object { mode, maxConcurrentRuns, maxQueuedRuns, maxTests, maxArtifactBytes, maxMonthlyExecutionMinutes }                                                                                                | yes      | The limits in force: an installation administrator’s override, else the plan’s, else the installation default. |
| `usage`            | object                                                                                                                                                                                                   | yes      |                                                                                                                |
| `pastDueGraceDays` | integer                                                                                                                                                                                                  | yes      | at least 0                                                                                                     |

### BillingPlan {#schema-billingplan}

| Field              | Type                                                                                                | Required | Description                     |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------- | ------------------------------- |
| `code`             | string                                                                                              | yes      |                                 |
| `name`             | string                                                                                              | yes      |                                 |
| `priceMonthMinor`  | integer                                                                                             |          | at least 0                      |
| `priceYearMinor`   | integer                                                                                             |          | at least 0                      |
| `currency`         | string                                                                                              |          | ISO 4217, lowercase.            |
| `trialDays`        | integer                                                                                             |          | at least 0                      |
| `active`           | boolean                                                                                             |          |                                 |
| `quotas`           | object { maxConcurrentRuns, maxQueuedRuns, maxTests, maxArtifactBytes, maxMonthlyExecutionMinutes } | yes      | Null: the installation default. |
| `providerPriceIds` | object                                                                                              |          |                                 |

### CiContext {#schema-cicontext}

The build that asked for a run. The wfm CLI fills it in from the CI system's environment.

| Field         | Type                                                                            | Required | Description                   |
| ------------- | ------------------------------------------------------------------------------- | -------- | ----------------------------- |
| `provider`    | one of `github`, `gitlab`, `jenkins`, `azure`, `bitbucket`, `circleci`, `other` | yes      |                               |
| `repository`  | string                                                                          |          | up to 300 characters          |
| `commit`      | string                                                                          |          | pattern `^[0-9a-fA-F]{7,64}$` |
| `branch`      | string                                                                          |          | up to 300 characters          |
| `pullRequest` | string                                                                          |          | up to 50 characters           |
| `buildId`     | string                                                                          |          | up to 200 characters          |
| `buildUrl`    | string (uri)                                                                    |          | http or https only.           |
| `actor`       | string                                                                          |          | up to 200 characters          |

### Dataset {#schema-dataset}

| Field         | Type               | Required | Description                      |
| ------------- | ------------------ | -------- | -------------------------------- |
| `id`          | integer            |          | at least 1                       |
| `name`        | string             |          | pattern `^[a-z][a-z0-9_]{0,49}$` |
| `description` | string \| null     |          | up to 500 characters             |
| `columns`     | string[]           |          | up to 50 items                   |
| `rows`        | object[]           |          | up to 1000 items                 |
| `createdAt`   | string (date-time) |          |                                  |
| `updatedAt`   | string (date-time) |          |                                  |

### DatasetInput {#schema-datasetinput}

| Field         | Type           | Required | Description                      |
| ------------- | -------------- | -------- | -------------------------------- |
| `name`        | string         | yes      | pattern `^[a-z][a-z0-9_]{0,49}$` |
| `description` | string \| null |          | up to 500 characters             |
| `columns`     | string[]       | yes      | up to 50 items                   |
| `rows`        | object[]       | yes      | up to 1000 items                 |

### Environment {#schema-environment}

| Field                  | Type                       | Required | Description                                                                    |
| ---------------------- | -------------------------- | -------- | ------------------------------------------------------------------------------ |
| `id`                   | integer                    |          | at least 1                                                                     |
| `name`                 | string                     |          | up to 120 characters                                                           |
| `description`          | string \| null             |          | up to 2000 characters                                                          |
| `createdAt`            | string (date-time)         |          |                                                                                |
| `loginStateCapturedAt` | string (date-time) \| null |          | When a saved browser login was captured for it; the login itself never leaves. |

### EnvironmentInput {#schema-environmentinput}

| Field         | Type           | Required | Description           |
| ------------- | -------------- | -------- | --------------------- |
| `name`        | string         | yes      | up to 120 characters  |
| `description` | string \| null |          | up to 2000 characters |

### Error {#schema-error}

| Field   | Type                     | Required | Description |
| ------- | ------------------------ | -------- | ----------- |
| `error` | object { code, message } | yes      |             |

### Evidence {#schema-evidence}

| Field         | Type                                                                    | Required | Description                                       |
| ------------- | ----------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| `path`        | string                                                                  | yes      | Below the run’s own directory.                    |
| `kind`        | one of `screenshot`, `video`, `trace`, `log`, `report`, `data`, `other` | yes      |                                                   |
| `contentType` | string                                                                  | yes      |                                                   |
| `size`        | integer                                                                 | yes      | at least 0                                        |
| `url`         | string                                                                  | yes      | Where the file is served from, with the same key. |

### MobileTestInput {#schema-mobiletestinput}

| Field          | Type                    | Required | Description                                                                          |
| -------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------ |
| `name`         | string                  | yes      | up to 200 characters                                                                 |
| `platform`     | one of `android`, `ios` | yes      |                                                                                      |
| `app`          | string                  | yes      | bs://…, lt://…, an http(s):// address, or a local Appium path. up to 1000 characters |
| `deviceName`   | string                  | yes      | up to 120 characters                                                                 |
| `osVersion`    | string \| null          |          | up to 20 characters                                                                  |
| `deviceMatrix` | object[]                |          | up to 20 items, default `[]`                                                         |
| `projectId`    | integer \| null         |          | at least 1                                                                           |
| `gridId`       | string \| null          |          | up to 100 characters                                                                 |
| `steps`        | object[]                | yes      | up to 200 items                                                                      |

### MobileTestPatch {#schema-mobiletestpatch}

| Field          | Type                    | Required | Description                                                                          |
| -------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------ |
| `name`         | string                  |          | up to 200 characters                                                                 |
| `platform`     | one of `android`, `ios` |          |                                                                                      |
| `app`          | string                  |          | bs://…, lt://…, an http(s):// address, or a local Appium path. up to 1000 characters |
| `deviceName`   | string                  |          | up to 120 characters                                                                 |
| `osVersion`    | string \| null          |          | up to 20 characters                                                                  |
| `deviceMatrix` | object[]                |          | up to 20 items, default `[]`                                                         |
| `projectId`    | integer \| null         |          | at least 1                                                                           |
| `gridId`       | string \| null          |          | up to 100 characters                                                                 |
| `steps`        | object[]                |          | up to 200 items                                                                      |

### Plan {#schema-plan}

| Field         | Type               | Required | Description |
| ------------- | ------------------ | -------- | ----------- |
| `id`          | string             | yes      |             |
| `name`        | string             | yes      |             |
| `description` | string \| null     |          |             |
| `createdAt`   | string (date-time) |          |             |

### PlanInput {#schema-planinput}

| Field                | Type                                        | Required | Description                          |
| -------------------- | ------------------------------------------- | -------- | ------------------------------------ |
| `name`               | string                                      | yes      | up to 200 characters                 |
| `description`        | string \| null                              |          | up to 2000 characters                |
| `selectedTests`      | object { id, type }[]                       |          | up to 2000 items                     |
| `maxParallelTests`   | integer                                     |          | 1–16                                 |
| `shards`             | integer                                     |          | 1–8                                  |
| `pageLoadTimeout`    | integer                                     |          | 1000–600000                          |
| `elementTimeout`     | integer                                     |          | 1000–600000                          |
| `captureScreenshots` | one of `never`, `on_failed_steps`, `always` |          |                                      |
| `captureVideo`       | one of `never`, `on_failure`, `always`      |          |                                      |
| `captureTrace`       | one of `never`, `on_failure`, `always`      |          |                                      |
| `agentPool`          | string \| null                              |          | pattern `^[a-z0-9][a-z0-9_-]{0,39}$` |
| `locales`            | string[]                                    |          | up to 10 items                       |

### PlanPatch {#schema-planpatch}

| Field                | Type                                        | Required | Description                          |
| -------------------- | ------------------------------------------- | -------- | ------------------------------------ |
| `name`               | string                                      |          | up to 200 characters                 |
| `description`        | string \| null                              |          | up to 2000 characters                |
| `selectedTests`      | object { id, type }[]                       |          | up to 2000 items                     |
| `maxParallelTests`   | integer                                     |          | 1–16                                 |
| `shards`             | integer                                     |          | 1–8                                  |
| `pageLoadTimeout`    | integer                                     |          | 1000–600000                          |
| `elementTimeout`     | integer                                     |          | 1000–600000                          |
| `captureScreenshots` | one of `never`, `on_failed_steps`, `always` |          |                                      |
| `captureVideo`       | one of `never`, `on_failure`, `always`      |          |                                      |
| `captureTrace`       | one of `never`, `on_failure`, `always`      |          |                                      |
| `agentPool`          | string \| null                              |          | pattern `^[a-z0-9][a-z0-9_-]{0,39}$` |
| `locales`            | string[]                                    |          | up to 10 items                       |

### Project {#schema-project}

| Field        | Type               | Required | Description          |
| ------------ | ------------------ | -------- | -------------------- |
| `id`         | integer            |          | at least 1           |
| `name`       | string             |          | up to 200 characters |
| `restricted` | boolean            |          |                      |
| `createdAt`  | string (date-time) |          |                      |

### ProjectInput {#schema-projectinput}

| Field  | Type   | Required | Description          |
| ------ | ------ | -------- | -------------------- |
| `name` | string | yes      | up to 200 characters |

### ProjectPatch {#schema-projectpatch}

| Field  | Type   | Required | Description          |
| ------ | ------ | -------- | -------------------- |
| `name` | string | yes      | up to 200 characters |

### Quarantine {#schema-quarantine}

| Field           | Type                         | Required | Description |
| --------------- | ---------------------------- | -------- | ----------- |
| `id`            | integer                      | yes      | at least 1  |
| `testType`      | one of `ui`, `api`, `mobile` | yes      |             |
| `testId`        | integer                      | yes      | at least 1  |
| `reason`        | string                       | yes      |             |
| `quarantinedAt` | string (date-time)           | yes      |             |
| `releasedAt`    | string (date-time) \| null   |          |             |
| `releaseNote`   | string \| null               |          |             |

### QuarantineInput {#schema-quarantineinput}

| Field      | Type                         | Required | Description           |
| ---------- | ---------------------------- | -------- | --------------------- |
| `testType` | one of `ui`, `api`, `mobile` | yes      |                       |
| `testId`   | integer                      | yes      | at least 1            |
| `reason`   | string                       | yes      | up to 2000 characters |

### QuarantineRelease {#schema-quarantinerelease}

| Field  | Type   | Required | Description           |
| ------ | ------ | -------- | --------------------- |
| `note` | string |          | up to 2000 characters |

### QuarantinedTest {#schema-quarantinedtest}

| Field           | Type                         | Required | Description                                                                    |
| --------------- | ---------------------------- | -------- | ------------------------------------------------------------------------------ |
| `id`            | integer                      | yes      | at least 1                                                                     |
| `testType`      | one of `ui`, `api`, `mobile` | yes      |                                                                                |
| `testId`        | integer                      | yes      | at least 1                                                                     |
| `testName`      | string \| null               |          |                                                                                |
| `reason`        | string                       | yes      |                                                                                |
| `quarantinedAt` | string (date-time)           | yes      |                                                                                |
| `quarantinedBy` | string \| null               |          |                                                                                |
| `evidence`      | object                       |          | How the test has done since it was set aside, as the web application shows it. |

### Run {#schema-run}

| Field           | Type                                                                                               | Required | Description                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`            | string                                                                                             | yes      |                                                                                                   |
| `planId`        | string                                                                                             | yes      |                                                                                                   |
| `planName`      | string \| null                                                                                     |          |                                                                                                   |
| `status`        | one of `queued`, `running`, `completed`, `failed`, `error`, `cancelling`, `cancelled`, `timed_out` | yes      |                                                                                                   |
| `trigger`       | one of `manual`, `scheduled`, `webhook`, `api`                                                     | yes      |                                                                                                   |
| `attempt`       | integer                                                                                            |          |                                                                                                   |
| `maxAttempts`   | integer                                                                                            |          |                                                                                                   |
| `queuedAt`      | string (date-time)                                                                                 |          |                                                                                                   |
| `quotaDeferral` | object { reason, until } \| null                                                                   |          |                                                                                                   |
| `startedAt`     | string (date-time) \| null                                                                         |          |                                                                                                   |
| `completedAt`   | string (date-time) \| null                                                                         |          |                                                                                                   |
| `durationMs`    | integer \| null                                                                                    |          |                                                                                                   |
| `tests`         | object { total, passed, failed, skipped, quarantinedFailures }                                     |          |                                                                                                   |
| `runner`        | string \| null                                                                                     |          | The runner that took the run, as host:pid:suffix.                                                 |
| `failure`       | object { code, message } \| null                                                                   |          |                                                                                                   |
| `ci`            | [CiContext](#schema-cicontext) or null                                                             |          | The build that asked for the run, when a pipeline did.                                            |
| `selection`     | object { mode, reason, changedFiles, affectedTags: string[], selected, total } \| null             |          | When the run was narrowed to the tests a change affects (changedFiles): what was decided and why. |
| `links`         | object { self, junit, evidence, report }                                                           | yes      |                                                                                                   |

### RunUnit {#schema-rununit}

| Field        | Type                                                               | Required | Description                                                                    |
| ------------ | ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------ |
| `unitId`     | string                                                             | yes      | Opaque, scoped to its run. pattern `^u_[0-9a-f]{24}$`                          |
| `position`   | integer                                                            | yes      | Plan order. at least 0                                                         |
| `state`      | one of `planned`, `running`, `recorded`, `not_startable`           | yes      |                                                                                |
| `reason`     | string \| null                                                     |          | Why a not_startable unit could not start.                                      |
| `testType`   | one of `ui`, `api`, `mobile`                                       | yes      |                                                                                |
| `testId`     | integer \| null                                                    |          |                                                                                |
| `occurrence` | integer                                                            |          | Which occurrence of the test. at least 0                                       |
| `browser`    | string \| null                                                     |          |                                                                                |
| `locale`     | string \| null                                                     |          |                                                                                |
| `device`     | string \| null                                                     |          |                                                                                |
| `bddRow`     | integer \| null                                                    |          | A cucumber test’s dataset row, by index; a UI dataset’s rows are attempt rows. |
| `result`     | object { id, testName, status, attempts, decidingAttempt } \| null | yes      | Its single final result, once written.                                         |

### RunUnitDetail {#schema-rununitdetail}

| Field      | Type                                                                               | Required | Description |
| ---------- | ---------------------------------------------------------------------------------- | -------- | ----------- |
| `evidence` | object { unitId, decidingAttempt, attempts: [UnitAttempt](#schema-unitattempt)[] } | yes      |             |

### Schedule {#schema-schedule}

| Field                        | Type                           | Required | Description                                                                                                                                  |
| ---------------------------- | ------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                         | string                         |          |                                                                                                                                              |
| `testPlanId`                 | string                         |          | up to 100 characters                                                                                                                         |
| `scheduleName`               | string                         |          | up to 200 characters                                                                                                                         |
| `frequency`                  | string                         |          | As the web application saves it: `once`, `daily`, `weekly`, `every_N_minutes`, `every_N_hours`, or `cron:<expression>`. up to 200 characters |
| `nextRunAt`                  | string (date-time)             |          |                                                                                                                                              |
| `timezone`                   | string                         |          | An IANA zone; UTC by default. up to 100 characters                                                                                           |
| `environment`                | string \| null                 |          | up to 200 characters                                                                                                                         |
| `browsers`                   | string[] \| null               |          | up to 10 items                                                                                                                               |
| `notificationConfigOverride` | object \| null                 |          |                                                                                                                                              |
| `executionParameters`        | object \| null                 |          |                                                                                                                                              |
| `isActive`                   | boolean                        |          |                                                                                                                                              |
| `retryOnFailure`             | one of `none`, `once`, `twice` |          |                                                                                                                                              |
| `testPlanName`               | string \| null                 |          |                                                                                                                                              |
| `createdAt`                  | string (date-time)             |          |                                                                                                                                              |
| `updatedAt`                  | string (date-time) \| null     |          |                                                                                                                                              |

### ScheduleInput {#schema-scheduleinput}

| Field                        | Type                           | Required | Description                                                                                                                                                             |
| ---------------------------- | ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testPlanId`                 | string                         | yes      | up to 100 characters                                                                                                                                                    |
| `scheduleName`               | string                         | yes      | up to 200 characters                                                                                                                                                    |
| `frequency`                  | string                         | yes      | As the web application saves it: `once`, `daily`, `weekly`, `every_N_minutes`, `every_N_hours`, or `cron:<expression>`. up to 200 characters                            |
| `nextRunAt`                  | string (date-time) or number   | yes      | When it first runs: an ISO 8601 date-time, or Unix seconds. For a CRON or every_N frequency the first occurrence of the pattern at or after it, in the schedule’s zone. |
| `timezone`                   | string                         |          | An IANA zone; UTC by default. up to 100 characters                                                                                                                      |
| `environment`                | string \| null                 |          | up to 200 characters                                                                                                                                                    |
| `browsers`                   | string[] \| null               |          | up to 10 items                                                                                                                                                          |
| `notificationConfigOverride` | object \| null                 |          |                                                                                                                                                                         |
| `executionParameters`        | object \| null                 |          |                                                                                                                                                                         |
| `isActive`                   | boolean                        |          |                                                                                                                                                                         |
| `retryOnFailure`             | one of `none`, `once`, `twice` |          |                                                                                                                                                                         |

### SchedulePatch {#schema-schedulepatch}

| Field                        | Type                           | Required | Description                                                                                                                                                             |
| ---------------------------- | ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testPlanId`                 | string                         |          | up to 100 characters                                                                                                                                                    |
| `scheduleName`               | string                         |          | up to 200 characters                                                                                                                                                    |
| `frequency`                  | string                         |          | As the web application saves it: `once`, `daily`, `weekly`, `every_N_minutes`, `every_N_hours`, or `cron:<expression>`. up to 200 characters                            |
| `nextRunAt`                  | string (date-time) or number   |          | When it first runs: an ISO 8601 date-time, or Unix seconds. For a CRON or every_N frequency the first occurrence of the pattern at or after it, in the schedule’s zone. |
| `timezone`                   | string                         |          | An IANA zone; UTC by default. up to 100 characters                                                                                                                      |
| `environment`                | string \| null                 |          | up to 200 characters                                                                                                                                                    |
| `browsers`                   | string[] \| null               |          | up to 10 items                                                                                                                                                          |
| `notificationConfigOverride` | object \| null                 |          |                                                                                                                                                                         |
| `executionParameters`        | object \| null                 |          |                                                                                                                                                                         |
| `isActive`                   | boolean                        |          |                                                                                                                                                                         |
| `retryOnFailure`             | one of `none`, `once`, `twice` |          |                                                                                                                                                                         |

### Secret {#schema-secret}

| Field           | Type               | Required | Description                                             |
| --------------- | ------------------ | -------- | ------------------------------------------------------- |
| `id`            | integer            | yes      | at least 1                                              |
| `environmentId` | integer            | yes      | at least 1                                              |
| `keyName`       | string             | yes      | up to 120 characters, pattern <code>^[&#92;w.]+$</code> |
| `createdAt`     | string (date-time) |          |                                                         |
| `updatedAt`     | string (date-time) |          |                                                         |

### SecretValue {#schema-secretvalue}

| Field   | Type   | Required | Description             |
| ------- | ------ | -------- | ----------------------- |
| `value` | string | yes      | up to 100000 characters |

### SuiteExport {#schema-suiteexport}

| Field             | Type                             | Required | Description |
| ----------------- | -------------------------------- | -------- | ----------- |
| `format`          | one of `json`, `yaml`, `gherkin` |          |             |
| `content`         | string                           |          |             |
| `fileName`        | string                           |          |             |
| `secretsReplaced` | string[]                         |          |             |
| `withReferences`  | string[]                         |          |             |

### SuiteExportInput {#schema-suiteexportinput}

| Field       | Type                                        | Required | Description                                                                                                                       |
| ----------- | ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `projectId` | integer                                     | yes      | at least 1                                                                                                                        |
| `format`    | one of `json`, `yaml`, `gherkin`            |          | default `"json"`                                                                                                                  |
| `include`   | one of `tests`, `apiTests`, `mobileTests`[] |          | apiTests also needs api-tests:read, mobileTests mobile-tests:read; Gherkin carries tests only. up to 3 items, default `["tests"]` |

### SuiteImport {#schema-suiteimport}

| Field     | Type                                 | Required | Description |
| --------- | ------------------------------------ | -------- | ----------- |
| `dryRun`  | boolean                              | yes      |             |
| `results` | object { kind, name, id, outcome }[] | yes      |             |

### SuiteImportInput {#schema-suiteimportinput}

| Field       | Type                             | Required | Description              |
| ----------- | -------------------------------- | -------- | ------------------------ |
| `projectId` | integer                          | yes      | at least 1               |
| `content`   | string                           | yes      | up to 2000000 characters |
| `format`    | one of `json`, `yaml`, `gherkin` |          |                          |
| `dryRun`    | boolean                          |          | default `false`          |

### Tag {#schema-tag}

| Field         | Type               | Required | Description |
| ------------- | ------------------ | -------- | ----------- |
| `id`          | string             | yes      |             |
| `name`        | string             | yes      |             |
| `createdAt`   | string (date-time) |          |             |
| `uiCount`     | integer            |          | at least 0  |
| `apiCount`    | integer            |          | at least 0  |
| `mobileCount` | integer            |          | at least 0  |

### TagDeletion {#schema-tagdeletion}

| Field         | Type    | Required | Description                                |
| ------------- | ------- | -------- | ------------------------------------------ |
| `id`          | string  | yes      |                                            |
| `removedFrom` | integer | yes      | How many tests carried the tag. at least 0 |

### TagInput {#schema-taginput}

| Field  | Type   | Required | Description         |
| ------ | ------ | -------- | ------------------- |
| `name` | string | yes      | up to 60 characters |

### TestInput {#schema-testinput}

| Field           | Type                                | Required | Description                    |
| --------------- | ----------------------------------- | -------- | ------------------------------ |
| `name`          | string                              | yes      | up to 200 characters           |
| `url`           | string                              | yes      | up to 4000 characters          |
| `projectId`     | integer \| null                     |          | at least 1                     |
| `sequence`      | object[]                            | yes      | up to 2000 items               |
| `elements`      | object[]                            |          | up to 2000 items, default `[]` |
| `bdd`           |                                     |          |                                |
| `dataset`       |                                     |          |                                |
| `preconditions` |                                     |          |                                |
| `cleanups`      |                                     |          |                                |
| `module`        | string \| null                      |          |                                |
| `featureArea`   | string \| null                      |          |                                |
| `scenario`      | string \| null                      |          |                                |
| `component`     | string \| null                      |          |                                |
| `priority`      | string \| null                      |          |                                |
| `severity`      | string \| null                      |          |                                |
| `status`        | one of `draft`, `ready`, `archived` |          |                                |

### TestPatch {#schema-testpatch}

| Field           | Type                                | Required | Description                    |
| --------------- | ----------------------------------- | -------- | ------------------------------ |
| `name`          | string                              |          | up to 200 characters           |
| `url`           | string                              |          | up to 4000 characters          |
| `projectId`     | integer \| null                     |          | at least 1                     |
| `sequence`      | object[]                            |          | up to 2000 items               |
| `elements`      | object[]                            |          | up to 2000 items, default `[]` |
| `bdd`           |                                     |          |                                |
| `dataset`       |                                     |          |                                |
| `preconditions` |                                     |          |                                |
| `cleanups`      |                                     |          |                                |
| `module`        | string \| null                      |          |                                |
| `featureArea`   | string \| null                      |          |                                |
| `scenario`      | string \| null                      |          |                                |
| `component`     | string \| null                      |          |                                |
| `priority`      | string \| null                      |          |                                |
| `severity`      | string \| null                      |          |                                |
| `status`        | one of `draft`, `ready`, `archived` |          |                                |

### UnitAttempt {#schema-unitattempt}

| Field           | Type                               | Required | Description                                                                   |
| --------------- | ---------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `attempt`       | integer                            | yes      | at least 1                                                                    |
| `state`         | one of `running`, `finished`       | yes      |                                                                               |
| `status`        | string \| null                     |          |                                                                               |
| `failureReason` | string \| null                     |          |                                                                               |
| `startedAt`     | string (date-time)                 | yes      |                                                                               |
| `finishedAt`    | string (date-time) \| null         |          |                                                                               |
| `screenshotUrl` | string \| null                     |          |                                                                               |
| `videoUrl`      | string \| null                     |          |                                                                               |
| `traceUrl`      | string \| null                     |          | Raw evidence: null unless the caller has the editor role and `runs:evidence`. |
| `harUrl`        | string \| null                     |          | Raw evidence, like the trace.                                                 |
| `restricted`    | boolean                            | yes      | Raw evidence was kept for this slice and the caller may not open it.          |
| `rows`          | [AttemptRow](#schema-attemptrow)[] | yes      |                                                                               |

### Webhook {#schema-webhook}

| Field         | Type                       | Required | Description                                           |
| ------------- | -------------------------- | -------- | ----------------------------------------------------- |
| `id`          | integer                    | yes      | at least 1                                            |
| `testPlanId`  | string                     | yes      |                                                       |
| `name`        | string                     | yes      | up to 80 characters                                   |
| `tokenPrefix` | string                     | yes      | The first characters of the token, to tell two apart. |
| `createdAt`   | string (date-time)         |          |                                                       |
| `lastUsedAt`  | string (date-time) \| null |          |                                                       |

### WebhookCreated {#schema-webhookcreated}

| Field         | Type                       | Required | Description                                                                      |
| ------------- | -------------------------- | -------- | -------------------------------------------------------------------------------- |
| `id`          | integer                    | yes      | at least 1                                                                       |
| `testPlanId`  | string                     | yes      |                                                                                  |
| `name`        | string                     | yes      | up to 80 characters                                                              |
| `tokenPrefix` | string                     | yes      | The first characters of the token, to tell two apart.                            |
| `createdAt`   | string (date-time)         |          |                                                                                  |
| `lastUsedAt`  | string (date-time) \| null |          |                                                                                  |
| `token`       | string                     | yes      | Shown here and never again; send it as X-Webhook-Token to /api/webhooks/execute. |

### WebhookInput {#schema-webhookinput}

| Field  | Type   | Required | Description         |
| ------ | ------ | -------- | ------------------- |
| `name` | string | yes      | up to 80 characters |
