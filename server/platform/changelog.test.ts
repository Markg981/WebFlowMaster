import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { changelogStamp, parseChangelog } from './changelog';
import { APP_ROOT } from './app-root';

const SAMPLE = `# Changelog

Intro text that is not a release.

<!-- skip: #1 #2 -->

## [Unreleased]

### Added

- Older feature ([#10](https://example.test/pull/10))
- A long entry that the editor
  wrapped onto two lines ([#12](https://example.test/pull/12))
- Hand-written entry without a pull request

### Fixed

<!-- ### Security
- hidden -->

## [1.0.0] - 2026-09-30

### Changed

- First release change ([#3](https://example.test/pull/3))

### Security
`;

describe('parseChangelog', () => {
  const releases = parseChangelog(SAMPLE);

  it('reads releases, dates and the kinds of change that have entries', () => {
    expect(releases.map((r) => [r.version, r.date])).toEqual([
      ['Unreleased', null],
      ['1.0.0', '2026-09-30'],
    ]);
    expect(releases[0].sections.map((s) => s.title)).toEqual(['Added']);
    expect(releases[1].sections.map((s) => s.title)).toEqual(['Changed']);
  });

  it('splits the pull request off the text, joins wrapped lines and puts the newest first', () => {
    expect(releases[0].sections[0].entries).toEqual([
      { text: 'Hand-written entry without a pull request', pr: null, url: null },
      {
        text: 'A long entry that the editor wrapped onto two lines',
        pr: 12,
        url: 'https://example.test/pull/12',
      },
      { text: 'Older feature', pr: 10, url: 'https://example.test/pull/10' },
    ]);
  });

  it('stamps the newest release with its newest change', () => {
    expect(changelogStamp(releases)).toBe('Unreleased#12');
    expect(changelogStamp([])).toBeNull();
  });

  it('reads the repository changelog', () => {
    const real = parseChangelog(fs.readFileSync(path.join(APP_ROOT, 'CHANGELOG.md'), 'utf8'));
    expect(real.length).toBeGreaterThan(0);
    expect(real[0].sections.flatMap((s) => s.entries).length).toBeGreaterThan(0);
    for (const entry of real.flatMap((r) => r.sections.flatMap((s) => s.entries))) {
      expect(entry.text).not.toMatch(/\[#\d+\]/);
    }
  });
});
