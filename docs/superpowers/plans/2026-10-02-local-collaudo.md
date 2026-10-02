# Local collaudo

User request: `npm run dev:collaudo`, separate from documentation, visually identical to the Claude artifact, independent of Claude. Preserve original case IDs and historical outcomes.

- [x] Capture the rendered original catalogue and current cycle. Transfer through the local import UI; do not inspect private browser storage or Claude internals.
- [x] Implement a loopback-only Node server, versioned catalogue and ignored local state, atomic persistence, optimistic concurrency and validated merge/import.
- [x] Reuse original CSS and presentation, filtering, area index, progress, expandable cases, outcome buttons and notes. Add local backup import/export.
- [x] Add the 46 new cases without duplicating SSO-15. New cases remain pending.
- [x] Verify persistence/restart, conflicts, imports, invalid input and browser interaction; document the command and backups.

Only the current original cycle is visible. Do not claim recovery of other inaccessible cycles. Test outcomes are local data, not checked into Git. No runtime dependencies on Claude, PostgreSQL, Redis, Docker or external fonts.

Verification: 8 native Node tests passed; VitePress build passed. Browser checks confirmed new-cycle creation, automatic notes, outcomes surviving reload, search and status filtering. JSON backup download verified. 404 cases in 20 areas; all 299 historical outcomes retained; 46 additions remain pending. UI checks used an isolated local state directory and did not modify the imported cycle.
