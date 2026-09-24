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

| Data | Examples | Where it is kept | How long |
|---|---|---|---|
| Accounts | Username (may be an e-mail address), role, creation date | Database | Until the member is removed or the organization is erased |
| Credentials | Password hash (scrypt), second-factor secret (encrypted), recovery codes (hashed) | Database | As accounts |
| Sessions | Session id, user id | Redis | 7 days, or until sign-out |
| Audit trail | Actor's name, action, target, client IP address, key used, time | Database | Until the organization is erased; not deletable by the application |
| Application logs | User ids, request paths, correlation ids, errors | Log files, standard output, Loki if configured | 7 days by default (configurable) |
| Tests and plans | Steps, addresses, element descriptions, schedules, notification addresses, comments on reviews | Database | Until deleted, or the organization is erased |
| Stored secrets | Test account passwords, tokens | Database, encrypted | Until deleted |
| Run results | Verdicts, step outcomes, error messages, who started the run, CI context (repository, commit, branch, build) | Database | Until the organization is erased |
| Run evidence | Screenshots, videos, Playwright traces, network captures without bodies or credentials | Artifact store (disk or S3) | `ARTIFACT_RETENTION_DAYS`, 90 days by default |
| Visual baselines | Reference screenshots | Artifact store | Until replaced or removed |
| Password reset links | Whose, who issued it, a hash of the token | Database | One day, or until used; not included in exports |
| Invitations | Invited username, role, who invited | Database | Until revoked; the invitation token expires after 7 days |
| Uploaded spreadsheets | Imported test cases | Local disk while being read | Deleted once parsed |

Backups made by the operator hold copies of the database and of the artifact store for as long
as the operator keeps them.

## Who can see what

- Everything an organization holds is visible only to its own members, according to their roles
  and, for restricted projects, their project membership. The database enforces this.
- The audit trail is visible to the organization's owners only.
- The operator of the installation has technical access to the database, the logs and the
  artifact store, like any hosting provider. Stored secrets are encrypted with a key the
  operator also holds.

## Third parties

The product itself sends data to third parties only where an organization or the operator
configures it:

| Recipient | When | What |
|---|---|---|
| Google (Gemini API) | Only if the operator sets `GEMINI_API_KEY` | Sentences describing tests; on a failing step, the error and up to 30,000 characters of the page's HTML. See [AI features](./#ai-features). |
| S3-compatible storage provider | If the operator chooses `ARTIFACT_STORE=s3` | Run evidence and baselines. |
| Grafana Loki | If the operator sets `LOKI_URL` | Application logs. |
| Jira, Azure DevOps | If an organization connects an issue tracker | Failure details of the runs that open an issue. |
| GitHub, GitLab | If an organization connects them | Run status, verdict and a link, on the tested commit. |
| Slack or Microsoft Teams | If a plan's notifications name a webhook | Run summaries. (E-mail addresses can be saved on a plan, but no e-mail is sent.) |

The applications under test receive whatever the tests send them: that is the purpose of a test.

Where the data physically resides depends on where the operator runs the installation and its
database, storage and logging.

## Rights of the people concerned

| Request | How |
|---|---|
| Access, portability | An owner exports the whole organization as JSON (`GET /api/organization/export`); see [Export and erasure](../admin/administration#export-and-erasure-owners). A person's own entries can be found in the export and in the audit log by username. |
| Erasure of one person | An owner removes the member in **Settings → Members**. The account, its API keys, second factor and preferences are deleted; what the person made for the organization (tests, plans, environments…) is handed to another member. The audit trail keeps the name the person acted under, as the record of what happened. See [Members and invitations](../admin/administration#members-and-invitations). |
| Erasure of an organization | An owner erases it: every row, including every member account and the audit trail, in one transaction. |
| Rectification | Usernames cannot be changed; a person with a wrong username is invited again under the right one. |
| Restriction | An owner can lower a member to viewer, or restrict projects. |

## What erasure does and does not reach

Erasing an organization removes all of its rows from the database at once. It does **not**:

- remove its files from the artifact store (screenshots, videos and traces under
  `results/<planId>/`, baselines under `visual-baselines/org_<id>/`), which retention can no
  longer find once the runs are gone;
- remove log lines already written (they expire with log retention);
- remove copies in the operator's backups, or in the systems it was connected to (issue
  trackers, commit statuses, Slack or Teams messages).

The operator completes an erasure by removing the files; the plan ids are in the export taken
before erasing.

## Retention at a glance

| What | Default | Setting |
|---|---|---|
| Run evidence | 90 days | `ARTIFACT_RETENTION_DAYS` |
| Application logs | 7 days | **Settings → System**, first value from `LOG_RETENTION_DAYS` |
| Sessions | 7 days | Fixed |
| Invitation tokens | 7 days | Fixed |
| Runners that stopped reporting | 7 days | Fixed |
| Results, tests, audit trail | Kept | Removed with the organization |

## Recommendations for organizations

- Test with **synthetic or masked data** where possible, not production personal data.
- Keep evidence to what is needed: screenshots on failure rather than always, videos and traces
  only where they help diagnosis.
- Store test credentials as environment **secrets**, never in step values.
- Leave AI features off unless sending page content to Google is acceptable for the applications
  being tested.
