# Your first organization with single sign-on

For the administrator who sets up an organization. At the end your colleagues sign in with their
company account, get a role from their groups and lose access when they leave. You need the
**owner** role and an administrator of your identity provider (Microsoft Entra ID, Okta, Google
Workspace, Keycloak, ADFS…) at hand. If WebFlowMaster is not installed yet, start with
[Installation](../admin/installation): the first account registered there becomes the owner of the
first organization.

## 1. Name the organization and secure your own account (5 minutes)

1. **Settings → Account**: change the initial password if someone else gave it to you.
2. **Settings → Security**: set up a second factor with an authenticator app and keep the
   recovery codes somewhere safe. Owners keep password sign-in even when single sign-on is
   required, so this is the account that gets in when the provider is down.
3. Invite a second owner (**Settings → Members**), so the organization never depends on one
   person.

## 2. Connect the identity provider (20 minutes)

OpenID Connect is the shorter path where the provider supports it; SAML 2.0 works the same way
from WebFlowMaster's side ([Single sign-on](../admin/administration#single-sign-on)).

1. **Settings → Security → Single sign-on**, Protocol **OpenID Connect**. Copy the **redirect URI**.
2. At the provider, register a web application with that redirect URI, the scopes
   `openid email profile` and a client secret.
3. Back in WebFlowMaster enter the **issuer**, **client ID**, **client secret**, your **e-mail
   domains** and the **role of new accounts** (viewer is the safe default).
4. **Save**, then **Test the provider**.
5. Sign out and sign in with **Sign in with SSO** using a test account of your company.

## 3. Prove your domains (5 minutes)

Each domain shows a DNS TXT record, `_wfm-verification.<domain>`. Publish it, then press
**Verify**. On a shared installation an unproven domain routes no sign-in, and proving it stops
another organization from claiming it.

## 4. Roles from groups (10 minutes)

Under **Roles from the provider's groups**, map the provider's groups to roles: for example
`wfm-viewers` to viewer, `wfm-testers` to editor, `wfm-admins` to owner. Ask the provider's
administrator to send the groups in the token (with Entra ID, map the groups' object IDs, not their
names). Turn on **Refuse whoever is in none of these groups** to make the groups the gate: removing
someone from the groups at the provider then ends their access here at their next sign-in.

## 5. Require it (2 minutes)

When a test account works end to end, turn on **Require it**. Members other than owners can no
longer sign in with a password, and their open password sessions end. API keys keep working, so
pipelines are not affected.

## 6. Check the audit log (3 minutes)

**Settings → Audit log** shows the settings change, every account created at its first sign-in and
each sign-in with `method: sso` ([Audit log](../admin/administration#audit-log)).

## Next

- Create and remove accounts from the provider as soon as they change: SCIM provisioning, in the
  same card.
- Keep some projects to some people: [Restricted projects](../admin/administration#restricted-projects).
- Pipelines: service accounts and scoped keys ([Your first run from a pipeline](./devops)).
- Usage and limits: [Quotas and consumption](../admin/administration#quotas).
