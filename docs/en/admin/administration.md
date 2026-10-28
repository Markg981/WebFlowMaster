# Administration

For the owners of an organization: who can do what, how people and machines get access, and
the controls an owner has over security, capacity and the organization's data. Setting up the
installation itself is in [Installation](./installation) and [Operations](./operations).

Most of what follows is in **Settings**. Sections marked _owners_ are only shown to owners.

## Roles

Each person belongs to exactly one organization, with one role.

|                                                                 | Viewer | Editor | Owner |
| --------------------------------------------------------------- | :----: | :----: | :---: |
| See tests, plans, runs and reports                              |   ✓    |   ✓    |   ✓   |
| Create and change tests, suites, plans, schedules, environments |        |   ✓    |   ✓   |
| Start and cancel runs                                           |        |   ✓    |   ✓   |
| Create their own API keys                                       |        |   ✓    |   ✓   |
| Approve reviews, when the organization requires them            |        |   ✓    |   ✓   |
| Members, invitations and roles                                  |        |        |   ✓   |
| Restricted projects and who is on them                          |        |        |   ✓   |
| Service accounts; revoke anyone's API key                       |        |        |   ✓   |
| Local agents, GitHub/GitLab connections                         |        |        |   ✓   |
| Two-factor policy, review policy                                |        |        |   ✓   |
| Runners, audit log, system settings                             |        |        |   ✓   |
| Export or erase the organization                                |        |        |   ✓   |

Every organization keeps at least one owner: the last owner cannot be demoted or removed.

Give people the smallest role that lets them work. Stakeholders who follow results are viewers;
pipelines use API keys, not a person's account.

## Members and invitations _(owners)_ {#members-and-invitations}

**Settings → Members** lists the people in the organization with their roles, and the
invitations still waiting.

**Invite someone.** Enter the username the new account will have and its role (viewer or
editor; ownership is granted afterwards), then **Create invitation**. The page shows a link,
once. When the installation sends e-mail ([E-mail](#e-mail)) and the username is an address, the
link is also mailed to it, and the page says whether it left; otherwise send it by a channel you
trust. The link opens the registration form with the invitation and the username already filled
in; the person chooses a password (as the [password policy](#password-policy) asks) and is in. An invitation is valid for seven
days and can be revoked while it waits.

**Invite someone who already has an account** the same way, with their existing username: the
page says so when it shows the link. They sign in with their account and open the link, which asks
them to join your organization with the role you chose. Their account then belongs to both
organizations, and they switch between them from the header. An account is never moved: it is
added to an organization by accepting, and leaves one by being removed from it.

**Several organizations.** A member of more than one sees an organization menu in the header,
next to the search. Switching starts a fresh session in the chosen organization with the role held
there, and everything on screen — tests, plans, runs, settings — is that organization's. Nothing of
one organization is visible while acting in another. The switch moves only the browser it was
made in: another browser or device signed in to the same account stays in the organization it
shows, and what it creates lands there. A new sign-in starts in the organization last switched to.
An API key always acts in the organization that issued it, with the role held there. Removed from
an organization, a person's sessions acting in it end at their next request. The audit log of the
organization entered records the switch. A password session cannot switch into an organization that requires single
sign-on: sign in to it with **Sign in with SSO** instead. With single sign-on, a person of another
organization signing in through your provider joins yours automatically when the domain of their
address is [verified](#single-sign-on) for your organization.

**Change a role** with the role menu next to a member. The role is the one they hold here; a role
they hold in another organization is that organization's. The last owner cannot be demoted.

**Remove a member** with the bin icon. They leave this organization: their API keys, project
seats and preferences here go with them, and if this was the organization they were acting in,
they find themselves in another of theirs at their next request. The account itself — with its
second factor — is deleted only when this was their last organization. What they made (projects,
tests, API tests, plans, schedules, step groups, environments and their secrets) stays in the
organization and is handed to another member: you, unless you choose someone else in the dialog.
An owner removing themselves hands it to another owner. The audit log keeps their name and records
who took over.

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
Member management is **session-only**: with an API key, inviting, adding, changing roles and removing members, creating or revoking API keys and service accounts, and the SSO and MFA settings answer `403` (`session_required`). Use the signed-in session (cookie) of an owner:

| Action                          | Request                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| List members                    | `GET /api/organization`                                                                                                        |
| Invite                          | `POST /api/organization/invitations` with `{"username":"maria.rossi","role":"editor"}`; the answer holds the token, once       |
| Pending invitations, revoke one | `GET /api/organization/invitations`, `DELETE /api/organization/invitations/<id>`                                               |
| Register with an invitation     | `POST /api/register` with `{"username","password","invitationToken"}`                                                          |
| Join with an existing account   | Signed in: `GET /api/invitations/preview?token=…`, then `POST /api/invitations/accept` with `{"token"}` (sessions only)        |
| One's organizations, switching  | `GET /api/organizations/mine`; `POST /api/organizations/switch` with `{"organizationId"}` (sessions only; a key cannot switch) |
| Change a role                   | `PATCH /api/organization/members/<userId>` with `{"role":"owner"}`                                                             |
| Remove                          | `DELETE /api/organization/members/<userId>`, optionally with `{"transferTo":<userId>}`                                         |
| Password reset link             | `POST /api/organization/members/<userId>/password-reset`; the answer holds the token, once. The link is `/auth?reset=<token>`  |
| Reset the second factor         | `DELETE /api/organization/members/<userId>/mfa`                                                                                |
| :::                             |

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

## Single sign-on _(owners)_ {#single-sign-on}

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

| Provider           | Issuer                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| Microsoft Entra ID | `https://login.microsoftonline.com/{tenant-id}/v2.0`                   |
| Google Workspace   | `https://accounts.google.com`                                          |
| Okta               | `https://{your-domain}.okta.com` (or an authorization server under it) |
| Keycloak           | `https://{host}/realms/{realm}`                                        |

The client secret is stored encrypted and never shown again; leave the field empty to keep it
when changing something else. Each domain belongs to one organization on the installation.

**Setting up SAML 2.0.** Protocol **SAML 2.0**. The card shows what to give your provider; every
organization is its own service provider:

| WebFlowMaster value                                       | Where it goes at the provider                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Entity ID** `…/api/sso/saml/{organization}`             | Identifier / Audience / _Relying party identifier_ / Keycloak _Client ID_                                |
| **ACS URL** `…/api/sso/saml/{organization}/acs`           | Reply URL / _Assertion Consumer Service_, binding **HTTP-POST**                                          |
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

| Provider           | Where to find the metadata                                          |
| ------------------ | ------------------------------------------------------------------- |
| Microsoft Entra ID | Enterprise application → Single sign-on → _Federation Metadata XML_ |
| Okta               | Application → Sign On → _Identity Provider metadata_                |
| ADFS               | `https://{host}/FederationMetadata/2007-06/FederationMetadata.xml`  |
| Keycloak           | `https://{host}/realms/{realm}/protocol/saml/descriptor`            |

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
  linked to it; this is how members who already had a password move over. An organization
  owner, or an account with a second factor on, is never linked this way: the sign-in is refused
  (`sso.link_refused` in the audit log) and the person signs in with their password first. The
  same holds for an account that belongs to another organization: a password set there never
  proved the mailbox (an invitation accepts any username), so the address alone does not hand it
  to this organization, even on a verified domain;
- otherwise an account is **created**, with the address as its username and the role you
  chose — or the role its groups map to, below. Without a group mapped to owner, owners are
  never created this way: make someone an owner in **Settings → Members**.

With OpenID Connect the address comes from the `email` claim, and the token must carry
`email_verified: true`. Entra ID sends neither `email_verified` nor always `email`, so for it the
provider setting `trustUnverifiedEmail` (API field of `PUT /api/organization/sso`, default
`false`) accepts an absent `email_verified` and falls back to an address-shaped
`preferred_username`; an address marked `false` is always refused. Providers saved with a
Microsoft issuer before this setting existed have it switched on by the migration; turn it on
only for providers whose addresses you cannot otherwise rely on being yours, with domain
verification kept on. With SAML it comes from the attributes listed above or an
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

| Provider           | What to send                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Microsoft Entra ID | App registration → Token configuration → _Add groups claim_. The `groups` claim carries the groups' **object IDs**: map those, not the names. Over 200 groups Entra sends a link instead of the list; assign the groups to the application to stay under it. |
| Okta               | Authorization server → Claims → a `groups` claim with a filter (e.g. _Starts with_ `wfm-`). For SAML, a group attribute statement.                                                                                                                           |
| Keycloak           | Client scope → Mapper _Group Membership_, token claim name `groups`, _Full group path_ off. For SAML, the _Group list_ mapper.                                                                                                                               |
| ADFS               | A claim rule sending _Token-Groups – Unqualified Names_ as an attribute (e.g. `groups`).                                                                                                                                                                     |

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

By default (`SSO_REQUIRE_DOMAIN_VERIFICATION` unset or `true`) a domain routes no sign-in until it is proven, and an unproven claim does not
hold it: another organization that adds the domain takes it over, and whoever proves it first
keeps it. `SSO_REQUIRE_DOMAIN_VERIFICATION=false` is an explicit opt-out under which domains work
as soon as they are saved; it is unsafe on an installation shared by several organizations and
suits only one with a single organization. Usernames are unique regardless of case.

**Provisioning with SCIM.** Single sign-on learns about people when they sign in. With SCIM
2.0 the provider tells WebFlowMaster as soon as something changes there: it creates accounts,
deactivates and removes them, and pushes its groups. Under **Provisioning (SCIM)**, press **Issue a
token** and give the provider the **SCIM base URL** (`<your address>/api/scim/v2`) and the token,
which is shown once; **Replace the token** ends the old one at once, **Revoke** ends provisioning.
Single sign-on must be set up first: provisioned accounts have no password and sign in through
the provider, which links them by address at the first sign-in.

| Provider                                                      | Where                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft Entra ID                                            | Enterprise application → Provisioning → _Automatic_: **Tenant URL** is the base URL, **Secret token** the token. Map `userPrincipalName` (or `mail`) to `userName`; _Provision Microsoft Entra ID Groups_ pushes the groups.    |
| Okta                                                          | The app's _Provisioning_ tab → SCIM 2.0, **Base URL** and _HTTP Header_ authentication with the token; unique identifier `userName` (the e-mail address); turn on _Create_, _Update_ and _Deactivate Users_, and _Push Groups_. |
| Others (OneLogin, JumpCloud, Keycloak with a SCIM extension…) | SCIM 2.0 with a bearer token: the base URL and the token.                                                                                                                                                                       |

What it does here:

- **Users** are the organization's members; `userName` is their e-mail address, in one of the
  single sign-on domains. A new user gets **Role of new accounts**. Members who were here before
  are listed too, so a provider matching by `userName` takes them over instead of creating them
  again.
- **`active: false` deactivates** the account at once: its sessions end at their next request, it
  cannot sign in, and its API keys stop working. **Settings → Members** marks it _deactivated_.
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

Both hold for the organization whose provider opened the session, and only for it. Someone who
belongs to several organizations and switches to another one meets that organization's own rules:
where it requires single sign-on the switch is refused until they sign in through its provider,
and where it requires a second factor they are asked for one.

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
  for it needs `runs:write` and `runs:read`. Traces and HAR files of runs also need
  `runs:evidence`, and the editor role: they can hold passwords in clear.
- **At least one scope is required** when a key is created, and so is an **expiry**: the lifetime
  is chosen at creation (default 90 days in the form) and cannot exceed `API_KEY_MAX_TTL_DAYS`
  (365 by default).
- Keys created before this rule, with no scopes or no expiry, keep working and are listed as
  **legacy, full access** / **no expiry (legacy)**. They act as their account everywhere; replace
  them with scoped, expiring keys and revoke the old ones.
- An API key cannot create or revoke keys or service accounts, manage members and roles, or change
  SSO and MFA settings: those need a signed-in session.
- Its last use is shown, so unused keys can be found.
- The key is shown **once**. It is stored as a hash and cannot be recovered; a lost key is
  revoked and replaced.
- The role of the key's account still applies: a viewer's key cannot start runs.

A key belongs to its account. When the pipeline must not depend on one person, an owner creates
a **service account**: an account that cannot sign in, has its own role (viewer or editor),
and holds keys. Disabling the service account revokes all its keys at once.

Owners see and can revoke every key in the organization.

## Integrations

| What                                           | Where                                                                                                          | Who     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| Starting plans from CI                         | API keys and the `wfm` CLI; see [CI integration](../integrations/ci)                                           | Editors |
| Webhooks that start a plan                     | The plan's settings; each has its own token                                                                    | Editors |
| Issue trackers (Jira, Azure DevOps)            | **Settings → Issue trackers**                                                                                  | Editors |
| Test management (TestRail, Xray, Zephyr Scale) | **Settings → Test management**; see [Publishing to TestRail, Xray or Zephyr](../guide/results#test-management) | Editors |
| Commit statuses on GitHub and GitLab           | **Settings → GitHub & GitLab**; shows the last delivery error                                                  | Owners  |
| Local agents                                   | **Settings → Local agents**; see [Local agents](../integrations/local-agents)                                  | Owners  |

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

## Runners _(owners)_

**Settings → Runners** lists the worker machines of the installation: online, draining or
offline, what they are running and which version they are on.

**Drain** a runner before maintenance: it finishes what it has and takes nothing new. **Resume**
puts it back. Runners serve every organization on the installation, so only its
[administrators](#installation-administrators) can drain or resume one; other owners see the
list without the buttons.

## Run usage and limits

**Settings → Run usage** shows the organization's runs in progress and waiting, against its
limits, and how many runners are online. A run that stays _queued_ is usually explained here:
the organization is at its limit, or no runner is online.

The limits are set by the installation's operator, not by owners (see
[Capacity and limits](./operations#capacity-and-limits)).

## Audit log _(owners)_ {#audit-log}

**Settings → Audit log** records who did what and when: sign-ins and failed sign-ins, members
and invitations, keys and service accounts, tests, plans, schedules, suites, projects and their
access, reviews and publications, quarantine, environments and secrets, agents, GitHub/GitLab
connections, runners, two-factor changes, cancelled runs and system settings.

Each entry has the actor, the action, the target, the client's IP address and, for requests
made with a key, which key. It can be filtered by category, action, person and dates, and
exported as CSV (up to 10,000 entries per export; narrow the dates for more).

The log cannot be changed or deleted from the application: the database grants it only
reading and adding. It is removed only when the whole organization is erased.

## System settings _(owners)_

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

## Export and erasure _(owners)_

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

Owners configure **Settings → Security → Organization email** independently for each organization. Choose installation defaults (`SMTP_URL` and `SMTP_FROM`), custom SMTP, or disabled sending. Custom SMTP requires a host, port and sender; credentials remain write-only. Blank password/secret fields retain stored values; explicit clear controls remove them. Secrets are encrypted using `ENCRYPTION_KEY`. Editors and viewers cannot read or change this configuration. Concurrent edits return a conflict: reload explicitly to discard the preserved draft.

Custom SMTP always uses STARTTLS or implicit TLS with certificate verification. With `WFM_EGRESS_PROXY` configured, SMTP uses its mandatory HTTP CONNECT route. The operator must allowlist the SMTP destination and port (typically 587 or 465) in the proxy policy; changing organization settings does not grant network access. A tenant send failure does not fall back to another sender. See [Configuration](./configuration).

Sending covers invitations and owner-issued password reset links, forgotten-password requests, and plan/user run notifications. Owners can still hand over the once-visible invitation/reset link when email is disabled or fails. Forgotten-password responses do not reveal whether an account exists. A mail failure never changes a run result.

### Delivery providers

Select a provider, fill its required fields and save before copying the organization's callback URL, `https://your-public-host/api/mail-deliveries/providers/<callbackId>`. Use your public HTTPS deployment origin. The opaque URL selects the organization; the provider signature authenticates each request. Rotate it only deliberately: the old URL immediately becomes invalid, including outstanding events, so update the provider configuration afterwards.

| Provider              | Configuration and correlation                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amazon SES / SNS      | Set the exact SNS topic ARN. Configure SES delivery and bounce notifications to that topic, **enable original headers**, and subscribe the callback as an HTTPS endpoint. Signed subscription confirmation is supported. Notifications must preserve `X-Wfm-Delivery-Id` in the original headers. |
| SendGrid              | Enable signed Event Webhooks for delivered, deferred and bounce events, point them to the callback and paste the public verification key into settings. WebFlowMaster adds `wfm_delivery_id` through SMTP `X-SMTPAPI` unique arguments.                                                           |
| Mailgun               | Configure delivered and failed webhooks to the callback. Save the webhook signing key, rather than the API key (at least 32 characters). WebFlowMaster supplies `wfm_delivery_id` through `X-Mailgun-Variables`.                                                                                  |
| Generic signed events | Save a secret of at least 32 characters and have an adapter normalize your provider's events to the contract below.                                                                                                                                                                               |
| No confirmed tracking | SMTP acceptance/rejection is recorded; no delivery confirmation is inferred.                                                                                                                                                                                                                      |

SES, SendGrid and Mailgun accept native events without an external adapter. Generic events require normalized JSON:

```json
{
  "eventId": "provider-event-123",
  "messageId": "e3dab9f5-d6c4-4a74-af2e-a665498b18cd",
  "status": "hard_bounce"
}
```

`status` is `delivered`, `soft_bounce` or `hard_bounce`. Set `X-Wfm-Mail-Timestamp` to Unix seconds and `X-Wfm-Mail-Signature` to hex HMAC-SHA256 of `timestamp.eventId.messageId.status` using the organization secret. Timestamps must be within five minutes. The existing installation endpoint `/api/mail-deliveries/events` and `MAIL_DELIVERY_WEBHOOK_SECRET` remain compatible for installation integrations.

Owners inspect the latest 100 messages in **Email delivery**. **Accepted by SMTP** is distinct from **Delivered**. Authenticated events record temporary/permanent bounces; hard bounces suppress later sends to the same address within that organization. Duplicate events are idempotent and delayed events cannot undo a hard bounce. History stores recipient, purpose, state and timestamps, never bodies or reset/invitation tokens. A valid event for a foreign organization cannot update its history. Provider fixture tests do not establish delivery through a real provider account.

### Template editor

In **Email templates**, choose invitation, password reset or run notification and edit the subject, complete HTML source and plain-text alternative. The editor lists each purpose's supported `{{variable}}` names. Unknown variables and invalid subjects are rejected; invitation/reset templates must retain their action URL in both HTML and text. Dynamic values are escaped and HTML is sanitized with an explicit allowlist.

**Preview** uses synthetic data and links in a sandboxed iframe with scripts and external resource loading disabled; it sends no message. Save to persist an organization override, or reset to the built-in template. Stale revisions preserve the draft and require an explicit reload. Switching message purpose or organization clears drafts and previews. Overrides apply consistently to account emails and worker notifications; other messages retain their built-in behavior. See [Administration acceptance](https://github.com/Markg981/WebFlowMaster/blob/main/docs/acceptance/administration-acceptance.md).

## Password policy {#password-policy}

`PASSWORD_POLICY` decides what a new password must be, when it is chosen (registration, change,
reset link); existing passwords are not checked.

- `basic` (default): 8 to 128 characters, not the username.
- `strong`: at least 12 characters; at least three of lowercase, uppercase, digits and symbols;
  not containing the username (or the part of an address before the @); not one of the passwords
  every guessing list starts with.

## Quotas and consumption {#quotas}

**Settings → Run usage** shows running/queued plans, saved tests, retained artifact bytes and
execution minutes in the UTC calendar month. Quotas work without payment: a plan
([Billing](#billing)) can carry them, but nothing here charges anyone.
For free unlimited local use set `TENANT_QUOTA_MODE=off`. `monitor` measures without refusing
operations; `enforce` applies limits. The default is `enforce`, preserving existing concurrency
and queue behavior, with all new limits unlimited. Administrators can override mode per tenant.

| Limit              | Environment default                   | Meaning                                                                               |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------- |
| Concurrent plans   | `ORG_MAX_CONCURRENT_RUNS=2`           | Further plans wait; positive integer                                                  |
| Queued plans       | `ORG_MAX_QUEUED_RUNS=100`             | Excess submissions receive HTTP 429; positive integer                                 |
| Saved tests        | `ORG_MAX_TESTS=0`                     | UI/BDD, API and mobile definitions, including archived tests                          |
| Retained artifacts | `ORG_MAX_ARTIFACT_BYTES=0`            | Evidence, baselines and inline mobile screenshots, in bytes                           |
| Monthly execution  | `ORG_MAX_MONTHLY_EXECUTION_MINUTES=0` | Occupancy time, including direct browser/API/mobile work and additional shard workers |

Zero means unlimited for the three new limits. **Inherit** clears an override and uses the plan's
limit, or the installation default where the plan has none: an administrator's override wins over
the plan, and the plan over the default, both in the application and in the database triggers. In `off`, enforcement and execution metering are disabled; test counts and
artifact bookkeeping remain available. Worker capacity, timeouts, rate limits and access controls
retain their own configuration. Set identical defaults on web/workers and restart after changes.

Installation administrators use **Quota administration** to search organizations and edit quotas.
Ordinary tenant owners and service accounts cannot administer installation quotas; the existing
single-organization owner fallback remains. Updates record actor, old/new values and revision in
the target tenant's audit. Concurrent edits return HTTP 409: refresh explicitly before saving.

Run **Reconcile artifacts** before saving a finite enforcing storage cap. Until successful initial
inventory, storage is unmeasured, rather than zero. Ambiguous storage failures retain reserved bytes:
repair connectivity and reconcile. Failed scans preserve the previous inventory. Retention/deletion
releases capacity after physical removal. Local/S3 share accounting rules; active/incomplete staging
is excluded and remains an operational disk concern. Mobile screenshots count stored base64 bytes.

Lowering limits preserves data and running work. New tests/imports are refused at the cap; editing
and deletion remain possible. Minutes are an admission budget, not CPU/RAM or a shutdown threshold:
admitted work can finish beyond the cap; queued plans wait for capacity or the next UTC month.
Lost heartbeats bound orphan metering to two minutes after the last heartbeat. Removing history does
not erase consumption. Omitted evidence is reported separately from the verdict, preserving previous
evidence. These quota controls never charge anyone: what a plan costs, and what happens when it
is not paid, is the next section's.

API: `GET /api/admin/organization-quotas`, `PATCH /api/admin/organization-quotas/:id` with
`{ "revision": 1, "overrides": { "mode": "off", "maxTests": null } }`, and
`POST /api/admin/organization-quotas/:id/reconcile-artifacts`. Tenant usage:
`GET /api/organization/usage`. Quota refusals return HTTP 429 with `test_quota_exceeded` or
`execution_quota_exceeded`. See [acceptance procedures](https://github.com/Markg981/WebFlowMaster/blob/main/docs/acceptance/administration-acceptance.md).

## Billing {#billing}

Every organization has exactly one subscription to one plan. Plans are the installation's
(`billing_plans`): a code, a name, a monthly and a yearly price in minor units with a currency,
optional trial days, whether it is offered, and the quotas it includes — the same five limits as
above; a plan that leaves one empty inherits the installation default. Migration 0087 seeds a
`free` plan with no limits of its own and puts every existing organization on it, `active`, so an
installation that never looks at this section behaves exactly as before. A new organization gets
the same by a database trigger.

A subscription has one of five statuses:

| Status      | Meaning                                                                                             | Starting runs                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `trialing`  | A trial until `trialEndsAt`.                                                                        | Allowed                                                                                  |
| `active`    | Paid, or free.                                                                                      | Allowed                                                                                  |
| `past_due`  | A payment failed, or a hand-set trial ran out.                                                      | Allowed for `BILLING_PAST_DUE_GRACE_DAYS` (7) from when it became past due, then refused |
| `suspended` | Overdue beyond the grace, unpaid at the provider, or suspended by hand with a reason.               | Refused                                                                                  |
| `cancelled` | The subscription ended and the catalogue offers no free plan to fall back to, or cancelled by hand. | Refused                                                                                  |

"Refused" means exactly this: starting a plan run (web, API, schedule, webhook, CLI, replay), a
load test, a direct browser, API or mobile execution, or a recording answers **402
`subscription_suspended`**. The check sits at the three places work starts — the run
orchestrator, the load-test start and the execution metering every direct execution passes through
— not in each route. Reading reports and evidence, exporting, every settings page and signing in
keep working: a suspended organization keeps its data and its way out. Every member sees a banner
above every page while runs are refused or about to be; owners see the detail under **Settings →
Billing**: the plan, its status, the current period, and usage against what the plan includes.

Twice a day a sweep moves `past_due` subscriptions past their grace to `suspended`, and ends trials
set by hand (they become `past_due`, so the administrator — or a payment — has the grace period to
act). Trials the provider holds are ended by the provider's own messages.

**Manual mode** (`BILLING_PROVIDER=none`, the default, and what a self-hosted installation wants):
the installation administrator (see [above](#installation-administrators)) manages plans and
subscriptions under **Settings → Billing → Billing administration**, or with
`GET/POST /api/installation/billing/plans`, `PATCH /api/installation/billing/plans/:code`,
`GET /api/installation/billing/organizations` and
`PATCH /api/installation/billing/organizations/:id` with
`{ "planCode", "status", "suspendedReason", "trialEndsAt" }`. The organization's own card says
that billing is managed by the installation administrator; there is nobody to pay through.

**Stripe mode** (`BILLING_PROVIDER=stripe`): set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
`BILLING_PUBLIC_BASE_URL` (or `WEBFLOW_PUBLIC_URL`); the server refuses to start with any of them
missing. In Stripe, create a recurring price per plan and interval and put their ids on the plan
(`providerPriceIds: { "month": "price_…", "year": "price_…" }`); a plan without a price for an
interval is not sold for it. Register a webhook endpoint at
`https://<your address>/api/billing/webhooks/stripe` for the events `checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and
`invoice.payment_failed`, and copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Owners then
**Change plan** (a Stripe Checkout session, `POST /api/billing/checkout` with
`{ "planCode", "interval" }`) and **Manage billing** (the Stripe customer portal,
`POST /api/billing/portal`). The organization travels on Stripe's objects as `client_reference_id`
and metadata, so every later message says whose it is. Statuses map as Stripe's `trialing`,
`active` → the same; `past_due`, `incomplete` → `past_due`; `unpaid`, `paused` → `suspended`;
`canceled`, `incomplete_expired` → `cancelled`, which returns the organization to the `free` plan
while the catalogue still offers one. A failed invoice makes the subscription `past_due`; a paid
one makes it `active` again. The installation administrator can still move any subscription by
hand; cancelling one Stripe holds cancels it at Stripe too.

The webhook is public, like every webhook, and believes nothing that `STRIPE_WEBHOOK_SECRET` does
not sign: the `Stripe-Signature` header's HMAC-SHA256 over the timestamp and the raw body, within
five minutes. The secret is as sensitive as a password — whoever holds it can suspend or restore
any organization — so keep it in the environment, never in a plan or a page, and rotate it from
Stripe's dashboard (several signatures are accepted during a rotation). Every accepted message and
every manual or scheduled change is written once to `billing_events` under an idempotency key
(the provider's event id), so a replayed message changes nothing, and to the organization's audit
log as `organization.billing_updated`.

Tenant endpoints: `GET /api/billing` (any member), `GET /api/billing/plans`,
`POST /api/billing/checkout` and `POST /api/billing/portal` (owners, Stripe only). The public API
offers `GET /api/v1/billing` with the `billing:read` scope. Nothing here has been exercised against
a live Stripe account in this repository's acceptance record: the Stripe adapter is covered by
recorded event fixtures and signed requests, and a real account run remains separate evidence.

## Known limitations

- Without SCIM, single sign-on reads roles from groups only at sign-in: a change at the provider
  reaches WebFlowMaster at the person's next sign-in, and sessions already open keep their role
  until then. SCIM supports `eq` filters on one attribute, no bulk operations and no sorting, and
  keeps the address, the active flag and the external ID of a user (names and other attributes are
  accepted and ignored).
- SAML single logout requires a configured SP RSA key pair and signed protocol messages; provider
  compatibility must be verified before enabling it. IdP-initiated sign-in lacks request/browser binding.
- SMTP acceptance alone cannot confirm delivery. Enable authenticated provider callbacks for delivery/bounce tracking.
- Billing covers subscription plans with included quotas, in manual mode and through Stripe
  (checkout, portal, webhooks). Metered usage billing — charging per minute or per test beyond the
  plan — is not implemented: quotas refuse work past the limit, they do not price it. The Stripe
  adapter has been verified against recorded event fixtures, not against a live account.
