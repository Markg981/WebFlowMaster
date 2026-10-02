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
once. When the installation sends e-mail ([E-mail](#e-mail)) and the username is an address, the
link is also mailed to it, and the page says whether it left; otherwise send it by a channel you
trust. The link opens the registration form with the invitation and the username already filled
in; the person chooses a password (as the [password policy](#password-policy) asks) and is in. An invitation is valid for seven
days and can be revoked while it waits. An existing account cannot be moved between
organizations: an invitation always creates a new one.

**Change a role** with the role menu next to a member. The last owner cannot be demoted.

**Remove a member** with the bin icon. Their account is deleted, with their API keys, second
factor and preferences. What they made (projects, tests, API tests, plans, schedules, step
groups, environments and their secrets) stays in the organization and is handed to another
member: you, unless you choose someone else in the dialog. An owner removing themselves hands
it to another owner. The audit log keeps their name and records who took over.

**Issue a password reset link** with the link icon, for a member who forgot their password.
The page shows the link once, and mails it as an invitation is mailed. It opens a form to choose a
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

Members can sign in with the organization's identity provider through **OpenID Connect** or
**SAML 2.0**. OpenID Connect suits Microsoft Entra ID, Okta, Google Workspace, Keycloak, Auth0 and
any provider that publishes a discovery document; SAML suits providers that speak only SAML —
ADFS, Shibboleth, PingFederate, older Okta and Entra ID set-ups. An organization uses one provider
and one protocol at a time; choose it with **Protocol** at the top of the card.

**Setting up OpenID Connect.** In **Settings → Security → Single sign-on**, Protocol **OpenID Connect**:

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

**Setting up SAML 2.0.** Protocol **SAML 2.0**. The card shows what to give your provider; every
organization is its own service provider:

| WebFlowMaster value | Where it goes at the provider |
|---|---|
| **Entity ID** `…/api/sso/saml/{organization}` | Identifier / Audience / *Relying party identifier* / Keycloak *Client ID* |
| **ACS URL** `…/api/sso/saml/{organization}/acs` | Reply URL / *Assertion Consumer Service*, binding **HTTP-POST** |
| **Metadata URL** `…/api/sso/saml/{organization}/metadata` | Providers that import service-provider metadata (ADFS, Shibboleth) read everything from here, once saved |

At the provider:

1. Create the application with those values. The **assertion must be signed** (signing the whole
   response as well is fine). To enable encrypted assertions, first configure the service-provider
   RSA certificate and private key below and give the provider the updated metadata.
2. Send the person's **e-mail address**: as an attribute named `email`, `mail`,
   `urn:oid:0.9.2342.19200300.100.1.3` or Microsoft's `…/claims/emailaddress`, or as the NameID
   in e-mail format.
3. Prefer a **persistent** NameID: it identifies the person even when their address changes. With
   a transient NameID the address is used as the identity.

Back here, paste the provider's **metadata XML** and press **Read the metadata**: it fills the
provider's **entity ID**, its **sign-on URL** (HTTP-Redirect binding) and its **signing
certificate**. You can also type them. Add the e-mail domains and the role of new accounts, then
**Save** and **Test the provider**, which checks that the certificate is valid and the sign-on URL
answers. The card shows the certificate's subject and expiry date; when the provider rolls its
certificate, paste the new one — with an expired certificate every sign-in is refused, and the
card says so.

| Provider | Where to find the metadata |
|---|---|
| Microsoft Entra ID | Enterprise application → Single sign-on → *Federation Metadata XML* |
| Okta | Application → Sign On → *Identity Provider metadata* |
| ADFS | `https://{host}/FederationMetadata/2007-06/FederationMetadata.xml` |
| Keycloak | `https://{host}/realms/{realm}/protocol/saml/descriptor` |

**Advanced SAML.** Identity provider initiated sign-in is off by default. Enable it explicitly
when users launch this application from the provider's portal. An unsolicited response is checked
for a signed assertion, issuer, audience, ACS destination and recipient, validity and allowed domain;
its assertion identifier is consumed atomically so replay is refused. It cannot carry the browser
binding of an application-initiated request, so enable it only for a trusted provider launch flow.

For **encrypted assertions**, paste a matching RSA service provider certificate and PEM private
key. The private key is encrypted at rest and never returned; a blank field retains it. Give the
provider the updated metadata containing the encryption certificate. Turn on **Require encrypted
assertions** to refuse unencrypted assertions; encrypted assertions still need a valid signature.

For **single logout**, set the provider's HTTP-Redirect logout URL and the same service provider
key pair. Register the callback shown in the card (`/api/sso/saml/<organizationId>/slo`) with the
provider. Logout from WebFlowMaster ends the local session and sends a signed LogoutRequest;
the returning LogoutResponse must be signed and correlated. Provider-initiated logout accepts
signed Redirect or POST requests and revokes matching sessions by NameID and SessionIndex, even
when a cross-site POST carries no session cookie. Logout messages must match the configured issuer,
destination and validity window and cannot be replayed. Export the updated service provider metadata
after configuring keys or logout. Providers must use the supported bindings and signatures.

**Signing in.** The sign-in page shows **Sign in with SSO** once any organization has set it up.
The person types their address; its domain picks the organization, and the browser goes to the
provider. On the way back the application checks the provider's signed answer — for OpenID
Connect the ID token's issuer, audience, signature, expiry, nonce and state; for SAML the
assertion's signature against the saved certificate, its issuer, audience, validity window and
that it answers a request this installation sent, which it can do only once — then:

- an identity it has seen before signs in to the same account, even if the address changed;
- the first time, an existing account of the organization whose username is that address is
  linked to it; this is how members who already had a password move over;
- otherwise an account is **created**, with the address as its username and the role you
  chose — or the role its groups map to, below. Without a group mapped to owner, owners are
  never created this way: make someone an owner in **Settings → Members**.

With OpenID Connect the address comes from the `email` claim or, when that is missing, from a
`preferred_username` shaped like an address, which is what Entra ID sends; an address the provider
marks as unverified is refused. With SAML it comes from the attributes listed above or an
address-shaped NameID. Either way an address outside your domains is refused.

**Roles from the provider's groups.** Under **Roles from the provider's groups**, map the groups
the provider sends to a role — viewer, editor or owner. At every sign-in the person gets the
highest role any of their groups maps to: a new account is created with it, and an existing one
follows it, up or down (the audit log records the change as `member.role_changed` with
`bySsoGroups: true`). Someone in none of the mapped groups keeps the role they have, and a new
account gets the default role; nothing mapped at all, roles are managed in **Settings → Members**
as before. The organization's last owner is never demoted by their groups, so it cannot lock
itself out.

Groups are compared without regard to case. **Claim or attribute with the groups** names where the
provider puts them — `groups` when empty; a list or a single value both work.

| Provider | What to send |
|---|---|
| Microsoft Entra ID | App registration → Token configuration → *Add groups claim*. The `groups` claim carries the groups' **object IDs**: map those, not the names. Over 200 groups Entra sends a link instead of the list; assign the groups to the application to stay under it. |
| Okta | Authorization server → Claims → a `groups` claim with a filter (e.g. *Starts with* `wfm-`). For SAML, a group attribute statement. |
| Keycloak | Client scope → Mapper *Group Membership*, token claim name `groups`, *Full group path* off. For SAML, the *Group list* mapper. |
| ADFS | A claim rule sending *Token-Groups – Unqualified Names* as an attribute (e.g. `groups`). |

**Refuse whoever is in none of these groups** (once a group is mapped) turns the mapping into the
gate: a person in none of the mapped groups cannot sign in, whether their account exists or not,
and sees why on the sign-in page. Removing someone from the groups at the provider then ends their
access here at their next sign-in.

**Proving the domains.** Each domain shows a DNS TXT record to publish:
`_wfm-verification.<domain>` with the value `wfm-verification=<token>`. Once it is published,
press **Verify**: the server looks the record up and marks the domain **proven**; the card says
what it found when the record is not there yet (DNS changes can take a while to reach every
server). The proof is kept when the settings are saved again, and lost only when the domain is
removed from the list.

Where the installation sets `SSO_REQUIRE_DOMAIN_VERIFICATION=true` — every shared or multi-tenant
installation should — a domain routes no sign-in until it is proven, and an unproven claim does not
hold it: another organization that adds the domain takes it over, and whoever proves it first
keeps it. Without the variable domains work as soon as they are saved and proving them is
optional, which suits an installation with one organization.

**Provisioning with SCIM.** Single sign-on learns about people when they sign in. With SCIM
2.0 the provider tells WebFlowMaster as soon as something changes there: it creates accounts,
deactivates and removes them, and pushes its groups. Under **Provisioning (SCIM)**, press **Issue a
token** and give the provider the **SCIM base URL** (`<your address>/api/scim/v2`) and the token,
which is shown once; **Replace the token** ends the old one at once, **Revoke** ends provisioning.
Single sign-on must be set up first: provisioned accounts have no password and sign in through
the provider, which links them by address at the first sign-in.

| Provider | Where |
|---|---|
| Microsoft Entra ID | Enterprise application → Provisioning → *Automatic*: **Tenant URL** is the base URL, **Secret token** the token. Map `userPrincipalName` (or `mail`) to `userName`; *Provision Microsoft Entra ID Groups* pushes the groups. |
| Okta | The app's *Provisioning* tab → SCIM 2.0, **Base URL** and *HTTP Header* authentication with the token; unique identifier `userName` (the e-mail address); turn on *Create*, *Update* and *Deactivate Users*, and *Push Groups*. |
| Others (OneLogin, JumpCloud, Keycloak with a SCIM extension…) | SCIM 2.0 with a bearer token: the base URL and the token. |

What it does here:

- **Users** are the organization's members; `userName` is their e-mail address, in one of the
  single sign-on domains. A new user gets **Role of new accounts**. Members who were here before
  are listed too, so a provider matching by `userName` takes them over instead of creating them
  again.
- **`active: false` deactivates** the account at once: its sessions end at their next request, it
  cannot sign in, and its API keys stop working. **Settings → Members** marks it *deactivated*.
  `active: true` gives it back with its role and everything it made.
- **Deleting** a user removes the member as an owner would: what they made goes to the
  longest-standing owner.
- **Groups** apply the mappings of **Roles from the provider's groups** as soon as someone joins
  or leaves one: the group's name, or its external ID (Entra ID's object ID), is what is matched.
  Changing the mappings applies them to the pushed groups at once. Someone in none of the mapped
  groups keeps their role, as at sign-in — unless **Refuse whoever is in none of these groups** is
  on: then an account the provider manages is **deactivated at once** when it leaves the last
  mapped group (its sessions end, `reason: no_group` in the audit log) and reactivated when it joins
  one again; a new account waits deactivated until a mapped group holds it. One the provider
  deactivated itself (`active: false`) stays so until the provider says otherwise. The gate judges
  only once the provider pushes groups, so a provider that syncs people alone does not lock them
  out.
- The organization's **last active owner** is never deactivated, demoted or removed by the
  provider; it answers 409 instead.

The audit log names the actor `SCIM` for every change the provider makes: accounts created
(`member.provisioned`), deactivated, reactivated, renamed or removed, roles changed by groups
(`bySsoGroups` and `byScim`), and groups pushed, changed or removed; issuing and revoking the token
are recorded under the owner who did it, never the token.

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
provider — with SCIM provisioning, that deactivates them here at once — or map groups and turn
on **Refuse whoever is in none of these groups**, then take them out of the groups; removing them
here as well tidies up the member list.
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
| Test management (TestRail, Xray, Zephyr Scale) | **Settings → Test management**; see [Publishing to TestRail, Xray or Zephyr](../guide/results#test-management) | Editors |
| Commit statuses on GitHub and GitLab | **Settings → GitHub & GitLab**; shows the last delivery error | Owners |
| Local agents | **Settings → Local agents**; see [Local agents](../LOCAL_AGENT) | Owners |

Tokens for trackers, test management tools and GitHub/GitLab are encrypted when saved and are never shown again; to
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

In **Settings → Export and erasure**: **Download the export**, and **Erase permanently** after
typing the organization's exact name. The same is available through the API, with an owner's
full-access key:

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

Erasure removes the organization's rows from the database and then its files from the artifact
store: each run's screenshots, videos and traces under `results/<planId>/<runId>/`, and its
visual baselines under `visual-baselines/org_<id>/`. The answer says how many files were removed
and names any folder the store refused (an unreachable bucket, say), which the application log
records too; the operator removes those by hand. Database backups keep the organization until
they expire.

## E-mail {#e-mail}

With `SMTP_URL` and `SMTP_FROM` set (see [Configuration](./configuration)), the installation sends:

- **Invitations and password reset links** an owner issues, to usernames that are addresses. The
  link is still shown once, for when the mail does not arrive.
- **"Forgot your password?"** on the sign-in page: a reset link mailed to the address the person
  signs in with. The answer is the same whether or not the account exists, so it cannot be used to
  find out who has one. The request is recorded in the audit log.
- **Run notifications**: to the addresses in a plan's notifications, when its switches say so for
  the outcome, and to the person who started a run, from **Settings → Notifications**: e-mail on or
  off (off by default), then every finished run or failed runs only. A refused message is said on
  the run's console; it never changes the run.

Without SMTP everything works as before: owners hand the links over, and plans notify through
their webhook only.

Messages include built-in **HTML templates and a plain-text alternative** for invitations,
password resets and run notifications. Dynamic text is escaped; links are restricted to HTTP(S).
There is no template editor.

Owners can inspect the latest 100 messages for their organization in **Settings → Security →
Email delivery**. **Accepted by SMTP** means the relay accepted the recipient; it does not prove
delivery. Confirmed delivery, temporary bounces and hard bounces come from authenticated events.
A hard bounce suppresses later sends to that address within the same organization. The history
stores recipient, purpose, state and timestamps, never message bodies or reset/invitation tokens.

To record events, configure `MAIL_DELIVERY_WEBHOOK_SECRET` (at least 32 characters) and an adapter
for your mail provider or relay. Each outgoing message carries an `X-Wfm-Delivery-Id` UUID and a
Message-ID containing that UUID. The adapter posts JSON to `/api/mail-deliveries/events`:

```json
{"eventId":"provider-event-123","messageId":"e3dab9f5-d6c4-4a74-af2e-a665498b18cd","status":"hard_bounce"}
```

`status` is `delivered`, `soft_bounce` or `hard_bounce`. Set `X-Wfm-Mail-Timestamp` to the current
Unix time in seconds and `X-Wfm-Mail-Signature` to the hex HMAC-SHA256, using the configured secret,
of `timestamp.eventId.messageId.status`. The timestamp must be within five minutes. Duplicate
events are idempotent; delayed events cannot undo a hard bounce. Native provider webhook payloads
need an adapter; SMTP alone supplies no delivery/bounce confirmations. See the reproducible
acceptance cases in [Administration acceptance](../../administration-acceptance.md).

## Password policy {#password-policy}

`PASSWORD_POLICY` decides what a new password must be, when it is chosen (registration, change,
reset link); existing passwords are not checked.

- `basic` (default): 8 to 128 characters, not the username.
- `strong`: at least 12 characters; at least three of lowercase, uppercase, digits and symbols;
  not containing the username (or the part of an address before the @); not one of the passwords
  every guessing list starts with.

## Known limitations

- Without SCIM, single sign-on reads roles from groups only at sign-in: a change at the provider
  reaches WebFlowMaster at the person's next sign-in, and sessions already open keep their role
  until then. SCIM supports `eq` filters on one attribute, no bulk operations and no sorting, and
  keeps the address, the active flag and the external ID of a user (names and other attributes are
  accepted and ignored).
- SAML single logout requires a configured SP RSA key pair and signed protocol messages; provider
  compatibility must be verified before enabling it. IdP-initiated sign-in lacks request/browser binding.
- E-mail has built-in HTML templates without an editor. Delivery/bounce tracking requires a mail-provider
  adapter posting signed events; SMTP acceptance alone cannot confirm delivery.
- SaaS billing and consumption plans are deferred by decision on 2026-10-02. Provider, pricing,
  currency and the billable unit remain to be defined; organization execution quotas remain available.
