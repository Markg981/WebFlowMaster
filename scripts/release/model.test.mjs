import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseVersion, assertReleaseChecks, assertScanPassed, assertSourceScanPassed, createManifest, ROLES, REQUIRED_CHECKS, readReleaseInputs, assertPublicationContext, verifyCurrentChecks, assertScannerMetadata } from './model.mjs';
const commit = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const image = { configDigest: digest, sbomSha256: 'c'.repeat(64), scanSha256: 'd'.repeat(64), scannerMetadataSha256: 'e'.repeat(64), archiveSha256: 'f'.repeat(64) };
const valid = () => ({ repository: 'Owner/Repo', commit, epoch: 1700000000, version: 'v1.2.3', inputs: { version: '1.2.3' }, images: Object.fromEntries(ROLES.map(role => [role, { ...image }])) });
test('accepts stable/prerelease tags without accepting shell or leading-zero versions', () => {
  assert.equal(releaseVersion('v1.2.3-rc.1'), '1.2.3-rc.1');
  for (const version of ['1.02.3', '1.2.3-rc.01', 'latest', '1.2.3+build', 'v1.2.3;echo bad', '1.2']) assert.throws(() => releaseVersion(version));
});
test('manifest is deterministic and rejects version mismatch/missing image evidence', () => {
  assert.deepEqual(createManifest(valid()), createManifest(valid()));
  const mismatch = valid(); mismatch.version = '1.2.4'; assert.throws(() => createManifest(mismatch), /version differ/);
  const missing = valid(); delete missing.images.agent; assert.throws(() => createManifest(missing), /agent/);
});
test('immutable image reference must match the role, repository and digest', () => {
  const input = valid(); input.images.api.reference = 'ghcr.io/owner/repo-api:latest';
  assert.throws(() => createManifest(input), /immutable/);
  input.images.api.digest = digest; input.images.api.reference = `ghcr.io/owner/repo-api@${digest}`;
  assert.doesNotThrow(() => createManifest(input));
});
test('checks must all succeed on the exact commit; newer failed reruns supersede success', () => {
  const checks = REQUIRED_CHECKS.map((name, id) => ({ id, name, head_sha: commit, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' }));
  assert.doesNotThrow(() => assertReleaseChecks(checks, commit));
  assert.throws(() => assertReleaseChecks(checks, 'f'.repeat(40)));
  assert.throws(() => assertReleaseChecks([...checks, { ...checks[0], id: 100, conclusion: 'failure' }], commit));
  assert.throws(() => assertReleaseChecks(checks.map(check => ({ ...check, app: { slug: 'other-app' } })), commit));
});
test('scan gate blocks HIGH/CRITICAL including unfixed findings and malformed reports', () => {
  assert.doesNotThrow(() => assertScanPassed({ SchemaVersion: 2, Results: [{ Vulnerabilities: [{ Severity: 'MEDIUM' }] }] }));
  for (const Severity of ['HIGH', 'CRITICAL']) assert.throws(() => assertScanPassed({ SchemaVersion: 2, Results: [{ Vulnerabilities: [{ Severity }] }] }));
  for (const report of [{}, { SchemaVersion: 2 }, { SchemaVersion: 2, Results: [null] }, { SchemaVersion: 2, Results: [{ Vulnerabilities: [{}] }] }, { SchemaVersion: 2, Results: [{ Vulnerabilities: {} }] }]) assert.throws(() => assertScanPassed(report));
});

test('blocked scan diagnostics identify each affected lockfile, package and advisory', () => {
  const report = { SchemaVersion: 2, Results: ['package-lock.json', 'client/package-lock.json'].map(Target => ({ Target, Vulnerabilities: [{ Severity: 'HIGH', PkgName: 'braces', InstalledVersion: '3.0.3', VulnerabilityID: 'CVE-2026-93687' }] })) };
  assert.throws(() => assertSourceScanPassed(report), error =>
    /blocked by 2 HIGH\/CRITICAL/.test(error.message) &&
    /package-lock\.json: braces@3\.0\.3 \[CVE-2026-93687, HIGH\]/.test(error.message) &&
    /client\/package-lock\.json: braces@3\.0\.3 \[CVE-2026-93687, HIGH\]/.test(error.message));
});
test('repository inputs capture ordered journal, all SQL hashes and locked bases', () => {
  const inputs = readReleaseInputs(process.cwd());
  assert.ok(inputs.migrations.length > 80);
  assert.ok(inputs.sqlFiles['migrations/0000_initial_schema.sql'] || Object.keys(inputs.sqlFiles).length >= inputs.migrations.length);
  assert.match(inputs.hashes['package-lock.json'], /^[a-f0-9]{64}$/);
  for (const file of ['deployment/releases/source-exceptions.json', 'scripts/release/source-exceptions.mjs', 'scripts/security/braces.test.mjs']) assert.match(inputs.hashes[file], /^[a-f0-9]{64}$/);
});

test('publication rejects candidates, wrong repositories, versions and commits', () => {
  const metadata = { ...valid(), version: '1.2.3', publish: true };
  const context = { event: 'push', refType: 'tag', refName: 'v1.2.3', commit, repository: 'Owner/Repo' };
  assert.doesNotThrow(() => assertPublicationContext(metadata, context));
  for (const difference of [{ event: 'workflow_dispatch' }, { event: 'pull_request' }, { refType: 'branch' }, { refName: 'v1.2.4' }, { commit: 'f'.repeat(40) }, { repository: 'Other/Repo' }]) assert.throws(() => assertPublicationContext(metadata, { ...context, ...difference }));
  assert.throws(() => assertPublicationContext({ ...metadata, publish: false }, context));
});
test('CI verification fails closed on API errors and reads all pages', async () => {
  const checks = REQUIRED_CHECKS.map((name, id) => ({ id, name, head_sha: commit, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' }));
  let calls = 0;
  await verifyCurrentChecks('Owner/Repo', commit, 'fixture', async () => ({ ok: true, json: async () => ({ check_runs: ++calls === 1 ? Array.from({ length: 100 }, (_, id) => ({ id, name: 'unrelated' })) : checks }) }));
  assert.equal(calls, 2);
  await assert.rejects(verifyCurrentChecks('Owner/Repo', commit, 'fixture', async () => ({ ok: false, status: 403 })), /403/);
  await assert.rejects(verifyCurrentChecks('Owner/Repo', commit, 'fixture', async () => ({ ok: true, json: async () => ({}) })), /Missing/);
});

test('scanner evidence requires the pinned version and actual DB metadata', () => {
  const trivy = `aquasec/trivy:0.75.0@sha256:${'f'.repeat(64)}`;
  const metadata = { Version: '0.75.0', VulnerabilityDB: { Version: 2, UpdatedAt: '2026-10-06T07:00:00Z', DownloadedAt: '2026-10-06T10:00:00Z' } };
  assert.doesNotThrow(() => assertScannerMetadata(metadata, trivy));
  for (const invalid of [{}, { Version: '0.75.0' }, { ...metadata, Version: '0.74.0' }, { ...metadata, VulnerabilityDB: { Version: 2, UpdatedAt: 'bad', DownloadedAt: 'bad' } }]) assert.throws(() => assertScannerMetadata(invalid, trivy));
});

test('source gate refuses a clean report that omitted locked build dependencies', () => {
  assert.throws(() => assertSourceScanPassed({ SchemaVersion: 2, Results: [] }), /coverage/);
  assert.throws(() => assertSourceScanPassed({ SchemaVersion: 2, Results: [{ Target: 'package-lock.json' }] }), /lighthouse/);
  assert.throws(() => assertSourceScanPassed({ SchemaVersion: 2, Results: [{ Target: 'package-lock.json' }, { Target: 'deployment/lighthouse/package-lock.json' }] }), /client/);
  assert.doesNotThrow(() => assertSourceScanPassed({ SchemaVersion: 2, Results: [{ Target: 'package-lock.json' }, { Target: 'deployment/lighthouse/package-lock.json' }, { Target: 'client/package-lock.json' }] }));
});
