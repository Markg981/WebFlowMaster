import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ROLES } from './model.mjs';

const path = '.github/workflows/release.yml';
// Normalize CRLF so the multi-line regexes also pass on a Windows checkout with core.autocrlf.
const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const workflow = parse(source);
const jobs = workflow.jobs;
const steps = (job) => jobs[job].steps;
const runs = (job) =>
  steps(job)
    .map((step) => step.run ?? '')
    .join('\n');

test('every action is pinned by full commit with its version in a comment', () => {
  const uses = source.match(/^\s+(?:- )?uses: .+$/gm);
  assert.ok(uses?.length >= 10);
  for (const line of uses) assert.match(line, /@[a-f0-9]{40} # v\d+\.\d+\.\d+$/);
});

test('release publication is tag-triggered and signs with the token of the promote job only', () => {
  assert.deepEqual(workflow.on.push, { tags: ['v*'] });
  assert.match(jobs.promote.if, /github\.event_name == 'push' && github\.ref_type == 'tag'/);
  assert.equal(workflow.permissions['id-token'], undefined);
  for (const [name, job] of Object.entries(jobs))
    assert.equal(job.permissions?.['id-token'], name === 'promote' ? 'write' : undefined, name);
  assert.equal(jobs.promote.permissions.contents, 'read');
});

test('the rollback contract gates every build and a tag also checks its minimum release', () => {
  const index = steps('validate').findIndex((step) =>
    step.run?.includes('compatibility.mjs check'),
  );
  assert.ok(index > 0, 'compatibility gate missing');
  const gate = steps('validate')[index];
  assert.equal(gate.if, undefined);
  assert.match(gate.env.VERSION, /github\.ref_type == 'tag' && steps\.prepare\.outputs\.version/);
  assert.match(gate.run, /release-artifacts\/data-compatibility\.json/);
  const install = steps('validate').findIndex((step) => step.name === 'Install dependencies');
  assert.ok(index < install, 'the gate runs before any dependency is installed');
  assert.ok(workflow.on.pull_request.paths.includes('deployment/releases/**'));
  assert.ok(workflow.on.pull_request.paths.includes('shared/**'));
});

test('promote job signs every pushed image by digest after publication and before upload', () => {
  const roles = jobs.promote.strategy.matrix.include.map((entry) => entry.role);
  assert.deepEqual(roles, ROLES);
  const names = steps('promote').map((step) => step.name ?? step.uses);
  const index = (pattern) => names.findIndex((name) => pattern.test(name));
  const publish = index(/^Promote the scanned archive/);
  const installer = index(/^sigstore\/cosign-installer@/);
  const sign = index(/^Sign the published digest/);
  const verify = index(/^Verify the signature and attestations/);
  const upload = index(/^actions\/upload-artifact@/);
  assert.ok(publish >= 0 && publish < installer && installer < sign && sign < verify);
  assert.ok(verify < upload);
  const installed = steps('promote')[installer];
  assert.match(installed.with['cosign-release'], /^v\d+\.\d+\.\d+$/);
  const signing = steps('promote')[sign];
  assert.match(
    signing.run,
    /reference=\$\(node -p "require\('\.\/\$base\/published\.json'\)\.reference"\)/,
  );
  assert.match(signing.run, /^cosign sign "\$reference"/m);
  assert.match(
    signing.run,
    /^cosign attest --type cyclonedx --predicate "\$base\/sbom\.cdx\.json" "\$reference"/m,
  );
  assert.match(
    signing.run,
    /^cosign attest --type slsaprovenance1 --predicate "\$base\/provenance\.json" "\$reference"/m,
  );
  assert.doesNotMatch(signing.run, /--key\b|cosign attach/);
  assert.equal(signing.env.COSIGN_YES, 'true');
  assert.equal(
    signing.env.CERTIFICATE_IDENTITY,
    '${{ github.server_url }}/${{ github.repository }}/.github/workflows/release.yml@${{ github.ref }}',
  );
  assert.equal(signing.env.CERTIFICATE_OIDC_ISSUER, 'https://token.actions.githubusercontent.com');
});

test('signatures and both attestations are verified against the workflow identity and recorded', () => {
  const step = steps('promote').find((entry) => /^Verify the signature/.test(entry.name ?? ''));
  for (const flag of [
    '--certificate-identity "$CERTIFICATE_IDENTITY"',
    '--certificate-oidc-issuer "$CERTIFICATE_OIDC_ISSUER"',
  ])
    assert.ok(step.run.includes(flag), flag);
  assert.match(
    step.run,
    /^cosign verify .* --output json "\$reference" > "\$base\/cosign-verify\.json"/m,
  );
  assert.match(
    step.run,
    /for type in cyclonedx slsaprovenance1; do\n\s*cosign verify-attestation --type "\$type"/,
  );
  assert.match(step.run, /tlog entry created with index: \(\\d\+\)/);
  assert.match(step.run, /published\.signing = \{/);
  for (const key of [
    "method: 'sigstore-keyless'",
    'rekorLogIndex: signatureIndex',
    "attestation('cyclonedx', 'https://cyclonedx.org/bom')",
    "attestation('slsaprovenance1', 'https://slsa.dev/provenance/v1')",
    'verify: `cosign verify ${identity} ${published.reference}`',
  ])
    assert.ok(step.run.includes(key), key);
  const upload = steps('promote').find((entry) =>
    /^actions\/upload-artifact@/.test(entry.uses ?? ''),
  );
  assert.match(upload.with.path, /published\.json\n.*provenance\.json/);
});

test('release manifest fails closed without signing evidence and ships the provenance predicate', () => {
  const manifest = runs('release-manifest');
  assert.match(manifest, /\{published,provenance\}\.json/);
  assert.match(manifest, /signing\?\.method !== 'sigstore-keyless'/);
  assert.match(
    manifest,
    /signing\?\.attestations\?\.cyclonedx, signing\?\.attestations\?\.slsaprovenance1/,
  );
  assert.match(
    manifest,
    /for file in sbom\.cdx\.json scan\.json scanner\.json provenance\.json; do/,
  );
  assert.match(manifest, /signed keyless with cosign/);
});

test('BuildKit attestations stay off on both clean builds; signing happens on the published digest', () => {
  const builds = steps('build-and-scan').filter((step) =>
    /^docker\/build-push-action@/.test(step.uses ?? ''),
  );
  assert.equal(builds.length, 2);
  for (const build of builds) {
    assert.equal(build.with.provenance, false);
    assert.equal(build.with.sbom, false);
    assert.match(build.with.outputs, /^type=docker,dest=/);
  }
  assert.match(
    source,
    /# provenance\/sbom stay off on both builds: .*\n(?:\s*#.*\n)*\s*- name: First clean build/,
  );
});
