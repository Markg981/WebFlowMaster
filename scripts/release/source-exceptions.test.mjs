import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateSourceExceptions } from './source-exceptions.mjs';

const policy = JSON.parse(readFileSync('deployment/releases/source-exceptions.json', 'utf8'));
const now = new Date('2026-10-06T12:00:00.000Z');
const finding = () => ({
  VulnerabilityID: 'CVE-2026-93687',
  PkgName: 'braces',
  InstalledVersion: '3.0.3',
  Severity: 'HIGH',
});
const report = () => ({
  SchemaVersion: 2,
  Results: ['package-lock.json', 'client/package-lock.json'].map((Target) => ({
    Target,
    Class: 'lang-pkgs',
    Type: 'npm',
    Vulnerabilities: [finding()],
  })),
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wfm-source-exception-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts/security'), { recursive: true });
  cpSync(
    'scripts/security/apply-braces-patch.cjs',
    join(root, 'scripts/security/apply-braces-patch.cjs'),
  );
  for (const prefix of ['', 'client']) {
    mkdirSync(join(root, prefix, 'node_modules'), { recursive: true });
    cpSync('node_modules/braces', join(root, prefix, 'node_modules/braces'), { recursive: true });
    // Copy only the dependencies needed to exercise this exact installed braces copy.
    for (const name of ['fill-range', 'to-regex-range', 'is-number'])
      cpSync(`node_modules/${name}`, join(root, prefix, 'node_modules', name), { recursive: true });
    writeFileSync(
      join(root, prefix, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/braces': { version: '3.0.3' } },
      }),
    );
  }
  return root;
}
test('accepts only the approved source findings after actual tests of both installed lock trees', (t) => {
  const root = fixture(t),
    original = report(),
    before = structuredClone(original);
  const result = evaluateSourceExceptions(original, { root, policy, now });
  assert.deepEqual(original, before);
  assert.equal(result.evidence.accepted.length, 2);
  assert.equal(result.evidence.mitigations.length, 2);
  for (const proof of result.evidence.mitigations) {
    assert.equal(proof.tests.passed, true);
    assert.deepEqual(proof.tests.methods, ['parse', 'compile', 'expand', 'stringify']);
    assert.equal(proof.tests.maxDepth, 100);
  }
  assert.ok(result.report.Results.every((result) => result.Vulnerabilities.length === 0));
});
test('fails closed on malformed, extended or expired policy', (t) => {
  const root = fixture(t);
  for (const bad of [{}, null, { ...policy, schemaVersion: 2 }, { ...policy, exceptions: [] }])
    assert.throws(() => evaluateSourceExceptions(report(), { root, policy: bad, now }), /policy/i);
  assert.throws(
    () =>
      evaluateSourceExceptions(report(), {
        root,
        policy,
        now: new Date(policy.exceptions[0].expiresAt),
      }),
    /expired/i,
  );
  const altered = structuredClone(policy);
  altered.exceptions[0].expiresAt = '2026-12-06T00:00:00.000Z';
  assert.throws(
    () => evaluateSourceExceptions(report(), { root, policy: altered, now }),
    /policy/i,
  );
});
test('rejects a different advisory, version, target, severity or an available upstream fix', (t) => {
  const root = fixture(t);
  for (const changed of [
    { VulnerabilityID: 'CVE-other' },
    { InstalledVersion: '3.0.4' },
    { PkgName: 'other' },
    { Severity: 'CRITICAL' },
    { FixedVersion: '3.0.4' },
  ]) {
    const scan = report();
    Object.assign(scan.Results[0].Vulnerabilities[0], changed);
    assert.throws(() => evaluateSourceExceptions(scan, { root, policy, now }), /blocked/i);
  }
  for (const target of [
    'Dockerfile',
    'image',
    './package-lock.json',
    'deployment/lighthouse/package-lock.json',
  ]) {
    const scan = report();
    scan.Results[0].Target = target;
    assert.throws(() => evaluateSourceExceptions(scan, { root, policy, now }), /blocked/i);
  }
  for (const classification of [
    { Class: 'os-pkgs' },
    { Type: 'deb' },
    { Class: undefined },
    { Type: undefined },
  ]) {
    const scan = report();
    Object.assign(scan.Results[0], classification);
    assert.throws(() => evaluateSourceExceptions(scan, { root, policy, now }), /blocked/i);
  }
  const scan = report();
  scan.Results[0].Vulnerabilities.push({
    Severity: 'CRITICAL',
    VulnerabilityID: 'CVE-new',
    PkgName: 'other',
    InstalledVersion: '1',
  });
  assert.throws(() => evaluateSourceExceptions(scan, { root, policy, now }), /blocked/i);
});
test('rejects malformed scanner reports rather than hiding findings', (t) => {
  const root = fixture(t);
  for (const scan of [
    {},
    { SchemaVersion: 2, Results: [null] },
    { SchemaVersion: 2, Results: [{ Vulnerabilities: {} }] },
    { SchemaVersion: 2, Results: [{ Vulnerabilities: [{}] }] },
  ])
    assert.throws(
      () => evaluateSourceExceptions(scan, { root, policy, now }),
      /report|severity|result/i,
    );
});
test('rejects tampered patch scripts, unpatched parsers, changed modules and missing client installs', (t) => {
  const root = fixture(t),
    parser = join(root, 'node_modules/braces/lib/parse.js'),
    source = readFileSync(parser, 'utf8');
  writeFileSync(join(root, 'scripts/security/apply-braces-patch.cjs'), '// altered patch');
  assert.throws(() => evaluateSourceExceptions(report(), { root, policy, now }), /patch script/i);
  cpSync(
    'scripts/security/apply-braces-patch.cjs',
    join(root, 'scripts/security/apply-braces-patch.cjs'),
  );
  writeFileSync(
    parser,
    source.replace(
      "      if (depth >= 100) throw new SyntaxError('braces exceeds maximum nesting depth (100)');\n",
      '',
    ),
  );
  assert.throws(() => evaluateSourceExceptions(report(), { root, policy, now }), /parser/i);
  writeFileSync(parser, source + '\n// altered');
  assert.throws(() => evaluateSourceExceptions(report(), { root, policy, now }), /parser/i);
  writeFileSync(parser, source);
  writeFileSync(join(root, 'node_modules/braces/index.js'), 'module.exports={};');
  assert.throws(
    () => evaluateSourceExceptions(report(), { root, policy, now }),
    /mitigation tests/i,
  );
  cpSync('node_modules/braces/index.js', join(root, 'node_modules/braces/index.js'));
  rmSync(join(root, 'client/node_modules/braces'), { recursive: true, force: true });
  assert.throws(
    () => evaluateSourceExceptions(report(), { root, policy, now }),
    /missing.*braces/i,
  );
});
test('enumerates every locked installed braces copy and fails when a nested copy is absent', (t) => {
  const root = fixture(t),
    lock = join(root, 'package-lock.json');
  writeFileSync(
    lock,
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/braces': { version: '3.0.3' },
        'node_modules/tool/node_modules/braces': { version: '3.0.3' },
      },
    }),
  );
  assert.throws(
    () => evaluateSourceExceptions(report(), { root, policy, now }),
    /missing.*braces/i,
  );
  mkdirSync(join(root, 'node_modules/tool/node_modules'), { recursive: true });
  cpSync('node_modules/braces', join(root, 'node_modules/tool/node_modules/braces'), {
    recursive: true,
  });
  assert.equal(
    evaluateSourceExceptions(report(), { root, policy, now }).evidence.mitigations.length,
    3,
  );
});
test('records hashes of original raw report and both lockfiles without trusting unrelated bytes', (t) => {
  const root = fixture(t),
    scan = report(),
    bytes = Buffer.from(JSON.stringify(scan, null, 2));
  const result = evaluateSourceExceptions(scan, { root, policy, now, reportBytes: bytes });
  assert.match(result.evidence.rawReportSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.canonicalReportSha256, undefined);
  assert.deepEqual(
    result.evidence.lockfiles.map((file) => file.path),
    ['package-lock.json', 'client/package-lock.json'],
  );
  for (const file of result.evidence.lockfiles) assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      evaluateSourceExceptions(scan, {
        root,
        policy,
        now,
        reportBytes: JSON.stringify({ ...scan, ArtifactName: 'different' }),
      }),
    /bytes do not match/,
  );
});
