# Your first run from a pipeline

For DevOps and release engineers. At the end a CI job starts a WebFlowMaster test plan, waits for
it, fails the build when the plan fails and publishes the results in the CI system's test report.
You need a plan that already passes when run by hand ([Your first test in 10 minutes](./qa)) and
an **owner** to create the service account, or the owner role yourself.

## 1. A service account and its key (5 minutes)

A pipeline must not depend on one person's account.

1. **Settings → API keys**, card **Service accounts**: a name after the pipeline ("ci-shop"),
   role **editor** (starting runs needs at least that), **Create account**.
2. In the **API keys** card above: a name, **Issued to** the service account, **What the key may
   do** → _Only what I choose, through /api/v1_ with **Start runs and cancel them** (`runs:write`)
   and **Read runs, their status and their JUnit reports** (`runs:read`); add **List test plans**
   (`plans:read`) if the job looks plans up. Set **Expires in (days)** to what your rotation policy
   accepts, then **Create key**.
3. Copy the key from **Copy this key now**: it is shown **once** and stored only as a hash.

Store it as a secret in your CI system (`WFM_API_KEY`), never in the repository. Store the
server's address as `WFM_URL` and the plan id — on the plan's page, or from
`GET /api/v1/plans` — as `WFM_PLAN_ID`. Details: [API keys and service accounts](../admin/administration#api-keys-and-service-accounts).

## 2. Try it from your machine (3 minutes)

The server hands out a CLI that always matches its version:

```bash
curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs
node wfm.mjs run "$WFM_PLAN_ID" --wait --junit junit.xml
echo $?
```

**The exit code is the contract:** `0` the plan passed, `1` it failed (errored, cancelled and
timed out included), `2` the step itself could not be carried out — wrong address, bad key, server
unreachable. Failures of tests in quarantine do not fail the run. Details: [The CLI](../integrations/ci#_2-the-cli).

## 3. Add it to the pipeline (10 minutes)

GitHub Actions, with the action from the repository:

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: Markg981/WebFlowMaster/integrations/github-action@main
        with:
          url: ${{ vars.WFM_URL }}
          api-key: ${{ secrets.WFM_API_KEY }}
          plan: ${{ vars.WFM_PLAN_ID }}
          idempotency-key: ${{ github.run_id }}-${{ github.run_attempt }}
```

Pin the action to a release tag or a commit instead of `@main` once it works. GitLab CI, Jenkins,
Azure Pipelines, Bitbucket Pipelines and CircleCI have ready-made templates that work the same way:
[Running test plans from CI](../integrations/ci).

The **idempotency key** makes a retried CI step follow the run it already started instead of
starting a second one.

## 4. Check the result (2 minutes)

Push a commit. The job runs the plan and:

- passes or fails with the plan;
- writes `webflowmaster-junit.xml`, which the CI system's test report reads;
- sends the repository, commit, branch and build link with the run, so the WebFlowMaster report
  links back to the build.

## Next

- Only the tests a change affects: `changed-since` and the [impact map](../guide/running#impact).
- A status on the commit or pull request: [Commit status on GitHub and GitLab](../integrations/ci#_10-commit-status-on-github-and-gitlab).
- HTML, PDF or Allure reports as build artifacts: the `html`, `pdf` and `allure` inputs.
- Applications only reachable inside your network: [Local agents](../integrations/local-agents).
- Everything else the API can do: [REST API](../reference/api).
