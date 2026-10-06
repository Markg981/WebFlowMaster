import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeUnusedGlobTools } from './runtime-tools.mjs';

function fixture(t, dependencies, packages) {
  const root = mkdtempSync(join(tmpdir(), 'wfm-runtime-tools-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies }));
  for (const [name, pkg] of Object.entries(packages)) {
    const dir = join(root, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...pkg }));
  }
  return root;
}
test('unused glob build tools are removed without changing runtime dependencies', t => {
  const root = fixture(t, { service: '1' }, { service: { dependencies: { helper: '1' } }, helper: {}, 'fast-glob': {}, micromatch: {}, braces: {} });
  removeUnusedGlobTools(root);
  for (const name of ['fast-glob', 'micromatch', 'braces']) assert.equal(existsSync(join(root, 'node_modules', name)), false);
  assert.ok(existsSync(join(root, 'node_modules/helper/package.json')));
});
test('runtime reachability refuses removal through ordinary and peer dependencies', t => {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const root = fixture(t, { service: '1' }, { service: { [field]: { braces: '1' } }, braces: {} });
    assert.throws(() => removeUnusedGlobTools(root), /Runtime requires/);
    assert.ok(existsSync(join(root, 'node_modules/braces/package.json')));
  }
});
test('missing mandatory dependencies fail closed while absent optional dependencies are allowed', t => {
  const root = fixture(t, { service: '1' }, { service: { optionalDependencies: { absent: '1' }, peerDependencies: { optionalPeer: '1' }, peerDependenciesMeta: { optionalPeer: { optional: true } } } });
  assert.doesNotThrow(() => removeUnusedGlobTools(root));
  const missing = fixture(t, { absent: '1' }, {});
  assert.throws(() => removeUnusedGlobTools(missing), /Missing runtime dependency/);
});
