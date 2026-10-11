# Gherkin / Cucumber files

The CLI uses the same import/export workflow with a full-access API key:

```sh
wfm tests export --project 12 --format gherkin --out specs/shop.feature
wfm tests import specs/shop.feature --project 12 --dry-run
wfm tests import specs/shop.feature --project 12
```

Import detects Gherkin from the content; it does not require `--format`. Export uses the server's filename unless `--out` is supplied, with `tests.feature` as the fallback.

In **Tests as files**, choose **Gherkin** to export web tests to a `.feature` file. API tests are excluded; YAML/JSON bundles continue to include both kinds. Import a `.feature` file or select Gherkin before pasting text, preview the changes, then import. Existing names update with a new version; new tests use the selected project. Access follows organization roles and project visibility.

The official Gherkin parser supports every official dialect through `# language:`, `Rule`, Feature/Rule backgrounds, descriptions, tagged Examples, doc strings and escaped DataTables. Every Examples row creates a separate test with its original source-location selector. Structured arguments and inherited tags stay with the steps.

Choose **manual** execution to retain prose and arguments for a tester's verdict, or **Cucumber** with an authorized profile to execute real JavaScript/TypeScript definitions on your organization's dedicated agent. Import does not generate definitions or browser actions. World `this.parameters` contains the run variables. Plans execute once per saved scenario/dataset row, independently of the browser/language matrix. Undefined, ambiguous, pending, skipped and failed steps/hooks never count as passed.

An operator installs Cucumber.js **12.9.0**, support files and dependencies, then starts agent **1.3.0** with `WFM_BDD_PROFILES` pointing to its manifest. Only public profile IDs, labels, revisions and limits are advertised. An organization owner associates an advertised profile and pool with the organization or one project. Executable paths, commands and loaders remain operator configuration. See `deployment/bdd-agent/README.md` for deployment and project layout. Process limits and the provided dedicated container are operational isolation; Node is not a sandbox for hostile support code.

Portable executable imports require an explicit authorized destination binding. For CLI import add `--bdd-mode cucumber --bdd-profile DESTINATION_UUID --bdd-revision SUPPORT_REVISION`; use a binding from `/api/bdd/profiles`, preview with `--dry-run`, then repeat without it. YAML/JSON bundles also retain BDD definitions. Missing/revoked profiles or mismatching revisions fail before support modules load. Published test versions retain their feature source and pinned support revision.

WebFlowMaster exports include `# wfm-test:` metadata preserving original actions/BDD configuration and fields, including datasets, setup and cleanup. Readable steps, structured arguments, tags and Rule context must agree with the metadata. Remove that scenario's metadata before explicitly importing edited prose. Selected BDD exports contain only the chosen scenarios/Examples rows; an Outline with exactly one row preserves otherwise unrepresentable whitespace/multiline arguments. Export one dialect per file. Unruled scenarios precede Rules because Gherkin has no end-Rule marker.

Files are limited to **20 MiB**, **2,000** expanded tests, **100,000** steps and **64 MiB** combined persisted source/argument expansion. Runtime limits are **300 seconds**, **8 MiB** output and **1 MiB** total attachments. Only plain-text attachments are retained; HTML/binary attachments are omitted. Reports escape text and redact credentials/variables. A test without steps cannot export to Gherkin. Inspect literal values before committing files; repository element, group and custom-action references remain installation-specific.
