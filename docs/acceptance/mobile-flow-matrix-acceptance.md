# Mobile flow, matrix and catalog acceptance

Branch: `codex/mobile-flow-matrix-catalog`; migration: `0082_mobile_flow_matrix_groups`.
New cases: MOB-33–MOB-40 in `collaudo/casi.json`.

| Case | Scenario | Expected |
|---|---|---|
| MOB-33 | Native if/else with visible/absent banner | Selected branch executes; other branch skipped; transport errors fail. |
| MOB-34 | Fixed/nested loops and endless repeatWhile | Indexed results; outer index restored; 200-iteration/10,000-visit guards fail explicitly. |
| MOB-35 | Shared login group edited after run admission | Subsequent run sees new group; queued run retains frozen content. |
| MOB-36 | Group in restricted project, open group used by hidden test | Viewer cannot write; outsider cannot see; deletion blocked without revealing hidden test names. |
| MOB-37 | Two-target standalone matrix, first target fails | Independent result/session per target; second target still executes. |
| MOB-38 | Two native targets in two-browser/two-language plan | Exactly two native rows, unique screenshots and independent retries; web still has four rows. |
| MOB-39 | YAML/JSON native export, preview and destination import | Portable groups remapped; preview writes nothing; second import unchanged; configure destination grid/app. |
| MOB-40 | Invalid native catalog dependencies/duplicates | Explicit invalid outcomes; no native test saved against an invalid dependency. |

## Evidence boundaries

Unit/integration tests use the stand-in Appium hub and mocked plan runner. These
prove flow requests, cleanup, frozen snapshots, matrix orchestration and catalog
behavior; they do not constitute a real-device acceptance run.

PostgreSQL isolation is checked separately with a non-superuser migration/login
role and tenant queries running as `app_user`. Its fixture is disposable and does
not alter Collaudo volumes. Record final verification counts in the PR.

The existing Collaudo stack had agents/display only during this implementation;
no real Appium device session was available. MOB-33–MOB-40 remain acceptance cases
to execute after deploying this branch and connecting the native device grid.
