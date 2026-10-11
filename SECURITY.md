# Security policy

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab, then **Report a
vulnerability**. Please do not open a public issue, pull request or discussion for it.

Include what you can of:

- the affected version or commit, and how the installation was deployed (Docker Compose, the
  SaaS network profile, from source);
- the steps or the request that reproduce it, and what an attacker gains (another
  organization's data, a session, code execution, a secret);
- whether you believe it is being exploited.

Test only against an installation you own. Do not access, change or keep other people's data,
and do not degrade a shared service.

## What happens next

| Step | Target |
|---|---|
| Acknowledgement of the report | 3 working days |
| First assessment and severity | 10 working days |
| Fix or mitigation for a critical or high issue | 30 days from the assessment |
| Fix for a moderate or low issue | the next scheduled release |

You are kept informed until the fix is released and credited in the release notes unless you
prefer otherwise. If a target cannot be met, the report is told why and when instead.

## Supported versions

Fixes go into the latest release. Upgrade to it before reporting a problem in an older one
(see the [upgrade procedure](docs/en/admin/operations.md#upgrading)).

## What is in scope

The web process, the queue worker, the local agent and the CLI in this repository, and the
images built from it. Applications under test, browser grids, identity providers and other
third-party services an installation connects to are out of scope, as are findings that need an
operator's own credentials or a configuration the [hardening checklist](docs/en/security/hardening.md)
advises against.

How the product protects tenants, sessions and stored secrets is described in the
[security overview](docs/en/security/index.md); the dependency review history is in
[docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md).
