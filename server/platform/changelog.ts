/**
 * CHANGELOG.md read as data, for the "What's new" page (server/http/routes/whats-new.routes.ts).
 *
 * The file follows Keep a Changelog and is drafted by scripts/release/changelog.mjs: a `## [x]`
 * heading per release (`## [1.4.0] - 2026-11-02`, or `## [Unreleased]`), a `### Added` heading per
 * kind of change, and one `- text ([#123](url))` line per entry. HTML comments are notes for the
 * people who edit it and never reach a reader.
 */

export type ChangelogEntry = { text: string; pr: number | null; url: string | null };
export type ChangelogSection = { title: string; entries: ChangelogEntry[] };
export type ChangelogRelease = {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
};

const RELEASE = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const SECTION = /^### (.+?)\s*$/;
const PULL_REQUEST = /\s*\(\[#(\d+)\]\(([^)\s]+)\)\)\s*$/;

/**
 * The text outside `<!-- … -->`. Cut by position rather than by a regular expression, so nothing of
 * a comment can survive (an unterminated one hides the rest of the file, as it does when rendered).
 * The result is data shown as text, never HTML.
 */
function withoutComments(text: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const open = text.indexOf('<!--', from);
    if (open < 0) return out + text.slice(from);
    out += text.slice(from, open);
    const close = text.indexOf('-->', open + 4);
    if (close < 0) return out;
    from = close + 3;
  }
}

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: ChangelogSection | null = null;
  let entry: ChangelogEntry | null = null;

  const text = withoutComments(markdown.replace(/\r\n/g, '\n'));
  for (const line of text.split('\n')) {
    const releaseMatch = RELEASE.exec(line);
    if (releaseMatch) {
      release = { version: releaseMatch[1], date: releaseMatch[2] ?? null, sections: [] };
      releases.push(release);
      section = null;
      entry = null;
      continue;
    }
    if (!release) continue;
    const sectionMatch = SECTION.exec(line);
    if (sectionMatch) {
      section = { title: sectionMatch[1], entries: [] };
      release.sections.push(section);
      entry = null;
      continue;
    }
    if (!section) continue;
    if (line.startsWith('- ')) {
      entry = { text: line.slice(2).trim(), pr: null, url: null };
      section.entries.push(entry);
    } else if (entry && /^\s+\S/.test(line)) {
      // A long entry wrapped onto the next lines.
      entry.text += ` ${line.trim()}`;
    } else {
      entry = null;
    }
  }

  for (const r of releases) {
    for (const s of r.sections) {
      for (const e of s.entries) {
        const pr = PULL_REQUEST.exec(e.text);
        if (pr) {
          e.text = e.text.slice(0, pr.index).trim();
          e.pr = Number(pr[1]);
          e.url = pr[2];
        }
      }
      // Drafted oldest first; a reader wants the newest first.
      s.entries.sort((a, b) => (b.pr ?? Infinity) - (a.pr ?? Infinity));
    }
    r.sections = r.sections.filter((s) => s.entries.length > 0);
  }
  return releases.filter((r) => r.sections.length > 0);
}

/**
 * What a reader has or has not seen yet: the newest release and the newest change in it, so an
 * entry added to [Unreleased] counts as news as much as a new release does.
 */
export function changelogStamp(releases: ChangelogRelease[]): string | null {
  const latest = releases[0];
  if (!latest) return null;
  const newest = Math.max(0, ...latest.sections.flatMap((s) => s.entries.map((e) => e.pr ?? 0)));
  return `${latest.version}#${newest}`;
}
