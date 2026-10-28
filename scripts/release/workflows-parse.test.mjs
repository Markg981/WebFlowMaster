import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';

const dir = '.github/workflows';
const files = readdirSync(dir).filter((file) => /\.ya?ml$/.test(file));

test('the workflow directory is not empty', () => {
  assert.ok(files.includes('ci.yml'));
});

// A duplicated key (588ed41) made GitHub reject ci.yml with 0 jobs; with uniqueKeys the yaml
// parser turns that, and any other syntax error, into a document error.
for (const file of files)
  test(`${file} parses strictly: no syntax errors, no duplicated keys`, () => {
    const doc = parseDocument(readFileSync(`${dir}/${file}`, 'utf8'), { uniqueKeys: true });
    assert.deepEqual(
      doc.errors.map((error) => error.message),
      [],
    );
    assert.ok(doc.toJS().jobs);
  });
