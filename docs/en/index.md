# WebFlowMaster documentation

WebFlowMaster is a test automation platform for web applications and HTTP APIs: record or describe
tests, organize them into plans and suites, run them across browsers on a schedule or from CI —
including inside networks the server cannot reach — and report every run in detail.

## Install and administer

For the people who run an installation and the owners of an organization:

- [Installation](./admin/installation) — layouts, Docker Compose, PostgreSQL, secrets, reverse proxy.
- [Operations](./admin/operations) — upgrades, backups, logs, monitoring, troubleshooting.
- [Configuration reference](./admin/configuration) — every environment variable.
- [Administration](./admin/administration) — roles, members, keys, security, audit, data.

## Security and compliance

- [Security overview](./security/) — isolation, identity, encryption, audit, and the current limits.
- [Data protection](./security/data-protection) — what personal data is kept, where, for how long,
  and how it is exported or erased.
- [Hardening checklist](./security/hardening) — what an operator does before and after going live.

## Integrations

- [CI integration](./CI_INTEGRATION) — GitHub Actions, GitLab CI, Jenkins, Azure Pipelines, the CLI,
  and commit statuses.
- [Local agents](./LOCAL_AGENT) — testing applications inside a private network.

## Internals

For the people who build and maintain the product:

- [Architecture overview](./internals/) — processes, stores, technology, main flows.
- [Tenancy and access](./internals/tenancy) · [Run lifecycle](./internals/execution) ·
  [Data model](./internals/data-model) · [Local agents (internals)](./internals/agents) ·
  [Web client](./internals/frontend)
- [Developer guide](./internals/developer-guide) · [Decision records](./internals/decisions) ·
  [Glossary](./internals/glossary)

::: info More guides are on the way
The user guide and the API reference are being rewritten and will appear here.
:::
