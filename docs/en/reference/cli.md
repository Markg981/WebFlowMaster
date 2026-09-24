# wfm command line

`wfm` runs test plans from a pipeline: it starts a run, waits for it, writes its reports, and
exits with a code the pipeline acts on. It talks only to the [REST API](./api), so a key with the
scopes `runs:write` and `runs:read` is enough. The recipes for each CI system are in
[CI integration](../CI_INTEGRATION).

## Getting it

Every installation serves its own build of the CLI, which always matches the server. It needs
Node.js 18 or later and nothing else:

```bash
curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs
node wfm.mjs run 12 --wait --junit junit.xml
```

## Commands

| Command | What it does |
|---|---|
| `wfm run PLAN_ID` | Starts a run of the plan. Without `--wait` or a report option, prints the run and exits. |
| `wfm status RUN_ID` | Prints a run's state. |
| `wfm junit RUN_ID --junit FILE` | Writes a finished run's JUnit XML. |
| `wfm export RUN_ID --html FILE` | Writes a finished run's reports (`--html`, `--pdf`, `--allure`). |
| `wfm help` | Prints the usage. |

## Options

| Option | Default | Meaning |
|---|---|---|
| `--url URL` | `$WFM_URL` | The server's address. |
| `--key KEY` | `$WFM_API_KEY` | The API key. |
| `--wait` | off | Wait for the run to finish and exit with its verdict. Implied by any report option. |
| `--timeout SECONDS` | 1800 | How long to wait before giving up. |
| `--poll SECONDS` | 5 | How often to ask whether the run has finished. |
| `--junit FILE` | — | Write the run's JUnit XML once it has finished. |
| `--html FILE` | — | Write the self-contained HTML report. |
| `--pdf FILE` | — | Write the PDF report. |
| `--allure FILE` | — | Write a zip of Allure results. |
| `--environment ID` | — | Run against this environment. |
| `--update-baselines` | off | Accept this run's screenshots as the new visual baselines. |
| `--idempotency-key KEY` | `$WFM_IDEMPOTENCY_KEY` | Start at most one run for this key: pass the build id, and a retried step follows the run it already started. |
| `--no-ci` | — | Do not send the build, commit and branch read from the CI system. |
| `--json` | off | Print the final run as JSON, as the API returns it. |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The run passed. Failures of tests in quarantine do not count. |
| `1` | The run finished and did not pass: failed, error, cancelled or timed out. |
| `2` | The command could not be carried out: bad usage, no key, the server unreachable or refusing, or the wait timed out. |

A pipeline step that runs `wfm run … --wait` therefore fails exactly when it should.

## What it reads from the CI system

Unless `--no-ci`, the CLI recognizes the CI system from its environment and sends the build with
the run, so the report, the notifications and the exports show and link it:

| CI system | Recognized by | Sends |
|---|---|---|
| GitHub Actions | `GITHUB_ACTIONS=true` | repository, commit, branch, pull request, run id and link, actor |
| GitLab CI | `GITLAB_CI` | project path, commit, branch, merge request, pipeline id and link, user |
| Azure Pipelines | `TF_BUILD=true` | repository, commit, branch, pull request, build number and link, requester |
| Bitbucket Pipelines | `BITBUCKET_BUILD_NUMBER` | repository, commit, branch, pull request, build number and link |
| CircleCI | `CIRCLECI=true` | repository, commit, branch, pull request, build number and link, user |
| Jenkins | `JENKINS_URL` | repository (credentials stripped), commit, branch, change id, job and build, user |

A value the server would refuse is dropped rather than sent, so this can never stop a run from
starting.

On GitHub Actions it also sets the step outputs `run-id`, `status` and `report-url`, and writes a
summary of the run to the job's page.
