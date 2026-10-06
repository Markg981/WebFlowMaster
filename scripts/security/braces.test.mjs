import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const braces = require('braces');

test('braces preserves ordinary globs and escaped or quoted braces', () => {
  assert.deepEqual(braces.expand('src/{api,worker}/**/*.{js,ts}'), [
    'src/api/**/*.js', 'src/api/**/*.ts', 'src/worker/**/*.js', 'src/worker/**/*.ts',
  ]);
  assert.doesNotThrow(() => braces.compile('\\{'.repeat(200)));
  assert.doesNotThrow(() => braces.compile('"' + '{'.repeat(200) + '"'));
});
test('braces rejects excessive nesting before recursive AST traversal', () => {
  const pattern = '{'.repeat(101) + 'a,b' + '}'.repeat(101);
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    assert.throws(() => braces[method](pattern), error =>
      error instanceof SyntaxError && /maximum nesting depth/.test(error.message));
  }
  assert.doesNotThrow(() => braces.compile('{'.repeat(100) + 'a,b' + '}'.repeat(100)));
});
