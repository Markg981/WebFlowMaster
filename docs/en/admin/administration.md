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

## Members and invitations *(owners)* {#members-and-invitations}

**Settings → Members** lists the people in the organization with their roles, and the
invitations still waiting.

**Invite someone.** Enter the username the new account will have and its role (viewer or
editor; ownership is granted afterwards), then **Create invitation**. The page shows a link,
once: send it to the person by a channel you trust, since the application sends no e-mail. The
link opens the registration form with the invitation and the username already filled in; the
person chooses a password (at least 8 characters) and is in. An invitation is valid for seven
days and can be revoked while it waits. An existing account cannot be moved between
organizations: an invitation always creates a new one.

**Change a role** with the role menu next to a member. The last owner cannot be demoted.

**Remove a member** with the bin icon. Their account is deleted, with their API keys, second
factor and preferences. What they made (projects, tests, API tests, plans, schedules, step
groups, environments and their secrets) stays in the organization and is handed to another
member: you, unless you choose someone else in the dialog. An owner removing themselves hands
it to another owner. The audit log keeps their name and records who took over.

**Issue a password reset link** with the link icon, for a member who forgot their password.
The page shows the link once: hand it over, since no e-mail is sent. It opens a form to choose a
new password, works once and lasts a day; issuing another replaces it. The member then signs in
as usual, with their second factor if they have one. For the organization's only owner, the
operator issues the link from the command line (see
[Recovering access](./operations#recovering-access)).

**Reset a member's second factor** with the key icon, when they have lost both their device and
their recovery codes. They sign in with their password and, if the organization requires it,
set it up again.

Everyone changes their own password in **Settings → Account**, with the current one. Changing a
password, or resetting it with a link, signs that person out of every other session.

Each of these is recorded in the [audit log](#audit-log).

::: details The same through the API
With an owner's API key with full access (`Authorization: Bearer wfm_…`):

| Action | Request |
|---|---|
| List members | `GET /api/organization` |
| Invite | `POST /api/organization/invitations` with `{"username":"maria.rossi","role":"editor"}`; the answer holds the token, once |
| Pending invitations, revoke one | `GET /api/organization/invitations`, `DELETE /api/organization/invitations/<id>` |
| Register with an invitation | `POST /api/register` with `{"username","password","invitationToken"}` |
| Change a role | `PATCH /api/organization/members/<userId>` with `{"role":"owner"}` |
| Remove | `DELETE /api/organization/members/<userId>`, optionally with `{"transferTo":<userId>}` |
| Password reset link | `POST /api/organization/members/<userId>/password-reset`; the answer holds the token, once. The link is `/auth?reset=<token>` |
| Reset the second factor | `DELETE /api/organization/members/<userId>/mfa` |
:::

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
second factor in **Settings → Members**.

## Single sign-on *(owners)* {#single-sign-on}

Members can sign in with the organization's identity provider through **OpenID Connect**:
Microsoft Entra ID, Okta, Google Workspace, Keycloak, Auth0 and any other provider that
publishes a discovery document. SAML is not supported.

**Setting it up.** In **Settings → Security → Single sign-on**:

1. Copy the **redirect URI** shown there (it ends in `/api/sso/callback`; it uses
   `WEBFLOW_PUBLIC_URL` when that is set).
2. At the provider, register a web application with that redirect URI, the scopes
   `openid email profile`, and a client secret. The client authenticates with
   `client_secret_basic`, the default almost everywhere.
3. Back here, enter the **issuer** (the address whose `/.well-known/openid-configuration` the
   provider publishes), the **client ID** and the **client secret**, the **e-mail domains** your
   members' addresses end in, and the **role of new accounts** (viewer or editor).
4. **Save**, then **Test the provider**: it fetches the discovery document with what was saved.

| Provider | Issuer |
|---|---|
| Microsoft Entra ID | `https://login.microsoftonline.com/{tenant-id}/v2.0` |
| Google Workspace | `https://accounts.google.com` |
| Okta | `https://{your-domain}.okta.com` (or an authorization server under it) |
| Keycloak | `https://{host}/realms/{realm}` |

The client secret is stored encrypted and never shown again; leave the field empty to keep it
when changing something else. Each domain belongs to one organization on the installation.

**Signing in.** The sign-in page shows **Sign in with SSO** once any organization has set it up.
The person types their address; its domain picks the organization, and the browser goes to the
provider. On the way back the application checks the provider's signed answer (issuer,
audience, signature, expiry, and a one-time nonce and state), then:

- an identity it has seen before signs in to the same account, even if the address changed;
- the first time, an existing account of the organization whose username is that address is
  linked to it; this is how members who already had a password move over;
- otherwise an account is **created**, with the address as its username and the role you
  chose. Owners are never created this way: make someone an owner in **Settings → Members**.

The address comes from the `email` claim or, when that is missing, from a `preferred_username`
shaped like an address, which is what Entra ID sends. An address the provider marks as
unverified is refused, as is one outside your domains.

**Requiring it.** With **Require it** on, members other than owners can no longer sign in with a
password, and password sessions already open end at their next request. Owners keep their
password so that someone can still get in, and fix the settings, if the provider is down or
misconfigured. API keys are not affected.

A session opened through the provider is not asked for the organization's
[second factor](#two-factor-authentication): the provider is where that check belongs, so
require it there.

::: warning The provider decides who gets in
Removing a member here deletes their account, but if the provider still lets them sign in,
their next sign-in creates a new account with the default role. End people's access at the
provider; removing them here as well tidies up the member list.
:::

The audit log records the settings being changed or removed (never the secret), each account
created at first sign-in, and each sign-in, with `method: sso`. When a sign-in is refused, the
person sees why on the sign-in page, and the server log has the provider's own error.

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
puts it back. Runners serve every organization on the installation, so only its
[administrators](#installation-administrators) can drain or resume one; other owners see the
list without the buttons.

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

They apply to every organization on the installation, so only its administrators can change
them; anyone else sees them read-only. The change is recorded in the audit log of the
administrator's organization.

### Installation administrators {#installation-administrators}

Log settings and draining runners belong to the whole installation, not to one organization.
Who may change them:

- the people whose usernames are listed in `INSTALLATION_ADMINS`, when it is set
  ([Configuration](./configuration)); nobody else, whatever their role;
- otherwise, the owners of the organization while the installation has **exactly one**. As soon
  as a second organization exists, nobody may until the operator sets `INSTALLATION_ADMINS`.

A single company running its own installation needs to do nothing. An installation shared by
several customers should name its operators.

## Export and erasure *(owners)*

Both are done through the API for now, with an owner's full-access key:

```bash
export WFM_URL=https://webflowmaster.example.com
export KEY=wfm_...   # an owner's full-access key
```

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

- Export and erasure have no screen yet; they are done through the API as shown above.
- Erasing an organization leaves its files in the artifact store for the operator to remove.
- Single sign-on is OpenID Connect only (no SAML), and roles are not taken from the provider's
  groups: new accounts get the default role, and owners change it in **Settings → Members**.
- There is no e-mail delivery; invitations are handed over by hand.
- The **Notifications** and **Account** sections of Settings are not saved yet.
