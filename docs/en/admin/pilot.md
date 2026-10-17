# Pilot and adoption decision

A qualified release ([Reproducible releases](./releases.md)) shows that the build installs, upgrades and
gives one verdict per run. It does not show that a team can adopt WebFlowMaster. The pilot answers that
question with measurements from a real team, and the adoption decision is recorded separately from the
build's technical approval.

## Before the pilot

With the product owner, choose:

- **one team or customer**, and how many users it really has. Do not assume teams or users that have not
  been confirmed;
- **representative flows** (one to three): the flows the team runs on every release, with the reason
  each one is representative (forms, datasets, shadow DOM, files, CI);
- **an operator who did not write the product**. They run every task. Whoever wrote WFM only observes and
  writes the log;
- **the observation window**: two weeks unless agreed otherwise;
- **the baseline**: the same flows measured with the tool the team uses today. Use the team's own figures,
  measured on those flows and dated. Vendor percentages or figures from other projects are not accepted.

Write this down in the pilot file. [scripts/fixtures/pilot/pilot.json](https://github.com/Markg981/WebFlowMaster/blob/main/scripts/fixtures/pilot/pilot.json) is a
template.

During the pilot, add no new functional scope. Fixes for incidents found by the pilot are the only
exception.

## What the operator does

| Task          | Start and end in the log               | What it measures                      |
| ------------- | -------------------------------------- | ------------------------------------- |
| `install`     | `install_start`, `install_end`         | installation from the published guide |
| `first_test`  | `first_test_start`, `first_test_end`   | recording the first test              |
| `parametrize` | `parametrize_start`, `parametrize_end` | variables, dataset, environment       |
| `ci_run`      | `ci_run_start`, `ci_run_end`           | the plan started from the team's CI   |
| `diagnosis`   | `diagnosis_start`, `diagnosis_end`     | finding the cause of a real failure   |

The observer also records `first_green` (the first passed run of the flow), `recorder_correction` (each
step fixed by hand after recording, with `count`), `locator_fix` (each locator repaired or healing proposal
approved) and `note`. [observations.json](https://github.com/Markg981/WebFlowMaster/blob/main/scripts/fixtures/pilot/observations.json) is a template.

## Measures and comparison

The report takes the time to first green, recorder corrections, diagnosis time and locator fixes from the
log. It takes retries (extra attempts of each unit and of the run) and run minutes from the runs of the
pilot's plans in the window. Each measure is compared with the baseline of the same flow (better, worse,
same). A measure that nobody observed is shown as missing and treated as unknown, never as zero. Corrections and locator fixes are counted events: when none is logged, the count is zero.

## Incidents reopen an ID

Each of these, even once, goes into the log as an `incident` with the audit ID it reopens and what happened:

| `incident`      | When                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `false_green`   | a run reported passed with a failed or missing step, result or check |
| `lost_evidence` | a promised result, screenshot, video, trace or log cannot be reached |
| `authorization` | someone read or changed what their role or key scope does not allow  |
| `blocker`       | the operator could not continue without help from whoever wrote WFM  |

For example, a false green reopens C02, lost evidence reopens C07 or C02, and an authorization incident
reopens C03. An incident is not statistical noise. It stays `reopened`, and blocks the gate, until
`closedBy` names the change that fixes it, with that lot's negative test.

## Report and gate

```bash
# Runs read from the pilot installation through /api/v1 (key with runs:read, only in the environment)
WFM_PILOT_URL=https://wfm.example WFM_PILOT_API_KEY=... \
  npm run pilot -- report --pilot pilot.json --log observations.json
# Or from an export of the same records
npm run pilot -- report --pilot pilot.json --log observations.json --runs runs.json
```

The report goes to `.local/pilot/<id>/report.md` and `report.json`. Exit code `0` means
`ready_for_decision`. Exit code `1` means `incomplete` (a task, the first green, a run or a comparison is
missing) or `blocked` (an incident is still open). Exit code `2` means the pilot file or the log is not
usable. Neither file is accepted when the operator wrote the product or a baseline is not `measured`.

## Adoption decision

The owner decides on a report that is `ready_for_decision`. The decision states:

- `decision`: `adopt`, `adopt_limited` (with `limits`), `extend_pilot` or `reject`;
- `target`: the commercial target the data supports, and `matrix.supported`, the browsers, surfaces and
  installations to support;
- `evidence`: the measures and register entries the decision rests on;
- `support`: who supports the team, for how many hours a week, and through which channel;
- `buildApproval`: the release qualified in P18. It is cited, but it is not the decision;
- `featureFreezeUntilGate: true`.

```bash
npm run pilot -- decide --report .local/pilot/<id>/report.json --decision decision.json
```

A decision on a report that is not ready, or one without support capacity or evidence, is refused (exit
code `1`). [decision.json](https://github.com/Markg981/WebFlowMaster/blob/main/scripts/fixtures/pilot/decision.json) is a template. Its values are examples, not
pilot results.
