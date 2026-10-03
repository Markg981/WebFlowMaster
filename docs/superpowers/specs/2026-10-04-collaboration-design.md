# Collaboration and configurable dashboards

Approved in chat on 2026-10-04, including delivery through a pull request without further intermediate approvals.

## Outcome

Teams can discuss UI, API, mobile tests and report results through replies, explicit user mentions and resolved conversations. Members can maintain several private dashboards or publish dashboards for their organization. Existing comments and personal dashboard preferences are retained.

## Conversations

Keep `comments` as the source of truth. Add nullable `parentId`, `resolvedAt`, `resolvedBy`, `deletedAt` and a non-null `mentionedUserIds` integer array represented as JSON. A reply points directly to a root comment; replies share its organization and exactly the same target. Reject nested replies and cross-target or cross-organization parents at the database boundary. Only roots can be resolved. Root authors and organization owners can resolve or reopen; individual comments remain editable/deletable by their author or an owner. Replies are permitted on open conversations only. Deleting a root with replies keeps a tombstone so other authors' messages survive.

Mention selection uses real organization member IDs, never a client-supplied author. Only members who can read the target are mentionable. Display mentions using usernames and filter conversations by all/open/resolved/mentioning the current member. Editing a message updates its mention selection atomically. Deleted bodies and mentions are not exposed. Preserve existing flat GET responses with additional fields so older callers still work. All mutations remain tenant-scoped and project visibility applies to every operation.

## Dashboards

Keep the legacy personal-layout endpoints. Add `dashboards` with organization, creator, name, visibility (`private` or `organization`), ordered JSON widget instances, revision and timestamps. Add `user_dashboard_preferences` for each member's selected/default dashboard. Migrate saved legacy layouts into a private dashboard without losing widget order or visibility. A member without a saved layout receives the existing five-widget layout as a private initial dashboard, created idempotently.

Provide list/create/read/update/delete/duplicate and personal default selection. Creators can manage their dashboards; organization owners can manage organization-shared dashboards but cannot inspect others' private dashboards. Other members can read shared dashboards and duplicate them into private copies. Publishing does not elevate access to underlying project data. Require the expected revision for updates and reject stale updates with HTTP 409. Deletion clears dependent preferences.

Widget instances have a stable unique string ID, one of the existing five widget types, visibility, optional title, half/full width and a validated configuration. Allow multiple instances of a type. Configuration covers applicable project, period (1–365 days), result limit (1–50) and schedule environment. Bound the widget count to 20; reject unknown properties, invalid enums and foreign/restricted project filters. Use request-scoped RLS aggregation, not privileged owner snapshots. Shared readers with no access to a configured project receive an explicit unavailable widget, without project names or counts. Query keys include organization, member and filter configuration.

## Interface and compatibility

Extend the existing CommentsPanel with reply composition, member mention selection and resolve/reopen controls. Extend the current dashboard page with selection and create/rename/duplicate/share/delete/default actions and an accessible widget editor. Preserve existing default chart/card presentation, responsive containment and legacy endpoints. English and Italian copy and user documentation describe permissions and migration.

## Verification

Test routes and database constraints for tenant boundaries, private dashboard access, project visibility, mention eligibility, reply lineage, resolution, deletion tombstones, revision conflicts and preference migration. Test the actual UI composition and editor interactions. Add end-to-end journeys on the real production installation for persisted replies/resolution and multiple shared/configured dashboards. Run typecheck, lint, server/client tests, application/docs builds, Collaudo checks and real PostgreSQL isolation before reporting delivery. Never merge the PR automatically.
