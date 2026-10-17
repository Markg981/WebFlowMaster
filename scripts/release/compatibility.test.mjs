import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DECLARATION,
  PROTOCOLS_SOURCE,
  checkCompatibility,
  compareVersions,
  parseSupportedProtocols,
} from './compatibility.mjs';

const formats = { snapshot: [1], definitions: [1, 2], dependencyBundle: [1] };
const declared = (minimumRollbackRelease, own = formats) => ({
  formats: own,
  minimumRollbackRelease,
});

test('the committed declaration matches the formats the code reads', () => {
  const declaration = JSON.parse(readFileSync(DECLARATION, 'utf8'));
  const codeFormats = parseSupportedProtocols(readFileSync(PROTOCOLS_SOURCE, 'utf8'));
  assert.deepEqual(checkCompatibility({ declaration, codeFormats }), []);
});

test('the protocol lists are read out of the TypeScript constant', () => {
  const source = `export const SUPPORTED_EXECUTION_PROTOCOLS = {
  /** comment */
  snapshot: [1],
  definitions: [1, 2],
} as const;`;
  assert.deepEqual(parseSupportedProtocols(source), { snapshot: [1], definitions: [1, 2] });
  assert.throws(() => parseSupportedProtocols('const x = 1;'), /not found/);
});

test('a format the code reads but the declaration omits fails every build', () => {
  const codeFormats = { ...formats, definitions: [1, 2, 3] };
  const [problem] = checkCompatibility({ declaration: declared(null), codeFormats });
  assert.match(problem, /declares formats .* but .* reads/);
});

test('a tagged release must declare its minimum rollback release, never above itself', () => {
  const base = { codeFormats: formats, previous: declared('1.0.0') };
  assert.match(
    checkCompatibility({ ...base, declaration: declared(null), version: '1.1.0' })[0],
    /must declare minimumRollbackRelease/,
  );
  assert.match(
    checkCompatibility({ ...base, declaration: declared('2.0.0'), version: '1.1.0' }).join(),
    /newer than release 1\.1\.0/,
  );
  assert.deepEqual(
    checkCompatibility({ ...base, declaration: declared('1.0.0'), version: '1.1.0' }),
    [],
  );
});

test('changed formats, or a first declared release, make the release itself the minimum', () => {
  assert.match(
    checkCompatibility({
      declaration: declared('0.9.0'),
      codeFormats: formats,
      version: '1.0.0',
      previous: null,
    })[0],
    /first with declared formats: minimumRollbackRelease must be 1\.0\.0/,
  );
  assert.match(
    checkCompatibility({
      declaration: declared('1.0.0'),
      codeFormats: formats,
      version: '1.1.0',
      previous: declared('1.0.0', { ...formats, definitions: [1] }),
    })[0],
    /changes the execution formats: minimumRollbackRelease must be 1\.1\.0/,
  );
  assert.deepEqual(
    checkCompatibility({
      declaration: declared('1.0.0'),
      codeFormats: formats,
      version: '1.0.0',
      previous: null,
    }),
    [],
  );
});

test('unchanged formats keep the previous minimum', () => {
  const [problem] = checkCompatibility({
    declaration: declared('1.1.0'),
    codeFormats: formats,
    version: '1.1.0',
    previous: declared('1.0.0'),
  });
  assert.match(problem, /stays 1\.0\.0, not 1\.1\.0/);
});

test('versions compare numerically, a pre-release before its release', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.throws(() => compareVersions('R1', '1.0.0'), /Not a semantic version: R1/);
});
