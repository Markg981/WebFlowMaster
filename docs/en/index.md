# WebFlowMaster documentation

WebFlowMaster is a test automation platform for web applications and HTTP APIs: record or describe
tests, organize them into plans and suites, run them across browsers on a schedule or from CI —
including inside networks the server cannot reach — and report every run in detail.

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
The installation and administration guide, the security and compliance overview, the user guide and
the API reference are being rewritten and will appear here.
:::
