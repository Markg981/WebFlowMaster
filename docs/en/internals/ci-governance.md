# CI governance

How the CI checks gate a merge to `main`, and what the maintainer has to configure on GitHub. The
repository cannot set this itself: the branch ruleset lives in the GitHub settings.

## The gate job

A required check that is skipped counts as passing. Several jobs are skipped on purpose when a pull
request touches only `docs/`, `marketing/` or `.md` files (the `changes` job), so requiring them
one by one lets a skipped job through, and requiring only some jobs leaves `build`, `secret-scan`,
`large-files` and `dependency-audit` outside the gate.

The `ci-gate` job in `.github/workflows/ci.yml` solves both. It always runs, `needs` every other
job, and fails when:

- any job failed or was cancelled;
- any job was skipped, unless the pull request is docs-only and the skipped job is one of the
  installation jobs gated by `changes` (resilience tool, helm-prometheus, restore drill, network,
  UI on a real installation, RLS on real Postgres).

When you add a job to `ci.yml`, add it to the `needs` list of `ci-gate`.

## Recommended ruleset

Ruleset "Protect Main" (id 24315754):

- required status check: `ci-gate` only (it covers the five checks required today and the four that
  are not: `build`, `secret-scan`, `large-files`, `dependency-audit`);
- `strict_required_status_checks_policy`: `true`, so a branch must be up to date with `main`
  before it merges (or use a merge queue);
- approvals are optional: while there is a single maintainer who merges their own pull requests,
  keep the required review count at 0. Once a second reviewer exists, require a CODEOWNERS review
  or 1 approval.

## Applying it

The change below is left to the maintainer. First read the current ruleset and keep the other
rules as they are:

```bash
gh api repos/<owner>/<repo>/rulesets/24315754 > ruleset.json
```

Then replace the `required_status_checks` rule, and set the review count on the `pull_request` rule,
as follows (edit `ruleset.json`, keep the other rules) and send it back:

```json
{
  "type": "required_status_checks",
  "parameters": {
    "strict_required_status_checks_policy": true,
    "required_status_checks": [{ "context": "ci-gate" }]
  }
}
```

In the `pull_request` rule, keep `"required_approving_review_count": 0`; to raise it later, set it to
`1` and send the file back with the same command.

```bash
gh api -X PUT repos/<owner>/<repo>/rulesets/24315754 --input ruleset.json
```

Merge the pull request that introduces `ci-gate` first, so the check exists before it becomes
required; otherwise every pull request waits for a check that never reports.
