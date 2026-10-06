# Reproducible releases

The release workflow builds three application images: API, worker and local agent. It records
the source commit, locked dependencies, base-image digests, migration SQL checksums, SBOMs,
vulnerability reports and registry digests. Deployment consumes these digests instead of rebuilding
source or following a moving tag. The initial target is **Linux amd64**.

## Inputs and reproducibility contract

`Dockerfile`, `Dockerfile.worker` and `Dockerfile.agent` pin the Playwright base by version **and
SHA-256 digest**, matching the root npm lockfile. Application dependencies use `npm ci`.
Lighthouse has a separate committed lockfile in `deployment/lighthouse`; it is no longer installed
globally with a freshly resolved dependency tree. The agent copies the production tree built from
the root lockfile. This increases its dependency footprint; its SBOM and scan include that tree.
The `PLAYWRIGHT_VERSION` agent build argument exists only for the mismatch acceptance fixture:
the release workflow never supplies it.

`deployment/releases/toolchain.json` pins Buildx, BuildKit and Trivy. Workflow actions are pinned
by commit. `SOURCE_DATE_EPOCH` comes from the Git commit timestamp; the exporter rewrites file
timestamps. For each role, two clean builds use the same inputs, platform and arguments. Their
Docker configuration digests must match, including the uncompressed layer content identifiers.
This is the checked reproducibility contract; it does not promise byte-identical external tar
containers or identical advisory databases on different days. External package availability is
still required. A missing registry package fails the build; it never substitutes another version.

Builds remove npm logs/cache and Node bytecode cache in the instruction that creates them; a later cleanup would leave earlier layer content nondeterministic.

The runtime executes as `pwuser`. A container smoke check writes to the runtime directories,
checks the Lighthouse CLI on API/worker, and launches real Chromium. Existing bind mounts and named volumes must be
writable by that user's numeric UID: inspect it with `docker run --rm --entrypoint id IMAGE` and
adjust only the intended artifact directories. New named volumes inherit the image permissions.
Full authenticated product acceptance remains a separate [Collaudo](./test-lab) activity.

## Candidate, security gate and publication

Pull requests touching packaging or application inputs and manual workflow runs build candidates.
They have no registry-write permission. A push of `vX.Y.Z` (or a valid SemVer prerelease) enables
publication only when all of these checks pass:

- The tag equals `package.json` and `package-lock.json` version.
- The tagged commit belongs to `origin/main`.
- The latest GitHub Actions runs named `build-and-test`, `network-on-guarded-installation`,
  `ui-on-real-installation` and `rls-on-real-postgres` succeeded on that exact commit.
- Source-lockfile and all three image vulnerability scans have no HIGH or CRITICAL finding,
  including findings without a fix. Missing/malformed reports fail closed.
- Runtime checks and both independent builds pass for every role.

Trivy generates one CycloneDX JSON SBOM and a complete JSON vulnerability report per image.
The scanner version and database metadata are saved alongside them. Reports retain lower-severity
findings for assessment. There are no default exception files or `ignore-unfixed` flags. If the
gate blocks a release, identify the affected package/base, update a compatible locked version,
review the change and rerun. A temporary exception would require a separately reviewed policy
with owner, expiry and vulnerability IDs; none is implemented here. Scanner DB downloads and
scanner errors also stop publication. A changing advisory database can change eligibility even
when the image itself is unchanged.

The workflow promotes the **scanned archive**, checks its SHA-256 and loaded configuration, and
pushes `ghcr.io/OWNER/REPOSITORY-api`, `-worker`, `-agent` with version and full-commit tags. It
refuses to overwrite a tag with different image content and verifies both tags resolve to the
same digest. `latest` is never written. Matrix promotion is not a registry transaction: a failure
may leave some verified images present. Rerun the same tag to reuse matching content; do not
deploy until the complete release manifest exists.

After promotion, a **draft GitHub release** holds `release-manifest.json`, `release.env`, source
reports and each image's SBOM/report/scanner metadata. Review it before publishing the draft.
Published GitHub releases are not changed by reruns. Candidate evidence is retained 30 days;
large image archives are retained 7 days. Download evidence before expiry. Published release
assets provide the durable distribution record; archive them with the installation inventory.

## Operator procedure

1. Configure repository Actions permissions for GHCR package creation. Restrict `v*` tag creation
   and main changes to authorized maintainers; retain required CI branch checks. Set package
   visibility deliberately. Private packages require a read-only pull credential on deployment hosts.
2. Update root package and lock versions together in a reviewed PR. On Playwright upgrades, update
   all Docker bases to the matching official tag **and verify its registry digest**. Update the
   toolchain and Lighthouse lock through reviewed changes, never through a floating CI override.
3. Merge, wait for the four required checks on the resulting main commit, create and push its
   `vVERSION` tag. If CI is pending or failed, the release must wait; rerun after checks pass.
4. Inspect the draft, reports, rebuild evidence and manifest. Confirm all roles refer to the intended
   commit and migration journal before publishing. Retain the previous release's manifest.
5. Download `release.env` from that verified release. Supply installation secrets and database URLs
   in a protected `installation.env` (never commit it). `MIGRATION_DATABASE_URL` uses the migration
   owner; `DATABASE_URL` uses the non-superuser app role, preserving PostgreSQL RLS.

```sh
docker compose --env-file installation.env --env-file release.env \
  -f deployment/releases/compose.yml config --quiet
docker compose --env-file installation.env --env-file release.env \
  -f deployment/releases/compose.yml pull
# After a verified database/artifact backup and an approved maintenance window:
docker compose --env-file installation.env --env-file release.env \
  -f deployment/releases/compose.yml up -d
```

This application-only Compose file uses external PostgreSQL and Redis/Valkey, shares artifacts
between API and worker, runs the migrator from the exact API image, and exposes API only on
loopback. Configure your HTTPS reverse proxy and required optional settings using the
[installation](./installation) and [configuration](./configuration) guides. TLS, databases,
backup storage and infrastructure images are operator-managed; they are not application release
artifacts. Pin their versions/digests in your installation inventory too. Do not overlay this file
onto the development Compose stack, which has source builds and demonstration credentials.

Run the local agent in the customer's network with the `WFM_AGENT_IMAGE` digest from `release.env`
and its own `WFM_URL`/`WFM_AGENT_TOKEN`; see [agents](../internals/agents). The BDD support image under
`deployment/bdd-agent` is a separate operator example, not a fourth certified release artifact.
If you use it, adapt its base to the verified agent digest, lock its own profile and retain its
separate evidence.

## Upgrade, rollback and evidence

Use a staging installation first. Back up PostgreSQL and artifacts, verify the backup, record
current digests, then apply migrations and start the new API/worker. Verify readiness, login,
queue execution and artifact access. Reconcile the installed digests against the manifest and
record the Collaudo cycle and commit. Never label a candidate build as an installed release.

Rolling back image references does **not** roll back migrations. Only reuse the previous images
if they are compatible with the new schema; otherwise restore the verified pre-upgrade database
and artifacts during a controlled outage. Follow [operations](./operations) and the backup runbook.
No automatic downgrade or zero-downtime migration guarantee is provided.

Local tooling: `npm run test:release` tests packaging and publication guards without a database.
On a clean committed checkout, `GITHUB_REPOSITORY=owner/repository node scripts/release/prepare.mjs`
prepares candidate metadata. Full image rebuild/scan verification runs in the release workflow.
Until the workflow succeeds on a release tag, no registry publication or release certification is
proven by local unit tests.

The timestamp contract follows the official [Docker reproducible-build guidance](https://docs.docker.com/build/ci/github-actions/reproducible-builds/)
and [exporter options](https://docs.docker.com/build/exporters/image-registry/).
See [Trivy filtering](https://trivy.dev/docs/latest/configuration/filtering/) for severity semantics.

## Baseline on 6 October 2026

The diagnostic lockfile scan found 36 HIGH/CRITICAL occurrences: 10 in the root lock, 3 in Lighthouse, 22 in the separate client lock and 1 in video tooling. `deployment/releases/baseline-2026-10-06.json` records IDs, versions, input hashes and scanner metadata. The separate client lock does not govern workspace `npm ci`, but remains part of the inventory of committed lockfiles. Source scanning includes development and tooling dependencies: publication stays blocked until findings in scope are resolved or a different policy is explicitly reviewed. No exception was added. This report does not certify images or replace fresh scans on a release tag.

### Runner capacity

Each role has a separate job. The initial check requires at least 20 GiB free for dual builds, imported images, archives and Trivy databases. Local Docker archives measured about 1.2 GB for API/worker and 952 MB for agent; Trivy cache used 2.8 GB. Sizes vary with dependencies. Increase runner capacity if the check fails; retain scans and comparisons. Actual GitHub runner capacity must be confirmed by the first workflow run.

The required variable template is `deployment/releases/installation.env.example`. Declare additional application settings under `environment` in a Compose override: `--env-file` supplies substitution values; it does not automatically inject every variable into containers.
