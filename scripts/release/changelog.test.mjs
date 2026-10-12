import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classify,
  formatEntry,
  parseMerges,
  addToUnreleased,
  release,
  releaseNotes,
  mentionedPullRequests,
  completeTitle,
} from './changelog.mjs';

const url = 'https://example.test/repo';

test('only customer-visible PR titles reach the changelog', () => {
  assert.deepEqual(classify('feat(mobile): record on a real device'), {
    section: 'Added',
    text: 'record on a real device',
  });
  assert.equal(classify('fix: keep the session alive').section, 'Fixed');
  assert.equal(classify('perf(db): bound the pool').section, 'Changed');
  assert.equal(classify('security: rotate keys').section, 'Security');
  assert.equal(classify('fix(security): escape backslashes').section, 'Security');
  assert.deepEqual(classify('feat(api)!: drop v0 routes'), {
    section: 'Changed',
    text: '**Breaking:** drop v0 routes',
  });
  for (const internal of [
    'refactor(server): split',
    'docs: typo',
    'chore: bump',
    'Update README',
    'feat(collaudo): a new case',
    'fix(ci): unbreak main',
  ])
    assert.equal(classify(internal), null);
});

test('product variables are quoted as code so the docs site does not interpolate them', () => {
  assert.equal(
    formatEntry('{{$totp(name)}} and `{{kept}}`', 3, url),
    `- \`{{$totp(name)}}\` and \`{{kept}}\` ([#3](${url}/pull/3))`,
  );
});

test('entries are sentences linking their pull request', () => {
  assert.equal(
    formatEntry('record on a device.', 12, url),
    `- Record on a device ([#12](${url}/pull/12))`,
  );
});

test('a title GitHub cut is finished from the start of the description', () => {
  assert.equal(
    completeTitle('feat: paste rows from a spreads…', '…heet\r\n\r\nWhy.'),
    'feat: paste rows from a spreadsheet',
  );
  assert.equal(completeTitle('feat: whole', 'Body'), 'feat: whole');
  assert.equal(completeTitle('feat: cut…', 'No continuation'), 'feat: cut…');
});

test('merge commits and squash merges are both read', () => {
  const log = [
    'Merge pull request #7 from me/branch\x1f\nfeat: one\n\nmore text\n',
    'fix: two (#8)\x1f',
    'Merge branch main\x1f',
  ].join('\x1e');
  assert.deepEqual(parseMerges(log), [
    { pr: 7, title: 'feat: one' },
    { pr: 8, title: 'fix: two' },
  ]);
});

test('draft fills [Unreleased] once, in section order, keeping hand-written entries', () => {
  const start =
    '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Reworded by hand ([#3](x))\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- Old ([#1](x))\n';
  const merges = [
    { pr: 3, title: 'fix: original wording' },
    { pr: 5, title: 'fix: five' },
    { pr: 4, title: 'feat: four' },
    { pr: 6, title: 'test: six' },
    { pr: 1, title: 'feat: old' },
  ];
  const { changelog, added } = addToUnreleased(start, merges, url);
  assert.equal(added, 2);
  assert.match(changelog, /### Added\n\n- Four \(\[#4\]/);
  assert.match(changelog, /- Reworded by hand \(\[#3\]\(x\)\)\n- Five/);
  assert.ok(changelog.indexOf('### Added') < changelog.indexOf('### Fixed'));
  assert.ok(changelog.indexOf('## [1.0.0]') > changelog.indexOf('Five'));
  assert.equal(addToUnreleased(changelog, merges, url).added, 0);
});

test('a PR named in a skip comment is never drafted', () => {
  const start = '# Changelog\n\n<!-- skip: #4 #5 -->\n\n## [Unreleased]\n';
  const merges = [
    { pr: 4, title: 'feat: four' },
    { pr: 5, title: 'fix: five' },
    { pr: 6, title: 'fix: six' },
  ];
  const { changelog, added } = addToUnreleased(start, merges, url);
  assert.equal(added, 1);
  assert.match(changelog, /<!-- skip: #4 #5 -->/);
  assert.doesNotMatch(changelog, /Four|Five/);
});

test('CRLF files and text outside a section survive a draft', () => {
  const start =
    '# Changelog\r\n\r\n## [Unreleased]\r\n\r\nA note.\r\n\r\n### Fixed\r\n\r\n- Kept ([#3](x))\r\n';
  const { changelog } = addToUnreleased(start, [{ pr: 4, title: 'fix: four' }], url);
  assert.match(
    changelog,
    /## \[Unreleased\]\n\nA note\.\n\n### Fixed\n\n- Kept \(\[#3\]\(x\)\)\n- Four/,
  );
  assert.equal(
    releaseNotes(release(start, '1.0.0', '2026-01-01'), '1.0.0'),
    'A note.\n\n### Fixed\n\n- Kept ([#3](x))\n',
  );
});

test('draft creates the file and the [Unreleased] heading when missing', () => {
  const { changelog } = addToUnreleased('', [{ pr: 2, title: 'feat: first' }], url);
  assert.match(changelog, /^# Changelog/);
  assert.match(changelog, /## \[Unreleased\]\n\n### Added\n\n- First/);
});

test('release dates [Unreleased], reopens it, and its notes become the GitHub release text', () => {
  const draft = addToUnreleased('', [{ pr: 2, title: 'feat: first' }], url).changelog;
  const released = release(draft, '1.1.0', '2026-10-12');
  assert.match(released, /## \[Unreleased\]\n\n## \[1\.1\.0\] - 2026-10-12\n\n### Added/);
  assert.equal(releaseNotes(released, '1.1.0'), `### Added\n\n- First ([#2](${url}/pull/2))\n`);
  assert.throws(() => release(released, '1.2.0', '2026-10-13'), /empty/);
  assert.throws(() => release(draft, 'v1', '2026-10-13'), /semantic version/);
  assert.throws(() => releaseNotes(released, '9.9.9'), /no section/);
  // The version is compared as text: dots are not "any character".
  assert.throws(() => releaseNotes('## [1x1x0] - 2026-01-01\n\n- A\n', '1.1.0'), /no section/);
});

test('the repository CHANGELOG.md parses and names each PR once', () => {
  const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(changelog, /^## \[Unreleased\]/m);
  const names = [...changelog.matchAll(/\[#(\d+)\]/g)].map((match) => match[1]);
  assert.equal(new Set(names).size, names.length);
  assert.ok(mentionedPullRequests(changelog).size >= names.length);
  // docs/it/reference/changelog.md includes the file from line 8, after the English introduction.
  const lines = changelog.split(/\r?\n/);
  assert.equal(lines[6], '');
  assert.match(lines[7], /^(<!--|## \[)/);
  assert.doesNotMatch(changelog, /…/, 'a PR title cut with … was not finished by hand');
});
