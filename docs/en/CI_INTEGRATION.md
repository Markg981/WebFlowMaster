# Running test plans from CI

A pipeline starts a WebFlowMaster test plan, waits for the verdict, fails the build when the plan
fails, and publishes the results in the CI system's own test report. Ready-made integrations are
in [`integrations/`](../../integrations): a GitHub Action, a GitLab CI template, a Jenkins shared
library step and an Azure Pipelines template. Each one is a thin wrapper around the `wfm` CLI, and
anything else that runs Node 18 or later can use the CLI directly.

## 1. What you need

- **The server's address**, e.g. `https://webflowmaster.example.com`. Set `APP_BASE_URL` on the
  server as well, so runs carry a link to their report.
- **An API key** with the scopes `runs:write` and `runs:read` (Settings → API keys). A key acts
  for whoever created it, and never beyond that person's role. For a pipeline, create it on a
  **service account** (Settings → Service accounts) so it keeps working when people leave.
- **The plan id**, from the plan's page or `GET /api/v1/plans`.

Store the key as a secret in your CI system. Never commit it.

## 2. The CLI

The server hands out its own build of the CLI, so the CLI always matches the server:

```bash
curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs
node wfm.mjs run <planId> --wait --junit junit.xml --html report.html
```

| Command | What it does |
| --- | --- |
| `wfm run <planId>` | Starts a run. With `--wait` (implied by any report option) it waits and exits with the verdict. |
| `wfm status <runId>` | Prints a run's state. |
| `wfm junit <runId> --junit <file>` | Writes a finished run's JUnit XML. |
| `wfm export <runId> --html/--pdf/--allure <file>` | Writes a finished run's reports. |

Options: `--url` / `$WFM_URL`, `--key` / `$WFM_API_KEY`, `--environment <id>`, `--timeout <seconds>`
(default 1800), `--junit`, `--html`, `--pdf`, `--allure <file>`, `--update-baselines`,
`--idempotency-key <key>` / `$WFM_IDEMPOTENCY_KEY`, `--no-ci`, `--json`.

**The exit code is the interface:** `0` the run passed, `1` the run failed (including errored,
cancelled and timed out), `2` the step could not be carried out (no key, wrong URL, server
unreachable, timed out waiting). Failures of tests in quarantine do not make a run fail.

**Where the run came from.** Inside GitHub Actions, GitLab CI, Jenkins, Azure Pipelines, Bitbucket
Pipelines or CircleCI, the CLI reads the repository, commit, branch, pull request and build link
from the job's environment and sends them with the run. The report, the notification, the HTML
export and the Allure results then show and link that build. `--no-ci` turns this off. A value
the server would refuse is dropped rather than sent, so the context can never stop a run from
starting.

**Idempotency.** Pass the build's id as `--idempotency-key` and a retried step follows the run it
already started instead of starting a second one.

## 3. GitHub Actions

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: Markg981/WebFlowMaster/integrations/github-action@main
        id: wfm
        with:
          url: ${{ vars.WFM_URL }}
          api-key: ${{ secrets.WFM_API_KEY }}
          plan: ${{ vars.WFM_PLAN_ID }}
          html: webflowmaster-report.html
      - uses: mikepenz/action-junit-report@v4
        if: always()
        with:
          report_paths: webflowmaster-junit.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: webflowmaster-report
          path: webflowmaster-report.html
```

The step fails when the plan fails. It writes the run to the job's summary page, annotates a
failure on the run, and sets the outputs `run-id`, `status` and `report-url`, for example to comment
on a pull request. Its inputs are `url`, `api-key`, `plan`, `environment`, `wait`, `timeout`,
`junit` (default `webflowmaster-junit.xml`), `html`, `pdf`, `allure`, `update-baselines` and
`idempotency-key`.

## 4. GitLab CI

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/Markg981/WebFlowMaster/main/integrations/gitlab/webflowmaster.gitlab-ci.yml'

e2e:
  extends: .webflowmaster
  stage: test
  variables:
    WFM_PLAN_ID: "your-plan-id"
```

Set `WFM_URL` and `WFM_API_KEY` (masked, protected) under Settings → CI/CD → Variables. The
JUnit results appear on the pipeline's Tests tab and on the merge request. The HTML report is kept
as an artifact.

## 5. Jenkins

1. Register this repository as a Global Pipeline Library (Manage Jenkins → System → Global
   Pipeline Libraries): name `webflowmaster`, Library Path `integrations/jenkins`.
2. Add a Secret text credential with the key, id `webflowmaster-api-key`.
3. In the pipeline (the agent needs Node 18 or later, e.g. `docker { image 'node:20' }`):

```groovy
@Library('webflowmaster') _
// …
steps {
  webflowmaster plan: 'your-plan-id', url: 'https://webflowmaster.example.com'
}
```

The JUnit results are published with the `junit` step and the HTML report is archived. By default
a failed plan fails the build; `onFailure: 'unstable'` marks the build unstable instead. Other
parameters are `environment`, `timeout`, `credentialsId`, `junit` and `html`. See
[`Jenkinsfile.example`](../../integrations/jenkins/Jenkinsfile.example).

## 6. Azure Pipelines

```yaml
resources:
  repositories:
    - repository: webflowmaster
      type: github
      name: Markg981/WebFlowMaster
      endpoint: your-github-service-connection

steps:
  - template: integrations/azure-pipelines/webflowmaster.yml@webflowmaster
    parameters:
      plan: your-plan-id
```

Define `WFM_URL` and a secret `WFM_API_KEY` in the pipeline's variables or a variable group. The
results are published to the run's Tests tab and the HTML report is kept as a pipeline artifact.

## 7. Anything else

Any system that can run Node 18 can run the two lines in section 2. Without Node, the API behind
the CLI is documented at `GET /api/v1/openapi.json`: `POST /api/v1/plans/{planId}/runs`, poll
`GET /api/v1/runs/{runId}` until `status` is no longer `queued`, `running` or `cancelling`, then
`GET /api/v1/runs/{runId}/junit` and `/export/{html|pdf|allure}`.
