# Contribution walkthrough

Use this page with the [suite handbook](./suite-handbook) and [developer guide](./developer-guide).
It explains how to take a small improvement through the existing layers, then how to scale the same
method to a new definition or execution capability. The example below is a design exercise, not an
already implemented feature.

## Start from one observable behavior

Example request: **an editor can add a description to a tag, and colleagues can read it in the tag
picker**. A rename preserves it; a viewer cannot change it; another organization cannot read it.
Descriptions should not change which tests a tag selects or what a queued run executes.

Agree the field's maximum length, whether empty text becomes `null`, where the editor edits it and
whether create-by-name should retain an existing description. The existing `POST /api/tags` is
idempotent by normalized name: it returns `201` for creation and `200` for an existing tag. Preserve
that contract unless the request deliberately changes it. Do not silently overwrite a colleague's
description when an autocomplete creates an already existing tag.

## Trace the existing implementation before editing

| Layer                | Existing file                                                       | What to learn                                                        |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Stored contract      | `shared/schema.ts` (`tags`, `testTags`)                             | Organization ownership, names and link types                         |
| Pure/domain behavior | `server/test-tags.ts`                                               | Name normalization and assignment rules                              |
| Session API          | `server/routes/tags.routes.ts`                                      | Viewer reads, editor writes, zod validation, duplicate/race handling |
| Route assembly       | `server/routes.ts`                                                  | Existing router mounting; extending this router needs no new mount   |
| Reusable UI          | `client/src/components/tags/TagPicker.tsx`                          | Controlled component props; it does not own all API calls            |
| Consumers            | Search for `TagPicker` in `client/src`                              | Actual pages/dialogs passing data and mutations                      |
| Existing tests       | `server/routes/tags.routes.test.ts`, `server/test-tags.test.ts`     | HTTP/tenant fixtures and normalization expectations                  |
| Organization model   | `server/middleware/tenancy.ts`, `server/middleware/require-role.ts` | Data visibility versus permission to act                             |

Use `rg -n "TagPicker|/api/tags" client/src server` to find consumers. Follow a read and a write all
the way through; adding a schema field alone does not make it available to a component, and a new
component prop does not make it persist.

## Implement the example end to end

1. Add a nullable text column to the Drizzle `tags` definition and a hand-written additive SQL
   migration. Choose the next index from `migrations/meta/_journal.json`, add its journal entry and
   use `--> statement-breakpoint` separators. Existing rows must remain valid. A description on an
   existing RLS-protected table does not need a new policy; a new organization-scoped table would.
2. Extend the route's explicit select/response shapes for GET, POST and PUT. Validate length and
   normalization in the request schema. Preserve authentication, `requireRole`, tenant transaction,
   duplicate-name behavior and useful error responses. Keep the old response fields. Decide audit
   requirements explicitly; if adding an audit action, record it with the change in its transaction
   and add all language labels. Do not claim all existing tag routes already record audit entries.
3. Extend the API types of each real consumer and the `TagPicker` props. Show readable descriptions
   without changing selection. Put editing in the existing editor-owned form or dialog, handle busy
   and error states, and invalidate the appropriate TanStack Query keys after saving. Do not invent
   a separate storage cache inside the picker.
4. Add visible labels/errors to `client/src/locales/en`, `it`, `fr` and `de` using the existing
   bundle structure. Hiding edit controls for viewers improves usability; the server must still
   reject a forged write request.
5. Add meaningful route tests for persistence after a second request, existing-tag preservation,
   rejected oversized input, viewer denial and cross-organization invisibility. Add a component
   test for reading/editing behavior at the consumer that owns it. Run a migrated database check;
   include real PostgreSQL isolation when the ownership/query boundary changes.
6. Update [organizing tests](../guide/organizing) in both languages with the exact location and
   behavior. Add a Collaudo case for create → assign → reload → rename → read as viewer and an
   isolation case using a second organization. Record actual results after execution.

For this example, plan snapshots and execution units need no new description field because it
does not affect a verdict. That is a deliberate design decision, not permission to skip the
snapshot check for fields the runner does read.

## When the change affects execution

Follow the complete contract: shared validation → save/version → plan selection/snapshot → run
unit → execution → result/evidence → report/export. A new mobile action belongs in the mobile
contract/editor/runner and its tests, not in the browser action executor. A BDD capability needs
operator profile and agent/runtime contract work. A protocol option belongs in the native protocol
configuration and transport tests, including the remote path where supported.

Check publication behavior, datasets, suites, browser/locale/device matrices, retries, cancellation,
quotas and evidence redaction. `execution-snapshot.test.ts` forces every new plan column to have a
snapshot decision. `execution-state.ts` remains the owner of legal state transitions. An API
extraction chain must keep dependency order after a concurrency change.

If pipelines need the feature, extend `server/routes/api-v1.routes.ts` and
`server/api-v1/openapi.ts` together, with key scope checks and documented error shapes. A new
authenticated `/api/...` route alone is not a public contract. Update CLI/integration templates
only when their users need the new capability.

## Commands and what they prove

The commands below are declared in the root/client package manifests. Choose focused tests first;
the full required checks remain the final integration gate. These instructions do not mean the
commands have passed on your change.

```sh
npm install
npm run db:migrate
npm run dev
# Another terminal, with the same environment:
npm run dev:worker
```

Set up `.env`, secrets, Redis and Playwright using the [developer guide](./developer-guide).
Use `db:migrate`, never `db:push`, for this migration workflow. Do not reset a colleague's shared
database or acceptance volumes to obtain a passing test.

| Command                                                                     | Evidence obtained                                                 |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npx vitest run server/routes/tags.routes.test.ts server/test-tags.test.ts` | Focused example behavior against the configured test database     |
| `npm run test:client -- --run`                                              | Client tests, including locale consistency                        |
| `npm run check`                                                             | TypeScript projects, Collaudo/E2E and BDD runtime types           |
| `npm run lint`                                                              | Repository lint rules                                             |
| `npm test`                                                                  | Root Vitest suite plus separate BDD runtime suite                 |
| `npm run test:rls`                                                          | Real PostgreSQL isolation gate; requires suitable `DATABASE_URL`  |
| `npm run test:collaudo`                                                     | Collaudo application tests, not the complete acceptance catalogue |
| `npm run build`                                                             | Client/server/worker/migrator/CLI/agent and BDD child bundles     |
| `npm run docs:build`                                                        | VitePress generation and link validation                          |
| `npm run test:e2e`                                                          | Dedicated real-installation interface smoke journeys              |

For E2E use the dedicated database/Redis ports and build prerequisites in the developer guide.
For acceptance use [test lab](../admin/test-lab), with relevant providers/agents/devices provisioned.
A build proves packaging; an HTTP fake proves the contract exercised by the test; only a live
provider journey proves that particular deployed integration.

## Make the change reviewable

Before handing it over, describe the trigger and resulting behavior, affected types and permissions,
migration compatibility, tests actually run and live acceptance still pending. Include concrete
failure evidence when a check fails. Keep unrelated local changes intact. Document the operator
procedure if deployment needs an agent update, new secret, backfill or configuration change.

Keep EN/IT page names and links paired. Translate product behavior, not only headings. Check
examples, exports and diagrams when field meanings change. Update an architecture decision when
the change introduces a new boundary or tradeoff; use existing guides for routine user instructions.
