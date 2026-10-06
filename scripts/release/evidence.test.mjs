import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256, ROLES } from './model.mjs';
import { fileHash } from './file-hash.mjs';

const script = resolve('scripts/release/evidence.mjs');
const scanner = JSON.stringify({ Version: '0.75.0', VulnerabilityDB: { Version: 2, UpdatedAt: '2026-10-06T07:00:00Z', DownloadedAt: '2026-10-06T10:00:00Z' } });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wfm-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = join(root, 'release-artifacts');
  mkdirSync(base);
  writeFileSync(join(base, 'metadata.json'), JSON.stringify({ repository: 'Owner/Repo', commit: 'a'.repeat(40), epoch: 1700000000, version: '1.2.3', inputs: { version: '1.2.3', toolchain: { trivy: `aquasec/trivy:0.75.0@sha256:${'f'.repeat(64)}` } } }));
  writeFileSync(join(base, 'source-scan.json'), JSON.stringify({ SchemaVersion: 2, Results: [{ Target: 'package-lock.json' }, { Target: 'deployment/lighthouse/package-lock.json' }, { Target: 'client/package-lock.json' }] }));
  writeFileSync(join(base, 'source-scanner.json'), scanner);
  for (const role of ROLES) {
    mkdirSync(join(base, role));
    for (const [file, value] of Object.entries({ 'sbom.cdx.json': JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'locked-app' }] }), 'scan.json': JSON.stringify({ SchemaVersion: 2, Results: [] }), 'scanner.json': scanner, 'image.tar.gz': 'archive fixture' })) writeFileSync(join(base, role, file), value);
  }
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  return { root, base, run };
}
test('CLI records complete evidence and refuses blocked or empty SBOM inputs', t => {
  const { base, run } = fixture(t);
  const digest = `sha256:${'b'.repeat(64)}`;
  assert.equal(run('record', 'api', digest).status, 0);
  const evidence = JSON.parse(readFileSync(join(base, 'api/evidence.json')));
  assert.equal(evidence.archiveSha256, sha256('archive fixture'));
  writeFileSync(join(base, 'api/scan.json'), JSON.stringify({ SchemaVersion: 2, Results: [{ Vulnerabilities: [{ Severity: 'HIGH' }] }] }));
  assert.notEqual(run('record', 'api', digest).status, 0);
  writeFileSync(join(base, 'worker/sbom.cdx.json'), '{"bomFormat":"CycloneDX","components":[]}');
  assert.notEqual(run('record', 'worker', digest).status, 0);
});
test('final manifest rejects unpublished images and altered distributed evidence', t => {
  const { base, run } = fixture(t);
  const digest = `sha256:${'b'.repeat(64)}`;
  for (const role of ROLES) {
    assert.equal(run('record', role, digest).status, 0);
    const evidence = JSON.parse(readFileSync(join(base, role, 'evidence.json')));
    writeFileSync(join(base, role, 'published.json'), JSON.stringify(evidence));
  }
  assert.notEqual(run('manifest').status, 0);
  for (const role of ROLES) {
    const file = join(base, role, 'published.json');
    const evidence = JSON.parse(readFileSync(file));
    writeFileSync(file, JSON.stringify({ ...evidence, digest, reference: `ghcr.io/owner/repo-${role}@${digest}` }));
  }
  assert.equal(run('manifest').status, 0);
  assert.match(readFileSync(join(base, 'release.env'), 'utf8'), /WFM_AGENT_IMAGE=ghcr.io\/owner\/repo-agent@sha256:/);
  writeFileSync(join(base, 'agent/sbom.cdx.json'), 'altered');
  assert.notEqual(run('manifest').status, 0);
});
test('streaming hash detects changed archive content', async t => {
  const { base } = fixture(t);
  const file = join(base, 'api/image.tar.gz');
  assert.equal(await fileHash(file), sha256('archive fixture'));
  writeFileSync(file, 'altered archive');
  assert.notEqual(await fileHash(file), sha256('archive fixture'));
});
test('image gate rejects the source-only braces exception and source gate needs actual mitigation', t => {
  const { base, run } = fixture(t);
  const path = join(base, 'source-scan.json');
  writeFileSync(path, JSON.stringify({ SchemaVersion: 2, Results: [{ Target: 'package-lock.json', Vulnerabilities: [{ Severity: 'HIGH', VulnerabilityID: 'CVE-2026-93687', PkgName: 'braces', InstalledVersion: '3.0.3' }] }, { Target: 'deployment/lighthouse/package-lock.json' }] }));
  assert.notEqual(run('gate', path).status, 0);
  assert.notEqual(run('source-gate', path).status, 0);
  assert.match(run('source-gate', path).stderr, /source-exceptions.json/);
});
