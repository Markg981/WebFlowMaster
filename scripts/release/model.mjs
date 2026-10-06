import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ROLES = ['api', 'worker', 'agent'];
export const REQUIRED_CHECKS = ['build-and-test', 'network-on-guarded-installation', 'ui-on-real-installation', 'rls-on-real-postgres'];
const DIGEST = /^sha256:[a-f0-9]{64}$/;
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function releaseVersion(value) {
  const version = String(value).replace(/^v/, '');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) throw new Error('Use a SemVer version without build metadata');
  const prerelease = version.split('-').slice(1).join('-');
  if (prerelease.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) throw new Error('Invalid numeric prerelease identifier');
  return version;
}

export function assertReleaseChecks(checks, commit) {
  for (const name of REQUIRED_CHECKS) {
    const matching = checks.filter(check => check.name === name && check.head_sha === commit && check.app?.slug === 'github-actions');
    const latest = matching.sort((a, b) => b.id - a.id)[0];
    if (latest?.status !== 'completed' || latest?.conclusion !== 'success') throw new Error(`Required check ${name} has not succeeded on ${commit}`);
  }
}

export async function verifyCurrentChecks(repository, commit, token, request = fetch) {
  const checks = [];
  for (let page = 1; ; page++) {
    const response = await request(`https://api.github.com/repos/${repository}/commits/${commit}/check-runs?per_page=100&page=${page}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Cannot verify required CI checks: HTTP ${response.status}`);
    const batch = (await response.json()).check_runs;
    if (!Array.isArray(batch)) throw new Error('Missing CI checks');
    checks.push(...batch);
    if (batch.length < 100) break;
  }
  assertReleaseChecks(checks, commit);
}

export function assertPublicationContext(metadata, context) {
  if (!metadata.publish || context.event !== 'push' || context.refType !== 'tag' || context.refName !== `v${metadata.version}` || context.commit !== metadata.commit || context.repository !== metadata.repository) throw new Error('Publication requires the validated version tag, repository and exact commit');
}

export function assertScannerMetadata(scanner, trivyImage) {
  const version = trivyImage?.match(/^aquasec\/trivy:([^@]+)@sha256:[a-f0-9]{64}$/)?.[1];
  const db = scanner?.VulnerabilityDB;
  if (!version || scanner.Version !== version || db?.Version !== 2 || !Number.isFinite(Date.parse(db.UpdatedAt)) || !Number.isFinite(Date.parse(db.DownloadedAt))) throw new Error('Missing scanner version or vulnerability database metadata');
}

export function assertScanPassed(report) {
  if (report?.SchemaVersion !== 2 || !Array.isArray(report.Results)) throw new Error('Missing or unsupported Trivy scan report');
  for (const result of report.Results) {
    if (!result || typeof result !== 'object' || (result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities))) throw new Error('Malformed vulnerability result');
    for (const vulnerability of result.Vulnerabilities ?? []) {
      if (!['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(vulnerability?.Severity)) throw new Error('Malformed vulnerability severity');
    }
  }
  const blocked = report.Results.flatMap(result => result.Vulnerabilities ?? []).filter(v => ['HIGH', 'CRITICAL'].includes(v.Severity));
  if (blocked.length) throw new Error(`Release blocked by ${blocked.length} HIGH/CRITICAL vulnerabilities`);
}

export function assertSourceScanPassed(report) {
  assertScanPassed(report);
  const targets = new Set(report.Results.map(result => result.Target));
  for (const target of ['package-lock.json', 'deployment/lighthouse/package-lock.json']) {
    if (!targets.has(target)) throw new Error(`Missing source scan coverage: ${target}`);
  }
}

export function readReleaseInputs(root) {
  const files = ['package.json', 'package-lock.json', 'Dockerfile', 'Dockerfile.worker', 'Dockerfile.agent', '.dockerignore', 'deployment/lighthouse/package.json', 'deployment/lighthouse/package-lock.json', 'deployment/releases/toolchain.json', 'migrations/meta/_journal.json'];
  const hashes = Object.fromEntries(files.map(file => [file, sha256(readFileSync(join(root, file)))]));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  if (pkg.version !== lock.version) throw new Error('Package and lockfile versions differ');
  const playwright = lock.packages['node_modules/playwright'].version;
  const bases = {};
  for (const [role, file] of [['api', 'Dockerfile'], ['worker', 'Dockerfile.worker'], ['agent', 'Dockerfile.agent']]) {
    const source = readFileSync(join(root, file), 'utf8');
    const refs = [...source.matchAll(/^FROM (\S+)/gm)].map(match => match[1]);
    if (!refs.length || refs.some(ref => !ref.startsWith(`mcr.microsoft.com/playwright:v${playwright}-jammy@`) || !DIGEST.test(ref.split('@')[1]))) throw new Error(`Unpinned or mismatched base in ${file}`);
    if (source.match(/^USER .+$/gm)?.at(-1) !== 'USER pwuser') throw new Error(`Non-root runtime required in ${file}`);
    bases[role] = refs;
  }
  const journal = JSON.parse(readFileSync(join(root, 'migrations/meta/_journal.json'), 'utf8'));
  const migrations = journal.entries.map((entry, index) => {
    if (entry.idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag)) throw new Error('Invalid migration journal');
    const file = `migrations/${entry.tag}.sql`;
    return { index, tag: entry.tag, file, sha256: sha256(readFileSync(join(root, file))) };
  });
  // Extra SQL files are recorded too; the migrator's journal remains the ordered authority.
  const sqlFiles = Object.fromEntries(readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort().map(file => [`migrations/${file}`, sha256(readFileSync(join(root, 'migrations', file)))]));
  return { version: releaseVersion(pkg.version), playwright, hashes, bases, migrations, sqlFiles, toolchain: JSON.parse(readFileSync(join(root, 'deployment/releases/toolchain.json'), 'utf8')) };
}

export function createManifest({ repository, commit, epoch, version, inputs, images }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full Git commit is required');
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error('A commit timestamp is required');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid repository');
  version = releaseVersion(version);
  if (version !== inputs.version) throw new Error('Tag and package version differ');
  for (const role of ROLES) {
    const image = images[role];
    if (!image || !DIGEST.test(image.configDigest) || ['sbomSha256', 'scanSha256', 'scannerMetadataSha256', 'archiveSha256'].some(key => !image[key]?.match(/^[a-f0-9]{64}$/))) throw new Error(`Missing verified image evidence for ${role}`);
    if (image.reference && image.reference !== `ghcr.io/${repository.toLowerCase()}-${role}@${image.digest}`) throw new Error(`Invalid immutable reference for ${role}`);
    if (image.reference && !DIGEST.test(image.digest)) throw new Error(`Invalid registry digest for ${role}`);
  }
  return { schemaVersion: 1, version, commit, sourceDateEpoch: epoch, source: `https://github.com/${repository}`, created: new Date(epoch * 1000).toISOString(), inputs, images };
}
