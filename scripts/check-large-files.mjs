#!/usr/bin/env node
// Refuses files over the size limit before they reach the history, where they stay in every
// clone even after a later commit deletes them.
//
//   node scripts/check-large-files.mjs <base>   every blob the commits after <base> introduce (CI)
//   node scripts/check-large-files.mjs --staged the files staged for the next commit (pre-commit)
//
// The local .git once reached 259 MB from a 69 MB zip and five 14 MB tar files that never left
// it; checking the final tree alone would miss a file added and removed within the same PR.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LIMIT_BYTES = 5 * 1024 * 1024;

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** Blobs over the limit in `base..HEAD`, with the path each was introduced under. */
export function largeBlobsSince(base, { cwd = process.cwd(), limit = LIMIT_BYTES } = {}) {
  const objects = git(['rev-list', '--objects', `${base}..HEAD`], cwd)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(' ');
      return space === -1 ? { id: line, path: '' } : { id: line.slice(0, space), path: line.slice(space + 1) };
    });
  if (!objects.length) return [];
  const checked = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    cwd,
    encoding: 'utf8',
    input: objects.map((o) => o.id).join('\n') + '\n',
    maxBuffer: 256 * 1024 * 1024,
  });
  const byId = new Map(objects.map((o) => [o.id, o.path]));
  return checked
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '))
    .filter(([, type, size]) => type === 'blob' && Number(size) > limit)
    .map(([id, , size]) => ({ path: byId.get(id) ?? id, bytes: Number(size) }));
}

/** Staged files over the limit, by the size of what is staged (not of the working copy). */
export function largeStagedFiles({ cwd = process.cwd(), limit = LIMIT_BYTES } = {}) {
  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=AM', '-z'], cwd).split('\0').filter(Boolean);
  return staged
    .map((path) => ({ path, bytes: Number(git(['cat-file', '-s', `:${path}`], cwd).trim()) }))
    .filter((file) => file.bytes > limit);
}

function main(argv) {
  const [mode] = argv;
  if (!mode) {
    console.error('Usage: check-large-files.mjs <base-commit> | --staged');
    return 2;
  }
  const found = mode === '--staged' ? largeStagedFiles() : largeBlobsSince(mode);
  if (!found.length) {
    console.log(`No file over ${LIMIT_BYTES / 1024 / 1024} MB.`);
    return 0;
  }
  console.error(`Files over ${LIMIT_BYTES / 1024 / 1024} MB, which would stay in every clone of the history:`);
  for (const { path, bytes } of found) console.error(`  ${(bytes / 1024 / 1024).toFixed(1)} MB  ${path}`);
  console.error('Keep generated output out of Git (.gitignore), or publish it as a release asset.');
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
