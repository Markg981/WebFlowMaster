# Data protection

What personal data WebFlowMaster holds, where, for how long, and how an organization gets it
back or has it removed. It supports a data protection assessment (for example under the GDPR);
it is a description of the product, not legal advice, and the legal roles depend on how the
installation is operated and contracted.

## Two kinds of data

**Account data** is about the people who use the product: their usernames, roles, sign-ins and
actions. The product needs it to work.

**Test data** is what organizations put into their tests and what their runs capture: addresses,
test accounts, values typed into forms, and screenshots, videos and traces of the applications
under test. The product does not choose it and cannot know whether it contains personal data. An
organization testing against production-like data should assume it does.

## Data inventory

| Data                      | Examples                                                                                                     | Where it is kept                               | How long                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------ |
| Accounts                  | Username (may be an e-mail address), role, creation date                                                     | Database                                       | Until the member is removed or the organization is erased          |
| Single sign-on identities | The provider's issuer and its identifier for the person (not their e-mail address), first and last sign-in   | Database                                       | Until the account is removed                                       |
| Credentials               | Password hash (scrypt), second-factor secret (encrypted), recovery codes (hashed)                            | Database                                       | As accounts                                                        |
| Sessions                  | Session id, user id                                                                                          | Redis                                          | 7 days, or until sign-out                                          |
| Audit trail               | Actor's name, action, target, client IP address, key used, time                                              | Database                                       | Until the organization is erased; not deletable by the application |
| Application logs          | User ids, request paths, correlation ids, errors                                                             | Log files, standard output, Loki if configured | 7 days by default (configurable)                                   |
| Tests and plans           | Steps, addresses, element descriptions, schedules, notification addresses, comments on reviews               | Database                                       | Until deleted, or the organization is erased                       |
| Stored secrets            | Test account passwords, tokens                                                                               | Database, encrypted                            | Until deleted                                                      |
| Run results               | Verdicts, step outcomes, error messages, who started the run, CI context (repository, commit, branch, build) | Database                                       | Until the organization is erased                                   |
| Run evidence              | Screenshots, videos, Playwright traces, network captures without bodies ([raw evidence](#raw-evidence))      | Artifact store (disk or S3)                    | `ARTIFACT_RETENTION_DAYS`, 90 days by default                      |
| Visual baselines          | Reference screenshots                                                                                        | Artifact store                                 | Until replaced or removed                                          |
| Password reset links      | Whose, who issued it, a hash of the token                                                                    | Database                                       | One day, or until used; not included in exports                    |
| Invitations               | Invited username, role, who invited                                                                          | Database                                       | Until revoked; the invitation token expires after 7 days           |
| Uploaded spreadsheets     | Imported test cases                                                                                          | Local disk while being read                    | Deleted once parsed                                                |

Backups made by the operator hold copies of the database and of the artifact store for as long
as the operator keeps them.

## Who can see what

- Everything an organization holds is visible only to its own members, according to their roles
  and, for restricted projects, their project membership. The database enforces this.
- The audit trail is visible to the organization's owners only.
- Traces, HAR files and unrecognised run files are for editors and owners only
  ([Raw evidence](#raw-evidence)).
- The operator of the installation has technical access to the database, the logs and the
  artifact store, like any hosting provider. Stored secrets are encrypted with a key the
  operator also holds.

## How stored secrets are encrypted {#how-stored-secrets-are-encrypted}

Stored secrets — environment secrets, saved login states, browser grid keys, the tokens of issue
trackers, source hosts and test management tools, SMTP passwords, single sign-on client secrets
and signing keys, second-factor secrets — are encrypted with AES-256-GCM before they reach the
database and never returned by the API.

The keys form an envelope. Each organization has a data key of its own, generated the first time
it stores a secret; its secrets are encrypted with that key, and each value is bound to its
organization and key version, so a value copied into another organization's rows does not
decrypt there. The data keys are stored in the database too, wrapped by one master key that
`ENCRYPTION_KEY` derives and that lives only in the installation's environment. Values stored
before this scheme (migration 0084) are encrypted directly with the master key and still
decrypt; `npm run key:rotate` moves them to the organization keys.

What this does and does not give:

- The database alone — a dump, a backup, a copy — reveals no secret: the data keys in it are
  wrapped.
- The master key still protects everything. Whoever holds it together with the database can
  unwrap every organization's key, as before; there is no key an organization has that the
  operator does not. The gain is isolation of key material and cheap rotation, not a secret kept
  from the operator.
- Rotating an organization's key (`npm run key:rotate -- --organization <id>`) re-encrypts that
  organization's secrets only; rotating the master key re-wraps the data keys and leaves the
  secrets as they are. See [Rotating the encryption key](../admin/operations#rotating-the-encryption-key).

## Third parties

The product itself sends data to third parties only where an organization or the operator
configures it:

| Recipient                       | When                                                                                                                                        | What                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google (Gemini API)             | Only if the operator sets `GEMINI_API_KEY` and an owner enables AI for the organization (off by default, `PUT /api/organization/ai-policy`) | Sentences describing tests; the text of a story tests are proposed from; on a failing step, the error and up to 30,000 characters of the page's HTML; for a failure analysis asked for from a report, the failed test's steps, errors, requests and screenshot. See [AI features](./#ai-features). |
| S3-compatible storage provider  | If the operator chooses `ARTIFACT_STORE=s3`                                                                                                 | Run evidence and baselines.                                                                                                                                                                                                                                                                        |
| Grafana Loki                    | If the operator sets `LOKI_URL`                                                                                                             | Application logs.                                                                                                                                                                                                                                                                                  |
| TestRail, Xray, Zephyr Scale    | If a plan publishes its results there                                                                                                       | For each published run: its plan's name, when it ended, the environment, the names of its tests with their outcome per browser, the reason for each failure (up to 1000 characters) and the address of the report. No screenshot, video, trace, step value or secret.                              |
| Jira, Azure DevOps              | If an organization connects an issue tracker                                                                                                | Failure details of the runs that open an issue. A requirements import sends only the keys or the query; the titles, types and states it reads are kept with the requirements.                                                                                                                      |
| BrowserStack, LambdaTest (apps) | If a mobile app test runs on the grid, or an app is uploaded to it                                                                          | The app file uploaded (not kept by WebFlowMaster), and everything the test does on the device: the values typed, variables and secrets included, the screens shown, recorded by the grid on video.                                                                                                 |
| BrowserStack, LambdaTest        | If an organization adds a browser grid and a plan runs on it                                                                                | Everything the tests do in the browser: the pages of the application under test, the values typed into them (secrets used in steps included), and the provider's own screenshots, videos and logs of each session, kept under its terms.                                                           |
| GitHub, GitLab                  | If an organization connects them                                                                                                            | Run status, verdict and a link, on the tested commit.                                                                                                                                                                                                                                              |
| Slack or Microsoft Teams        | If a plan's notifications name a webhook                                                                                                    | Run summaries.                                                                                                                                                                                                                                                                                     |
| The installation's SMTP server  | If `SMTP_URL` is set                                                                                                                        | Invitation and reset links (to the person concerned), run summaries (to the plan's addresses and to the person who started the run, if they asked).                                                                                                                                                |

The applications under test receive whatever the tests send them: that is the purpose of a test.

Where the data physically resides depends on where the operator runs the installation and its
database, storage and logging.

## Rights of the people concerned

| Request                    | How                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access, portability        | An owner exports the whole organization as JSON (`GET /api/organization/export`); see [Export and erasure](../admin/administration#export-and-erasure-owners). A person's own entries can be found in the export and in the audit log by username.                                                                                                                                                       |
| Erasure of one person      | An owner removes the member in **Settings → Members**. The account, its API keys, second factor and preferences are deleted; what the person made for the organization (tests, plans, environments…) is handed to another member. The audit trail keeps the name the person acted under, as the record of what happened. See [Members and invitations](../admin/administration#members-and-invitations). |
| Erasure of an organization | An owner erases it: every row, including every member account and the audit trail, in one transaction.                                                                                                                                                                                                                                                                                                   |
| Rectification              | Usernames cannot be changed; a person with a wrong username is invited again under the right one.                                                                                                                                                                                                                                                                                                        |
| Restriction                | An owner can lower a member to viewer, or restrict projects.                                                                                                                                                                                                                                                                                                                                             |

## What erasure does and does not reach

Erasing an organization removes all of its rows from the database at once. It does **not**:

- remove log lines already written (they expire with log retention);
- remove copies in the operator's backups, or in the systems it was connected to (issue
  trackers, commit statuses, Slack or Teams messages).

It does remove the organization's files from the artifact store, local disk or S3-compatible
bucket alike (screenshots, videos and traces under `results/<planId>/<runId>/`, baselines under
`visual-baselines/org_<id>/`), after the rows are gone. A prefix that cannot be removed is
logged (`Organization erased, but some of its files could not be removed`) and the operator
removes it by hand.

Because the audit trail goes with the organization, every erasure is also written to
`organization_erasures`, a table outside the tenant tables with no row level security and no
privilege for the application role: organization id and name, who asked, when, rows deleted per
table and files removed or left. It holds no tenant data and is kept.

Erasing a single person (GDPR art. 17) is not implemented yet: members can be removed, but
their audit entries and results keep naming them. This is an open item.

## Raw evidence and exposed credentials {#raw-evidence}

A run can keep three kinds of file that show more than a verdict: screenshots and videos (what was
on the screen), Playwright traces (the page's content, the console and every request **with its
body**) and HAR files (every request, without bodies, with known credential headers and parameters
replaced by `[redacted]`).

**What WebFlowMaster guarantees**

- Traces, HAR files and any run file whose name it does not recognise are **raw evidence**: only
  editors and owners can download them, and an API key also needs the `runs:evidence` scope. The
  server decides this on every download, listing and report — the report, `/api/v1/runs/…/evidence`
  and `/api/v1/runs/…/artifacts/…` — whether the files are on disk or in S3; it does not rely on the
  link being hidden. Files written before this rule existed are covered by it as they are: it reads
  the file's name, not a flag stored with it.
- The files of a test in a restricted project are reachable only by the people on that project and
  by owners; to anyone else in the organization they answer like a file that does not exist.
- The plan report and its exports show a result's step list, log, network summary and AI analysis only for tests the caller can see; for a test of a restricted project they are not on, the row stays but its detail is empty.
- Exports (HTML, PDF, Allure, JUnit) contain screenshots of failed tests and no other evidence.
- A test that visibly handles a credential (a `{{secret_…}}` value, or anything named _password_)
  records no trace, even when its plan asks for one.
- The migration script and `db:doctor` print the database driver, not `DATABASE_URL`.

**What it does not guarantee.** Nothing removes a secret from a screenshot, a video or a trace.
Recognising a password field is a heuristic; a token can appear anywhere on a page, in an address
or in a custom header. Treat every kept file as potentially holding what the tested application
showed or sent.

**Prudent capture for sensitive flows.** For flows that use real credentials or personal data:
dedicated test accounts with the least rights that work; **Trace** _Never_, **Video** _Never_ or
_When the test fails_, **Network (HAR)** only while diagnosing; `ARTIFACT_RETENTION_DAYS` as short
as the organization can afford.

### When credentials may already be exposed {#exposed-credentials}

Before this release, anyone in an organization who could see a run could download its traces, and
the migration script printed `DATABASE_URL` — password included — to its output. A procedure for
an installation upgraded from such a release:

1. **Inventory.** List the raw evidence still kept: keys under `results/` ending in `_trace.zip`
   or `.har` (on disk, under the results directory; in S3, a listing of the `results/` prefix). Note
   the plans and runs they belong to and which secrets those tests use. List where migration
   output was kept: CI job logs, deployment logs, terminal recordings.
2. **Assess.** Within log retention, the application's request log shows who requested
   `/artifacts/…_trace.zip` or `…_network.har` paths. Treat as exposed every secret used by a test
   whose trace a viewer could reach, and the database password if migration output was readable by
   people who should not hold it.
3. **Decide — with the person responsible.** Deleting evidence and rotating credentials are the
   decision of the organization's owner (for its test accounts) and of the operator (for the
   database password), not of whoever runs this procedure. Record the decision.
4. **Rotate**, once approved: change the password or token in the tested application first, then
   the environment secret in WebFlowMaster; change the database password and `DATABASE_URL`
   together, with the web process and the runners restarted.
5. **Delete**, once approved: remove the trace and HAR files from the artifact store (their links
   then answer "not found"), and the log copies where the log system allows it. Backups keep their
   copies until they expire.

## Retention at a glance

| What                           | Default  | Setting                                                                    |
| ------------------------------ | -------- | -------------------------------------------------------------------------- |
| Run evidence                   | 90 days  | `ARTIFACT_RETENTION_DAYS`                                                  |
| Application logs               | 7 days   | **Settings → System**, first value from `LOG_RETENTION_DAYS`               |
| Sessions                       | 7 days   | Fixed                                                                      |
| Invitation tokens              | 7 days   | Fixed                                                                      |
| Runners that stopped reporting | 7 days   | Fixed                                                                      |
| Results, tests                 | Kept     | Removed with the organization                                              |
| Audit trail                    | Kept     | `AUDIT_LOG_RETENTION_DAYS` (unset keeps it); removed with the organization |
| Attempt evidence references    | Kept     | `EVIDENCE_RETENTION_DAYS` (unset keeps them)                               |
| Database and file backups      | Operator | **The backup retention window is the operator's responsibility**           |

### Optional database retention

Two settings, both off when unset, empty or `0` (the behaviour before they existed):

- `AUDIT_LOG_RETENTION_DAYS` deletes audit entries older than that many days. The table is
  append-only for the application; the sweep runs on the privileged database connection, the
  same one organization erasure uses. Choose a window that satisfies your own accountability
  obligations: deleted entries cannot be recovered.
- `EVIDENCE_RETENTION_DAYS` clears the stored evidence references and failure reason of unit
  attempts that finished earlier than that. The attempt and its verdict stay.

Network captures (HAR) are cleaned when recorded: bodies are never kept, `Authorization`,
`Cookie`, `Set-Cookie` and similar headers, credential-looking query parameters and form posts
are replaced by `[redacted]`. Playwright traces are not redacted and follow
`ARTIFACT_RETENTION_DAYS`.

Backups of the database and of the artifact store keep their own copies for as long as the
operator's backup policy says. **The backup retention window is the operator's responsibility**;
an erasure or a retention sweep reaches them only when the backup expires.

## Recommendations for organizations

- Test with **synthetic or masked data** where possible, not production personal data.
- Keep evidence to what is needed: screenshots on failure rather than always, videos and traces
  only where they help diagnosis.
- Store test credentials as environment **secrets**, never in step values.
- Leave AI features off unless sending page content to Google is acceptable for the applications
  being tested.
