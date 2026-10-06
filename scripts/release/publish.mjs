import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ROLES, assertScanPassed, createManifest, assertPublicationContext, verifyCurrentChecks, readReleaseInputs } from './model.mjs';
import { fileHash } from './file-hash.mjs';
const role = process.argv[2];
if (!ROLES.includes(role)) throw new Error('Invalid image role');
const metadata = JSON.parse(readFileSync('release-artifacts/metadata.json', 'utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assertPublicationContext(metadata, { event: process.env.GITHUB_EVENT_NAME, refType: process.env.GITHUB_REF_TYPE, refName: process.env.GITHUB_REF_NAME, commit: head, repository: process.env.GITHUB_REPOSITORY });
if (JSON.stringify(readReleaseInputs(process.cwd())) !== JSON.stringify(metadata.inputs)) throw new Error('Release inputs differ from validated commit');
execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
await verifyCurrentChecks(metadata.repository, head, process.env.GITHUB_TOKEN);
const base = `release-artifacts/${role}`;
const evidence = JSON.parse(readFileSync(`${base}/evidence.json`, 'utf8'));
createManifest({ ...metadata, images: Object.fromEntries(ROLES.map(key => [key, evidence])) });
for (const [file, key] of [['image.tar.gz', 'archiveSha256'], ['sbom.cdx.json', 'sbomSha256'], ['scan.json', 'scanSha256'], ['scanner.json', 'scannerMetadataSha256']]) {
  if (await fileHash(`${base}/${file}`) !== evidence[key]) throw new Error(`Altered ${role} evidence: ${file}`);
}
assertScanPassed(JSON.parse(readFileSync(`${base}/scan.json`, 'utf8')));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
docker('load', '--input', `${base}/image.tar.gz`);
const local = `wfm-release-${role}:${metadata.commit}`;
if (docker('image', 'inspect', local, '--format', '{{.Id}}') !== evidence.configDigest) throw new Error('Loaded image differs from scanned image');
const path = `${metadata.repository.toLowerCase()}-${role}`;
const tokenUrl = `https://ghcr.io/token?service=ghcr.io&scope=repository:${path}:pull,push`;
const response = await fetch(tokenUrl, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}`).toString('base64')}` } });
if (!response.ok) throw new Error(`Registry authentication failed: HTTP ${response.status}`);
const { token } = await response.json();
async function existing(tag) {
  const result = await fetch(`https://ghcr.io/v2/${path}/manifests/${tag}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json' } });
  if (result.status === 404) return null;
  if (!result.ok) throw new Error(`Cannot verify registry tag: HTTP ${result.status}`);
  return { digest: result.headers.get('docker-content-digest'), config: (await result.json()).config?.digest };
}
let digest;
for (const tag of [metadata.version, `sha-${metadata.commit}`]) {
  const previous = await existing(tag);
  if (previous && previous.config !== evidence.configDigest) throw new Error(`Refusing to overwrite different image ${path}:${tag}`);
  if (!previous) {
    docker('tag', local, `ghcr.io/${path}:${tag}`);
    docker('push', `ghcr.io/${path}:${tag}`);
  }
  const current = await existing(tag);
  if (current?.config !== evidence.configDigest || !current.digest?.match(/^sha256:[a-f0-9]{64}$/)) throw new Error('Published image verification failed');
  if (digest && digest !== current.digest) throw new Error('Version and commit tags differ');
  digest = current.digest;
}
writeFileSync(`${base}/published.json`, JSON.stringify({ ...evidence, digest, reference: `ghcr.io/${path}@${digest}` }, null, 2) + '\n');
console.log(`Verified ${role}@${digest}`);
