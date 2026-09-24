# Administration

For the owners of an organization: who can do what, how people and machines get access, and
the controls an owner has over security, capacity and the organization's data. Setting up the
installation itself is in [Installation](./installation) and [Operations](./operations).

Most of what follows is in **Settings**. Sections marked *owners* are only shown to owners.

## Roles

Each person belongs to exactly one organization, with one role.

| | Viewer | Editor | Owner |
|---|:---:|:---:|:---:|
| See tests, plans, runs and reports | ✓ | ✓ | ✓ |
| Create and change tests, suites, plans, schedules, environments | | ✓ | ✓ |
| Start and cancel runs | | ✓ | ✓ |
| Create their own API keys | | ✓ | ✓ |
| Approve reviews, when the organization requires them | | ✓ | ✓ |
| Members, invitations and roles | | | ✓ |
| Restricted projects and who is on them | | | ✓ |
| Service accounts; revoke anyone's API key | | | ✓ |
| Local agents, GitHub/GitLab connections | | | ✓ |
| Two-factor policy, review policy | | | ✓ |
| Runners, audit log, system settings | | | ✓ |
| Export or erase the organization | | | ✓ |

Every organization keeps at least one owner: the last owner cannot be demoted or removed.

Give people the smallest role that lets them work. Stakeholders who follow results are viewers;
pipelines use API keys, not a person's account.

## Members and invitations

::: info No screen yet
Members and invitations are managed through the API for now: the web client does not yet have
a page for them, and its registration form has no field for an invitation. The examples below
use `curl` with an API key.
:::

To call these endpoints, create an API key with **Full access, everywhere** in
**Settings → API keys** while signed in as an owner. Keep it for this purpose only and revoke it when you are done.

```bash
export WFM_URL=https://webflowmaster.example.com
export KEY=wfm_...   # an owner's full-access key
```

**List members:**

```bash
curl -s -H "Authorization: Bearer $KEY" "$WFM_URL/api/organization"
```

**Invite someone.** An invitation names the username the new account will have and its role
(`viewer` or `editor`; ownership is granted afterwards). It is valid for seven days, and the
token is returned only in this answer:

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"username":"maria.rossi","role":"editor"}' "$WFM_URL/api/organization/invitations"
```

The application sends no e-mail: give the token to the person by a channel you trust. They
create their account with it, choosing their password (at least 8 characters):

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"username":"maria.rossi","password":"…","invitationToken":"<token>"}' \
  "$WFM_URL/api/register"
```

and then sign in on the web page as usual. An existing account cannot be moved between
organizations; an invitation always creates a new one.

**Pending invitations and revoking one:** `GET /api/organization/invitations`,
`DELETE /api/organization/invitations/<id>`.

**Change a role:** `PATCH /api/organization/members/<userId>` with `{"role":"owner"}`.

**Remove a member:** `DELETE /api/organization/members/<userId>`. The account is deleted, and
the audit trail keeps their name.

::: danger Known problem: removing a member who created things
Today, removing a member also deletes the environments (with their secrets), API tests,
schedules and API keys that member created, and it fails if they created projects, tests, plans
or step groups, or saved their preferences. Until this is fixed, do not remove members who have
worked in the organization: change them to `viewer` and revoke their API keys instead.
:::

Each of these is recorded in the [audit log](#audit-log).

## Restricted projects

A project is open to the whole organization by default. An owner can **restrict** it in
**Settings → Projects**, with the people icon next to the project: it is then visible only to
owners and to the people listed, each as viewer or editor. A project role can narrow an organization role but never widen it: a
viewer listed as editor still cannot edit.

Restriction covers the project's tests, API tests, step groups, elements and suites. Plans,
runs and reports stay visible to the whole organization, and a plan may run a restricted
project's tests. The database enforces it, not only the interface.

## Two-factor authentication

Each person can turn on a second factor in **Settings → Security**: a code from an
authenticator app, plus one-time recovery codes to keep somewhere safe.

An owner can **require** it for the whole organization in the same section. From that moment,
a member without a second factor can do nothing but set one up, including in sessions that are
already open. API keys are not affected.

A member who lost both their device and their recovery codes needs an owner to reset their
second factor, through the API for now:

```bash
curl -s -X DELETE -H "Authorization: Bearer $KEY" "$WFM_URL/api/organization/members/<userId>/mfa"
```

They then sign in with their password and, if the organization requires it, set it up again.

## API keys and service accounts

Pipelines and scripts authenticate with **API keys** (**Settings → API keys**), never with a
person's password.

- **Scoped keys** (the default) work only on the public API `/api/v1`, and only for what they
  were given: `plans:read`, `runs:read`, `runs:write`. A pipeline that starts a plan and waits
  for it needs `runs:write` and `runs:read`.
- **Full-access keys** act as their account everywhere. Use them only when a scoped key cannot do
  the job.
- A key can have an **expiry date**. Its last use is shown, so unused keys can be found.
- The key is shown **once**. It is stored as a hash and cannot be recovered; a lost key is
  revoked and replaced.
- The role of the key's account still applies: a viewer's key cannot start runs.

A key belongs to its account. When the pipeline must not depend on one person, an owner creates
a **service account**: an account that cannot sign in, has its own role (viewer or editor),
and holds keys. Disabling the service account revokes all its keys at once.

Owners see and can revoke every key in the organization.

## Integrations

| What | Where | Who |
|---|---|---|
| Starting plans from CI | API keys and the `wfm` CLI; see [CI integration](../CI_INTEGRATION) | Editors |
| Webhooks that start a plan | The plan's settings; each has its own token | Editors |
| Issue trackers (Jira, Azure DevOps) | **Settings → Issue trackers** | Editors |
| Commit statuses on GitHub and GitLab | **Settings → GitHub & GitLab**; shows the last delivery error | Owners |
| Local agents | **Settings → Local agents**; see [Local agents](../LOCAL_AGENT) | Owners |

Tokens for trackers and GitHub/GitLab are encrypted when saved and are never shown again; to
change one, enter the new value.

## Environments and secrets

**Settings → Environments** holds the values tests use: addresses, usernames, passwords. A
secret named `baseUrl` sets <code v-pre>{{baseUrl}}</code>, so the same test runs against test,
staging and production. Secret values are encrypted, never shown again after saving, and masked
in logs. The audit log records that a secret was set or deleted, never its value.

## Test reviews

When an owner turns on **Require a review to publish** on the **Reviews** page, a change to a
test reaches the plans only after another member approves it. Plans keep running the last published version
in the meantime. Useful where tests gate releases and a change should be seen by two people.

## Runners *(owners)*

**Settings → Runners** lists the worker machines of the installation: online, draining or
offline, what they are running and which version they are on.

**Drain** a runner before maintenance: it finishes what it has and takes nothing new. **Resume**
puts it back. Runners serve every organization on the installation, so on a shared installation
this is a decision for its operator.

## Run usage and limits

**Settings → Run usage** shows the organization's runs in progress and waiting, against its
limits, and how many runners are online. A run that stays *queued* is usually explained here:
the organization is at its limit, or no runner is online.

The limits are set by the installation's operator, not by owners (see
[Capacity and limits](./operations#capacity-and-limits)).

## Audit log *(owners)* {#audit-log}

**Settings → Audit log** records who did what and when: sign-ins and failed sign-ins, members
and invitations, keys and service accounts, tests, plans, schedules, suites, projects and their
access, reviews and publications, quarantine, environments and secrets, agents, GitHub/GitLab
connections, runners, two-factor changes, cancelled runs and system settings.

Each entry has the actor, the action, the target, the client's IP address and, for requests
made with a key, which key. It can be filtered by category, action, person and dates, and
exported as CSV (up to 10,000 entries per export; narrow the dates for more).

The log cannot be changed or deleted from the application: the database grants it only
reading and adding. It is removed only when the whole organization is erased.

## System settings *(owners)*

**Settings → System** sets the log level and how long log files are kept.

::: warning These are installation-wide
They apply to every organization on the installation, and any organization's owner can change
them. The change is recorded in the audit log of the organization whose owner made it. On an
installation shared by several customers, leave these to the operator.
:::

## Export and erasure *(owners)*

**Export**: `GET /api/organization/export` returns the whole organization as one JSON file:
every table that belongs to it (members, projects, tests, plans, runs, the audit log and the
rest). Passwords and invitation tokens are left out. Stored secrets and integration tokens are
included in their encrypted form, unreadable without the installation's `ENCRYPTION_KEY`; API
keys and other tokens only as hashes, which cannot be turned back into keys. Treat the file as
confidential all the same: it holds the organization's tests, data and audit trail.

```bash
curl -s -H "Authorization: Bearer $KEY" "$WFM_URL/api/organization/export" -o export.json
```

**Erasure** deletes the organization and **every member account**, irreversibly. It requires
the organization's exact name as confirmation:

```bash
curl -s -X DELETE -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"confirmName":"Acme QA"}' "$WFM_URL/api/organization"
```

Export first. The erasure is written to the application log, since the audit log is erased with
the organization.

Erasure removes the organization's rows from the database. It does not remove its files from
the artifact store (screenshots, videos and traces under `results/<planId>/`, with the plan ids in the export;
baselines under `visual-baselines/org_<id>/`), and retention no longer finds them once their runs are gone:
the installation's operator removes them, and handles database backups, which keep the
organization until they expire.

## Known limitations

- Members, invitations, a member's second-factor reset, export and erasure have no screen yet;
  they are done through the API as shown above.
- Removing a member who created things does not work as it should (see
  [Members and invitations](#members-and-invitations)).
- Registration is open to anyone who can reach the installation and creates a new organization
  (see [First sign-in](./installation#first-sign-in)).
- Erasing an organization leaves its files in the artifact store for the operator to remove.
- There is no single sign-on (SAML, OpenID Connect) and no e-mail delivery; invitations are
  handed over by hand.
- The **Notifications** and **Account** sections of Settings are not saved yet.
