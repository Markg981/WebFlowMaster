import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readReleaseInputs } from './model.mjs';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
/** At least `minimum`, within the same major: a later patch keeps the fix, a new major needs review. */
function atLeastSameMajor(actual, minimum) {
  const [a, m] = [actual, minimum].map(v => v.split('-')[0].split('.').map(Number));
  return a[0] === m[0] && (a[1] > m[1] || (a[1] === m[1] && a[2] >= m[2]));
}
// Exact versions here failed every grouped dependency update that moved one of them a patch.
test('root lock resolves corrected mail, proxy and source-map dependencies', () => {
  const lock = json('package-lock.json').packages;
  for (const [name, minimum] of [['nodemailer', '10.0.15'], ['proxy-addr', '2.0.8'], ['source-map-js', '1.2.2'], ['undici', '6.29.0']]) {
    const version = lock[`node_modules/${name}`].version;
    assert.ok(atLeastSameMajor(version, minimum), `${name} ${version}: expected ${minimum} or a later ${minimum.split('.')[0]}.x`);
  }
  for (const [path, pkg] of Object.entries(lock)) {
    if (path.endsWith('/vite')) assert.ok(!pkg.version.startsWith('5.'), path);
  }
});
test('Lighthouse no longer carries abandoned ZIP extraction dependencies', () => {
  const lock = json('deployment/lighthouse/package-lock.json').packages;
  assert.equal(lock[''].dependencies.lighthouse, '13.5.0');
  assert.ok(!Object.keys(lock).some(path => path.endsWith('/extract-zip')));
});
test('runtime images use Resolute and exclude workspace build tooling and global npm', () => {
  for (const path of ['Dockerfile', 'Dockerfile.worker', 'Dockerfile.agent']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /playwright:v1\.63\.0-resolute@sha256:/);
    assert.match(source, /npm ci --omit=dev --workspaces=false/);
    assert.match(source, /rm -rf \/usr\/lib\/node_modules\/npm/);
  }
});
test('release inputs fingerprint the client manifests', () => {
  const inputs = readReleaseInputs(process.cwd());
  for (const path of ['client/package.json']) {
    assert.ok(inputs.hashes[path], path);
  }
});
test('every base stage applies fixed OS packages and preserves the runtime UID', () => {
  const script = readFileSync('deployment/releases/harden-base.sh', 'utf8');
  assert.match(script, /openssl_version=3\.5\.5-1ubuntu3\.7/);
  assert.match(script, /rm -f \/usr\/bin\/pebble/);
  assert.match(script, /usermod -u 1000 pwuser/);
  assert.doesNotMatch(script, /apt-get (?:dist-)?upgrade/);
  for (const path of ['Dockerfile', 'Dockerfile.worker', 'Dockerfile.agent']) {
    const source = readFileSync(path, 'utf8');
    assert.equal((source.match(/RUN sh \/tmp\/wfm-harden-base.sh/g) ?? []).length, source.match(/^FROM /gm).length);
  }
  assert.ok(readReleaseInputs(process.cwd()).hashes['deployment/releases/harden-base.sh']);
});
