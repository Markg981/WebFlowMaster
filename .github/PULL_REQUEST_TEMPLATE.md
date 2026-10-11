## What changes

<!-- The behaviour, file or page that changes, in a few lines. -->

## Why

<!-- The problem, issue or request this answers. -->

## Checks run

<!-- Tick what you ran locally; CI runs all of them (see README → Checks). -->

- [ ] `npm run check`, `npm run lint`, `npm run format:check`, `npm run any-budget`
- [ ] `npm test` and `npm run test:client -- --run`
- [ ] `npm run test:release`, `npm run test:security`, `npm run test:collaudo`
- [ ] `npm run test:e2e`
- [ ] `npm run docs:build`

## Documentation updated

- [ ] English (`docs/en/…`)
- [ ] Italian (`docs/it/…`)
- [ ] Not needed: the change is not visible to users or operators

## Migration included if the schema changed

- [ ] `shared/schema.ts` did not change
- [ ] `shared/schema.ts` changed and `migrations/` has the migration, recorded in the journal
