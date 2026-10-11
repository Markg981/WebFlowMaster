import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error -- plain ES module without type declarations
import { largeBlobsSince, largeStagedFiles } from './check-large-files.mjs';

/**
 * The guard has to see a large file even when the PR deletes it again: the blob is in the
 * history from the commit that added it, whatever the final tree holds.
 */
const LIMIT = 1024;
let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const write = (name: string, bytes: number) => fs.writeFileSync(path.join(repo, name), Buffer.alloc(bytes, 97));

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-large-files-'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  write('small.txt', 10);
  git('add', '.');
  git('commit', '-q', '-m', 'base');
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('the large file guard', () => {
  it('passes commits that add only small files', () => {
    const base = git('rev-parse', 'HEAD');
    write('other.txt', 100);
    git('add', '.');
    git('commit', '-q', '-m', 'small');
    expect(largeBlobsSince(base, { cwd: repo, limit: LIMIT })).toEqual([]);
  });

  it('finds a large file that a later commit of the same range deletes', () => {
    const base = git('rev-parse', 'HEAD');
    write('kit.zip', LIMIT + 1);
    git('add', '.');
    git('commit', '-q', '-m', 'add');
    git('rm', '-q', 'kit.zip');
    git('commit', '-q', '-m', 'remove');
    expect(largeBlobsSince(base, { cwd: repo, limit: LIMIT })).toEqual([{ path: 'kit.zip', bytes: LIMIT + 1 }]);
  });

  it('ignores large files that were already in the history before the base', () => {
    write('old.bin', LIMIT + 1);
    git('add', '.');
    git('commit', '-q', '-m', 'old');
    const base = git('rev-parse', 'HEAD');
    write('small2.txt', 5);
    git('add', '.');
    git('commit', '-q', '-m', 'new');
    expect(largeBlobsSince(base, { cwd: repo, limit: LIMIT })).toEqual([]);
  });

  it('checks what is staged, not the working copy', () => {
    write('big.tar', LIMIT + 1);
    git('add', 'big.tar');
    write('big.tar', 1);
    expect(largeStagedFiles({ cwd: repo, limit: LIMIT })).toEqual([{ path: 'big.tar', bytes: LIMIT + 1 }]);
  });
});
