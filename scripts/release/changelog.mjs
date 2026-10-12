/**
 * CHANGELOG.md in the Keep a Changelog layout, fed by the titles of merged pull requests.
 *
 *   node scripts/release/changelog.mjs draft            add merged PRs since the last v* tag to [Unreleased]
 *   node scripts/release/changelog.mjs draft --all      the same over the whole history
 *   node scripts/release/changelog.mjs release 1.2.0    turn [Unreleased] into [1.2.0] - today
 *   node scripts/release/changelog.mjs notes 1.2.0      print the section of 1.2.0 (the release notes)
 *
 * Titles follow Conventional Commits. Only what a customer notices reaches the file: feat, fix, perf
 * and security changes; refactor, test, build, docs, chore and ci stay in the git history. A PR already
 * named anywhere in the file is never added twice, so `draft` can run as often as wanted and every
 * entry can be reworded by hand afterwards. A PR that should never be listed is named in a
 * `<!-- skip: #12 #34 -->` comment instead of being deleted, or the next draft would add it again.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SECTIONS = ['Added', 'Changed', 'Fixed', 'Security'];
export const REPOSITORY_URL = 'https://github.com/Markg981/WebFlowMaster';

const HEADER = `# Changelog

What changed in WebFlowMaster, release by release. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries start from the titles of the merged
pull requests (\`npm run changelog:draft\`) and are edited by hand before a release.
`;

/** Scopes of changes that touch only how the product is built, tested or accepted. */
const INTERNAL_SCOPES = new Set(['ci', 'collaudo', 'deps', 'dev', 'docs', 'e2e', 'test']);

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s*(?<text>.+)$/;

/** The changelog section of a PR title, or null when the change is internal. */
export function classify(title) {
  const match = CONVENTIONAL.exec(title.trim());
  if (!match) return null;
  const { type, scope = '', breaking, text } = match.groups;
  if (INTERNAL_SCOPES.has(scope)) return null;
  if (type === 'security' || /\bsecurity\b/.test(scope)) return { section: 'Security', text };
  if (breaking) return { section: 'Changed', text: `**Breaking:** ${text}` };
  if (type === 'feat') return { section: 'Added', text };
  if (type === 'fix') return { section: 'Fixed', text };
  if (type === 'perf') return { section: 'Changed', text };
  return null;
}

export function formatEntry(text, pr, repositoryUrl = REPOSITORY_URL) {
  // The docs site renders this file, and Vue would read a bare {{name}} as an interpolation.
  const sentence = text
    .trim()
    .replace(/\.$/, '')
    .replace(/(^|[^`])(\{\{[^}]*\}\})(?!`)/g, '$1`$2`');
  const capitalized = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return `- ${capitalized} ([#${pr}](${repositoryUrl}/pull/${pr}))`;
}

/**
 * Merged PRs out of `git log --first-parent` records: merge commits ("Merge pull request #N from …"
 * with the PR title as first body line) and squash merges ("title (#N)").
 */
export function parseMerges(log) {
  const merges = [];
  for (const record of log.split('\x1e')) {
    const [subject = '', body = ''] = record.trim().split('\x1f');
    const merge = /^Merge pull request #(\d+) from /.exec(subject);
    if (merge) {
      const title = body
        .split('\n')
        .find((line) => line.trim())
        ?.trim();
      if (title) merges.push({ pr: Number(merge[1]), title });
      continue;
    }
    const squash = /^(.+) \(#(\d+)\)$/.exec(subject.trim());
    if (squash) merges.push({ pr: Number(squash[2]), title: squash[1] });
  }
  return merges;
}

/** PR numbers the changelog already names. */
export function mentionedPullRequests(changelog) {
  const named = [...changelog.matchAll(/\[#(\d+)\]/g)].map((match) => Number(match[1]));
  const skipped = [...changelog.matchAll(/<!--\s*skip:([^>]*)-->/g)].flatMap((match) =>
    [...match[1].matchAll(/#(\d+)/g)].map((number) => Number(number[1])),
  );
  return new Set([...named, ...skipped]);
}

/** Windows checkouts may carry CRLF; every function reads LF so a heading is never missed. */
const lf = (text) => text.replace(/\r\n/g, '\n');

/** Splits the file into its header, the [Unreleased] body and everything after it. */
function splitUnreleased(changelog) {
  const text = changelog.trim() ? lf(changelog) : HEADER;
  const start = text.search(/^## \[Unreleased\]/m);
  if (start === -1) {
    const firstRelease = text.search(/^## \[/m);
    const at = firstRelease === -1 ? text.length : firstRelease;
    return { head: text.slice(0, at).trimEnd() + '\n\n', body: '', tail: text.slice(at) };
  }
  const bodyStart = text.indexOf('\n', start) + 1;
  const next = text.slice(bodyStart).search(/^## \[/m);
  const bodyEnd = next === -1 ? text.length : bodyStart + next;
  return {
    head: text.slice(0, start),
    body: text.slice(bodyStart, bodyEnd),
    tail: text.slice(bodyEnd),
  };
}

/** Section name to lines; text written before the first `###` is kept under the '' key. */
function parseSections(body) {
  const sections = new Map([['', []], ...SECTIONS.map((name) => [name, []])]);
  let current = '';
  for (const line of body.split('\n')) {
    const heading = /^### (.+)$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
    } else if (line.trim()) sections.get(current).push(line);
  }
  return sections;
}

function renderSections(sections) {
  return [...sections]
    .filter(([, lines]) => lines.length)
    .map(([name, lines]) => `${name ? `### ${name}\n\n` : ''}${lines.join('\n')}\n`)
    .join('\n');
}

/** Adds the customer-visible merges to [Unreleased]; returns the new text and how many were added. */
export function addToUnreleased(changelog, merges, repositoryUrl = REPOSITORY_URL) {
  const known = mentionedPullRequests(changelog);
  const { head, body, tail } = splitUnreleased(changelog);
  const sections = parseSections(body);
  let added = 0;
  for (const { pr, title } of [...merges].sort((a, b) => a.pr - b.pr)) {
    const entry = classify(title);
    if (!entry || known.has(pr)) continue;
    sections.get(entry.section).push(formatEntry(entry.text, pr, repositoryUrl));
    known.add(pr);
    added += 1;
  }
  const rendered = renderSections(sections);
  const unreleased = `## [Unreleased]\n\n${rendered}${rendered ? '\n' : ''}`;
  return { changelog: `${head}${unreleased}${tail}`.trimEnd() + '\n', added };
}

/**
 * Offset of the line that opens the section of `version` (`## [1.2.0] - …`), or -1. A plain string
 * comparison: the version comes from the command line and is never turned into a pattern.
 */
function sectionStart(changelog, version) {
  const heading = `## [${version}]`;
  let offset = 0;
  for (const line of changelog.split('\n')) {
    if (line.startsWith(heading)) return offset;
    offset += line.length + 1;
  }
  return -1;
}

/** Turns [Unreleased] into a dated version section and opens a new empty [Unreleased]. */
export function release(changelog, version, date) {
  changelog = lf(changelog);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`Not a semantic version: ${version}`);
  if (sectionStart(changelog, version) !== -1)
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  const { head, body, tail } = splitUnreleased(changelog);
  if (!body.trim()) throw new Error('[Unreleased] is empty: nothing to release');
  return (
    `${head}## [Unreleased]\n\n## [${version}] - ${date}\n\n${body.trim()}\n\n${tail}`.trimEnd() +
    '\n'
  );
}

/** The body of one version section: the text of the GitHub release. */
export function releaseNotes(changelog, version) {
  changelog = lf(changelog);
  const start = sectionStart(changelog, version);
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const lineEnd = changelog.indexOf('\n', start);
  const rest = lineEnd === -1 ? '' : changelog.slice(lineEnd + 1);
  const next = rest.search(/^## \[/m);
  const notes = (next === -1 ? rest : rest.slice(0, next)).trim();
  if (!notes) throw new Error(`The ${version} section of CHANGELOG.md is empty`);
  return notes + '\n';
}

function gitMerges(all) {
  // stderr piped: without any v* tag, `git describe` complains and the fallback below is expected.
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let range = 'HEAD';
  if (!all) {
    try {
      range = `${git('describe', '--tags', '--abbrev=0', '--match', 'v*').trim()}..HEAD`;
    } catch {
      range = 'HEAD'; // no release tag yet: the whole history
    }
  }
  return parseMerges(git('log', '--first-parent', '--format=%s%x1f%b%x1e', range)).map(fullTitle);
}

/**
 * A title too long for GitHub ends in "…" and the description starts with "…" and the rest of it.
 * Joins the two when the gh CLI can read the PR; otherwise the cut title stays for a hand edit.
 */
function fullTitle(merge) {
  if (!merge.title.endsWith('…')) return merge;
  try {
    const body = execFileSync(
      'gh',
      ['pr', 'view', String(merge.pr), '--json', 'body', '-q', '.body'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return { ...merge, title: completeTitle(merge.title, body) };
  } catch {
    return merge;
  }
}

export function completeTitle(title, body) {
  const rest = /^…([^\r\n]*)/.exec(body.trimStart());
  return rest ? title.slice(0, -1) + rest[1].trim() : title;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, argument] = process.argv.slice(2);
  const file = 'CHANGELOG.md';
  const read = () => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };
  if (command === 'draft') {
    const { changelog, added } = addToUnreleased(read(), gitMerges(argument === '--all'));
    writeFileSync(file, changelog);
    console.log(`Added ${added} entr${added === 1 ? 'y' : 'ies'} to [Unreleased] in ${file}`);
  } else if (command === 'release' && argument) {
    writeFileSync(file, release(read(), argument, new Date().toISOString().slice(0, 10)));
    console.log(`Moved [Unreleased] to [${argument}] in ${file}`);
  } else if (command === 'notes' && argument) {
    process.stdout.write(releaseNotes(read(), argument));
  } else {
    console.error('Usage: changelog.mjs draft [--all] | release <version> | notes <version>');
    process.exit(2);
  }
}
