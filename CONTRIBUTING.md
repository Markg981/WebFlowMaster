# Contributing

The walkthrough for taking a change through the code base is in the documentation:
[contribution walkthrough](./docs/en/internals/contributing-guide.md) (in Italian:
[guida al contributo](./docs/it/internals/contributing-guide.md)), with the
[developer guide](./docs/en/internals/developer-guide.md) and the
[suite handbook](./docs/en/internals/suite-handbook.md) it builds on.

## Branches and pull requests

Work on a branch and open a pull request against `main`. The pull request template asks what
changes, why, which checks ran, and whether the documentation and the migrations that the change
needs are included. CI runs on every push to `main`, on every pull request, and nightly.

## Checks

Before opening the pull request, run the checks that CI runs (see
[Checks](./README.md#checks) in the README for what each needs):

```bash
npm run check
npm run lint
npm run format:check
npm run any-budget
npm test
npm run test:client -- --run
npm run test:release
npm run test:security
npm run test:collaudo
npm run test:e2e
npm run docs:build
```

## Rules a change has to follow

- A change to the database schema (`shared/schema.ts`) comes with a migration in `migrations/`,
  recorded in the migration journal: `db:migrate` must still run afterwards
  (the note under [Local development](./README.md#local-development) in the README).
- A change people can see comes with the documentation that describes it. The documentation is
  bilingual: every page under `docs/en` has a counterpart under `docs/it`, and both receive the
  change.
- `npm run format` fixes what `format:check` reports; the explicit `any` budget per area may only
  go down.
