# BDD tests with Gherkin and Cucumber

Gherkin is a readable description of behavior. WebFlowMaster stores its source and scenario
selection alongside a test, with two execution modes: **manual**, for a person to record outcomes,
and **Cucumber**, for executing an operator-provisioned support project on a local agent.
Importing a `.feature` file does not automatically implement its steps.

## Choose the mode before importing

Use manual mode when the scenario describes a human acceptance procedure or step definitions are
not yet implemented. Use Cucumber when the team already owns runnable step definitions and a
platform operator can install their locked dependencies on an agent.

BDD definitions use the UI test/version library internally. Their identity includes source,
dialect, logical `.feature` filename, scenario line and, for an Outline, the selected Examples row.
Backgrounds, Rules, tags, DocStrings and DataTables are parsed as Gherkin rather than flattened
into browser selectors. Keep source and selection consistent when editing.

## Prepare Cucumber execution

1. The operator provisions an authorized local agent with a support project and a
   `WFM_BDD_PROFILES` manifest. Install the BDD child bundle alongside the agent. The maintained
   JS/TS examples and isolated container live in `deployment/bdd-agent/`.
2. The agent advertises a pool, operator profile ID and exact revision. A revision identifies the
   installed support implementation; changing a filename in the feature does not install code.
3. An owner opens **Settings → Agents** and creates a **Cucumber execution profile** from an
   advertised target. Choose organization-wide or project-specific access and timeout. Profile
   timeouts are validated between 1 and 300 seconds. The pool and operator profile identity are
   immutable on update; create a new binding to change that target.
4. The editor selects an authorized profile and its revision when importing or editing the BDD test.
   Publish through the normal review/version workflow if the plan uses published tests.

See [local agent setup](../LOCAL_AGENT). Provisioning customer step code is an operator task;
feature import transfers source, not an arbitrary support executable.

## Import, edit and share

In **Test Library → Files**, choose Gherkin input and inspect the preview before importing.
An Outline can produce several selected scenario/example definitions. Review project, mode and
binding rather than assuming a binding from another installation remains authorized here.
The importer requires a destination binding for Cucumber execution.

For a saved BDD test, **Edit Gherkin** opens the source editor. Change source and scenario/example
line together; saving reparses the source and regenerates its steps. Choose manual or Cucumber
mode there. BDD steps are source-controlled within the definition: the ordinary step editor cannot
change them independently. Conversion to ordinary manual steps is a separate deliberate action;
save source edits first if that conversion is required.

The CLI can import Gherkin with an explicit Cucumber destination:

```sh
npm run cli -- tests import scenarios.feature --dry-run --bdd-mode cucumber --bdd-profile DESTINATION_UUID --bdd-revision SUPPORT_REVISION
```

Inspect the dry-run before removing `--dry-run`. See [CLI reference](../reference/cli) and
[tests as files](./organizing). Gherkin export is for UI/BDD tests, not API/mobile definitions;
export one dialect at a time. Source-preserving WebFlowMaster metadata and destination binding
are different contracts: metadata does not authorize the source installation's execution target.

## Run and interpret the report

Add the test to a plan or suite as usual. Cucumber units run independently of the plan's browser
matrix; dataset rows can produce separate units. The worker resolves the authorized exact binding,
runs preconditions through the agent, invokes Cucumber, and attempts cleanup afterward. A failed
precondition can block or skip execution according to plan policy. Cleanup is still reported.

The report carries Cucumber step and hook statuses, duration, errors and bounded text attachments.
Undefined, pending or failed steps do not establish a passing scenario. Manual mode instead
requires human result entry. Neither mode promises browser video or trace for arbitrary support
code; choose the evidence mechanism your support project and platform contract actually provide.

Secrets are redacted from normalized evidence and output is bounded. Source imports are limited
to 20 MiB, with further test/step/persisted-output budgets. Oversized execution evidence can yield
an error with discarded evidence rather than an unbounded report.

## Troubleshooting

| Symptom                                      | Check                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| No profile available                         | Agent is connected, manifest is valid, pool and organization credentials are correct |
| Binding rejected                             | Destination project/organization allows it and exact profile revision still matches  |
| Scenario not found                           | Scenario line and Examples row match the edited source and dialect                   |
| Undefined steps                              | Operator installed the intended support project and dependencies for that revision   |
| Run fails before Cucumber                    | Preconditions, agent slot availability, connectivity and timeout                     |
| Updated profile but old published test fails | Rebind the definition to the new revision and republish                              |

For implementation boundaries read the [suite handbook](../internals/suite-handbook). Record
the profile/revision, agent environment and actual report when accepting an integration.
