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
- All three image scans have no HIGH or CRITICAL finding, including findings without a fix.
  Source-lockfile findings must be resolved or meet the exact approved source exception below.
  Missing/malformed reports, missing source coverage or scanner failures fail closed.
- Runtime checks and both independent builds pass for every role.

Trivy generates one CycloneDX JSON SBOM and a complete JSON vulnerability report per image.
The scanner version and database metadata are saved alongside them. Reports retain lower-severity
findings for assessment. No blanket ignore or `ignore-unfixed` flag is used, and no exception
is accepted: the source-only braces exception was closed in October 2026 (see below). Blocking
findings require a compatible locked update, review and fresh scans. Scanner DB downloads and scanner errors also stop
publication. A changing advisory database can change eligibility even
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

The diagnostic lockfile scan found 36 HIGH/CRITICAL occurrences: 10 in the root lock, 3 in Lighthouse, 22 in the separate client lock and 1 in video tooling. `deployment/releases/baseline-2026-10-06.json` records IDs, versions, input hashes and scanner metadata. The separate client lock does not govern workspace `npm ci`, but remains part of the inventory of committed lockfiles. Source scanning includes development and tooling dependencies: publication stays blocked until findings in scope are resolved or a different policy is explicitly reviewed. No exception was present at that baseline; the subsequently approved source-only exception below is conditional. This report does not certify images or replace fresh scans on a release tag.

### Runner capacity

Each role has a separate job. The initial check requires at least 20 GiB free for dual builds, imported images, archives and Trivy databases. Local Docker archives measured about 1.2 GB for API/worker and 952 MB for agent; Trivy cache used 2.8 GB. Sizes vary with dependencies. Increase runner capacity if the check fails; retain scans and comparisons. Actual GitHub runner capacity must be confirmed by the first workflow run.

The required variable template is `deployment/releases/installation.env.example`. Declare additional application settings under `environment` in a Compose override: `--env-file` supplies substitution values; it does not automatically inject every variable into containers.

## Dependency remediation on 6 October 2026

The next candidate uses digest-pinned Playwright 1.63.0 on Ubuntu 26.04 (Resolute),
Nodemailer 10.0.15 with bundled types, and Lighthouse 13.5.0. proxy-addr,
source-map-js, undici and Vite are updated too. The separate client lock described
an older manifest and is regenerated from the current manifest. Video tooling
also uses corrected source-map-js. The initial baseline remains available for
comparison; it does not describe this candidate's current state.

Production installation uses `npm ci --omit=dev --workspaces=false`: the client is
already compiled during the build and its build tools are unnecessary at runtime.
Final images remove global npm; API, worker, agent and BDD child startup use Node
directly. Install dependencies for external BDD projects in their dedicated
support image, following the BDD runbook, before execution.
The workspace lock can retain orphan transitive dependencies even with workspaces
disabled. `scripts/release/runtime-tools.mjs` removes only fast-glob, micromatch
and braces after proving they are unreachable from production dependencies,
including installed peers and optional dependencies. Missing required packages,
symlinks or external paths fail the build. Image smoke tests cover Chromium,
Firefox and WebKit; required multimedia libraries are preserved rather than
removed to hide operating-system findings.

After the updates, scanning the five lockfiles reported two HIGH occurrences of
**CVE-2026-93687**, both for braces 3.0.3 (root and client locks), with no corrected
upstream release ([upstream issue](https://github.com/micromatch/braces/issues/73)). A
postinstall patch limited the parser depth, under a source-only exception approved until
6 November 2026.

### Closing the braces exception (October 2026)

braces is no longer installed. It arrived only through build and lint tools: Tailwind 3
(chokidar and micromatch), `@typescript-eslint` 7 (globby and fast-glob) and the unused
`@types/jest`. Tailwind 4, `@typescript-eslint` 8 and the removal of `@types/jest` and the
unused `eslint-plugin-vitest` leave no copy in either lock. With it went the postinstall
patch, `deployment/releases/source-exceptions.json` and its evaluator: **no source
exception exists**, and every HIGH or CRITICAL finding in the lockfiles blocks the source
gate like any other. `server/tests/dependency-locks.test.ts` fails if braces or micromatch
return to a lock.

The other production advisories were closed in the same change: `moment` 2.31.0 and
`tedious` 20.3.6 (pinned in `overrides`; it no longer depends on `sprintf-js`).
`npm audit --omit=dev` reports no vulnerabilities.

Tailwind 4 compiles through lightningcss, whose binary is a per-platform optional package.
npm 11 drops those packages from the workspace lock when it rewrites it, which breaks the
Linux build with `Cannot find module ../lightningcss.linux-x64-gnu.node`. `client/package.json`
therefore lists them under `optionalDependencies` at the locked lightningcss version; the same
test checks that both agree whenever Tailwind is updated.

### Base hardening and image evidence

Every build/runtime stage applies `deployment/releases/harden-base.sh`. It installs
the exact Ubuntu security versions `3.5.5-1ubuntu3.7` for libssl3t64, openssl and
openssl-provider-legacy, removes the unused `/usr/bin/pebble` service manager,
and preserves `pwuser` UID/GID 1000 for existing volumes. Global npm is removed
only from final stages. The script removes APT indexes, caches and variable logs
before layer export. If a pinned package disappears from the signed Ubuntu
repositories, the build fails: review a newer fixed version, update the pin and
repeat scans, browser checks and dual builds. Do not silently install latest.

Local scans of API, worker and agent images each report **zero HIGH/CRITICAL**,
down from 31, 31 and 28 respectively. Each role produced equal configuration and
uncompressed layer IDs in two builds without cache; all three browsers ran as
UID/GID 1000. API also passed temporary anonymous-volume writes and a real
Lighthouse 13.5.0 HTTP audit producing JSON and HTML. The AGT-05 mismatch fixture
still builds with Playwright 1.60.0; it is excluded from release images.

`deployment/releases/remediation-2026-10-06.json` records hashes, scanner/database
metadata, image configuration IDs, SBOM component counts and limits. Raw local
reports are under `outputs/security-remediation-2026-10-06/`, excluded from Git.
This evidence uses a frozen candidate snapshot and epoch 1700000000, with local
Buildx 0.37.1 rather than CI 0.37.2. It does not certify the final tag or hosted
workflow. The two remaining source findings require the separate approved exception and its
validation evidence; clean image scans alone do not satisfy those conditions.
