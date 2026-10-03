# Collaboration Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans with superpowers:dispatching-parallel-agents for the two independent product areas, followed by a whole-branch review.

**Goal:** Deliver threaded comments with mentions/resolution and multiple private or organization-shared configurable dashboards.

**Architecture:** Extend existing comments and preserve legacy layout endpoints. New dashboards use request-scoped data and revision checks; PostgreSQL constraints and RLS enforce boundaries.

**Tech Stack:** TypeScript, React, TanStack Query, Express, Drizzle, PostgreSQL/PGlite, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-collaboration-design.md`.

## Global constraints

- Work on `codex/collaboration-dashboards`, based on merged main.
- Preserve unrelated untracked files and existing Collaudo data.
- Maximum 20 widget instances; periods 1–365 days and result limits 1–50.
- Tenant/project isolation, retained existing comments and legacy dashboard layout endpoints.
- English/Italian interface copy and documentation; no additional intermediate approvals or automatic merge.

## Review focus

- Concurrent edits return 409 instead of overwriting another member's layout.
- Lost project access hides both discussion content and dashboard data.
- Deleted root authors or messages do not discard other members' replies.
- Shared dashboards never expose creator-only data or private dashboard names.
- Mention recipients belong to the target's organization and can read its project.

### Task 1: Conversations (independent worker)

**Files:** `shared/comments.ts`, `server/routes/comments.routes.ts`, their tests, `client/src/components/tests/CommentsPanel.tsx` and tests. No migration or central schema edits.

**Interface:** Additional comment fields `parentId`, `mentionedUserIds`, `resolvedAt`, `resolvedBy`, `deletedAt`. Existing GET/POST/PATCH/DELETE plus target members, replies and resolution operations. Preserve flat GET compatibility.

- [x] Add route/UI regression cases for replies, eligible mentions, resolve/reopen, project/tenant restrictions and tombstones. Run targeted Vitest to observe missing behavior.
- [x] Implement schemas, transactional operations and accessible UI controls. Validate parent/recipient IDs server-side.
- [x] Run targeted tests and report schema/migration requirements to integration owner.

### Task 2: Dashboards (independent worker)

**Files:** `shared/dashboard-layout.ts`, dashboard routes and tests, `server/analytics.ts`, `server/routes/analytics.routes.ts` and tests, dashboard page and components/tests. No migrations or central schema edits.

**Interface:** `dashboards` / `userDashboardPreferences` tables exported from shared dashboard module. New dashboard CRUD/duplicate/default endpoints and filtered per-member widget data. Existing layout endpoints remain functional.

- [x] Add regression tests for multiple dashboards, visibility/edit permissions, revision conflicts, default selection and legacy migration. Observe failures before implementation.
- [x] Implement request-scoped analytics and validated widget instances; configure effective project/period/limit/environment filters.
- [x] Implement accessible dashboard management and widget editor. Preserve legacy endpoint tests and default charts.
- [x] Run route/UI tests and report exact SQL table definitions to integration owner.

### Task 3: Integration, database and real acceptance (root)

**Files:** `migrations/0076_collaboration.sql`, migration journal, `shared/schema.ts`, `server/routes.ts`, `e2e/installation.spec.ts`, EN/IT docs and locale resources.

- [x] Add database regression assertions for cross-target parents and cross-tenant references. Execute against unmodified database to demonstrate rejection is absent.
- [x] Add additive migration with comment lineage/resolve constraints, dashboard RLS, composite ownership references, preference foreign keys and legacy import. Update journal and ORG_SCOPED_TABLES.
- [x] Mount new routes and integrate schemas/copy without changing worker-owned files concurrently.
- [x] Add real browser journeys for comments and dashboards; test against rebuilt production installation.
- [x] Run `npm run check`, lint, targeted/full server/client tests, `npm run build`, `npm run docs:build`, `npm run test:collaudo`, and real PostgreSQL isolation.
- [ ] Review full branch, fix findings, commit scoped changes, push and create/attach PR. Report actual validation and CI status.

## Execution record

2026-10-04: user approved proposed design and completion through PR without intermediate approvals. Root owns SQL/integration/acceptance; separate workers own comments and dashboards. Product tests use per-file databases; avoid concurrent external service changes.

Ruling: administrators map to the existing owner role; unknown roles stay forbidden. Existing RLS base suites run before collaboration suites in separate processes because an existing tenancy test deletes all users; collaboration fixtures must not precede it.

Local validation complete: client459, PostgreSQL41+48, productionUI5, migration/architecture/member lifecycle targeted passes, builds and lint. Full CI pending PR. Final scoped code review has no remaining findings. Evidence: collaudo/collaborazione-2026-10-04.md.
