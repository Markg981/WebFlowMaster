import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readReleaseInputs } from './model.mjs';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
test('root lock resolves corrected mail, proxy and source-map dependencies', () => {
  const lock = json('package-lock.json').packages;
  assert.equal(lock['node_modules/nodemailer'].version, '10.0.15');
  assert.equal(lock['node_modules/proxy-addr'].version, '2.0.8');
  assert.equal(lock['node_modules/source-map-js'].version, '1.2.2');
  assert.equal(lock['node_modules/undici'].version, '6.29.0');
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
test('release inputs fingerprint workspace installation hooks and the security patch', () => {
  const inputs = readReleaseInputs(process.cwd());
  for (const path of ['client/package.json', 'client/package-lock.json', 'scripts/security/apply-braces-patch.cjs']) {
    assert.ok(inputs.hashes[path], path);
  }
  assert.match(readFileSync('Dockerfile.agent', 'utf8'), /COPY --from=build \/src\/scripts\/security\/apply-braces-patch.cjs/);
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
