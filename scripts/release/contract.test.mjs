import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['Dockerfile', 'Dockerfile.worker', 'Dockerfile.agent']) {
  test(`${file} pins every external base by digest`, () => {
    const bases = readFileSync(file, 'utf8').match(/^FROM .+$/gm);
    assert.ok(bases?.length);
    for (const base of bases) assert.match(base, /@sha256:[a-f0-9]{64}(?: AS \w+)?$/);
  });
  test(`${file} ends with an explicit non-root user`, () => {
    const users = readFileSync(file, 'utf8').match(/^USER .+$/gm);
    assert.equal(users?.at(-1), 'USER pwuser');
  });
}

test('Lighthouse runtime dependencies come from a committed lockfile', () => {
  const tool = JSON.parse(readFileSync('deployment/lighthouse/package-lock.json', 'utf8'));
  assert.equal(tool.packages[''].dependencies.lighthouse, '12.8.2');
  for (const file of ['Dockerfile', 'Dockerfile.worker']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /npm install -g/);
    assert.match(source, /npm ci --prefix \/opt\/lighthouse/);
  }
});

test('agent runtime uses the root lockfile instead of resolving dependency ranges', () => {
  const source = readFileSync('Dockerfile.agent', 'utf8');
  assert.doesNotMatch(source, /npm init|ws@\^/);
  assert.match(source, /COPY --from=build \/src\/node_modules/);
});

test('production installation stays frozen and named-volume targets exist before mounting', () => {
  for (const file of ['Dockerfile', 'Dockerfile.worker', 'Dockerfile.agent']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /npm prune/);
    assert.match(source, /npm ci --omit=dev/);
    if (file !== 'Dockerfile.agent') assert.match(source, /mkdir -p .*\/app\/data\/visual-baselines/);
  }
});

test('npm instructions remove nondeterministic Node bytecode within the same layer', () => {
  for (const file of ['Dockerfile', 'Dockerfile.worker']) {
    const instructions = readFileSync(file, 'utf8').match(/^RUN npm .+$/gm);
    assert.ok(instructions?.length >= 3);
    for (const instruction of instructions) assert.match(instruction, /rm -rf \/root\/\.npm \/tmp\/node-compile-cache/);
  }
});
