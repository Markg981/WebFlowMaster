import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, findingsOf, parseExceptions } from './audit-gate.mjs';

const doc = `
| Advisory | Package | Expires | Reachability |
| --- | --- | --- | --- |
| GHSA-aaaa-bbbb-cccc | foo | 2026-12-31 | not reachable |
| not-an-id | x | 2026-01-01 | |
`;

test('parses only advisory rows', () => {
  assert.deepEqual(parseExceptions(doc), [
    { id: 'GHSA-AAAA-BBBB-CCCC', pkg: 'foo', expires: '2026-12-31' },
  ]);
});

test('rejects a malformed expiry', () => {
  assert.throws(() => parseExceptions('| GHSA-aaaa-bbbb-cccc | foo | soon | x |'));
});

const audit = {
  vulnerabilities: {
    foo: {
      via: [
        { name: 'foo', severity: 'high', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' },
      ],
    },
    bar: {
      via: [
        {
          name: 'bar',
          severity: 'critical',
          url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff',
        },
        'foo',
      ],
    },
    low: {
      via: [
        { name: 'low', severity: 'low', url: 'https://github.com/advisories/GHSA-1111-2222-3333' },
      ],
    },
  },
};

test('ignores low severity and string via entries', () => {
  assert.equal(findingsOf(audit).length, 2);
});

test('fails unlisted and expired, passes listed', () => {
  const ex = parseExceptions(doc);
  const f = findingsOf(audit);
  assert.equal(evaluate(f, ex, '2026-10-27').length, 1);
  assert.match(evaluate(f, ex, '2027-01-01').join('\n'), /expired/);
  assert.deepEqual(evaluate([], ex), []);
});
