import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import {
  artifactStoreFromEnv,
  assertSafeKey,
  contentTypeFor,
  createLocalArtifactStore,
  createS3ArtifactStore,
  keyForLocalPath,
} from './artifact-store';
import { fakeS3 } from './tests/fake-s3';

let cwd: string;
const previousBaselineDir = process.env.VISUAL_BASELINE_DIR;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-store-'));
  process.env.VISUAL_BASELINE_DIR = path.join(cwd, 'baselines-here');
});

afterEach(async () => {
  process.env.VISUAL_BASELINE_DIR = previousBaselineDir;
  await fs.remove(cwd);
});

async function writeRunFiles() {
  const dir = path.join(cwd, 'results', 'plan-1', 'exec-1', 'ui_5_chromium');
  await fs.ensureDir(path.join(dir, 'row_1'));
  await fs.writeFile(path.join(dir, 'step_click.png'), 'png-bytes');
  await fs.writeFile(path.join(dir, 'row_1', 'video.webm'), 'webm-bytes');
  return dir;
}

describe('keys', () => {
  it('refuses a key that climbs, is absolute, or names a drive', () => {
    for (const bad of ['../x', 'results/../../.env', '/etc/passwd', 'C:/Windows/win.ini', 'results//x', '']) {
      expect(() => assertSafeKey(bad), bad).toThrow(/Invalid artifact key/);
    }
    expect(assertSafeKey('results\\plan\\exec\\a.png')).toBe('results/plan/exec/a.png');
  });

  it('gives a file under ./results the key its path gives it, and nothing else a key', () => {
    expect(keyForLocalPath(path.join('results', 'p', 'e', 'a.png'), cwd)).toBe('results/p/e/a.png');
    expect(keyForLocalPath(path.join(cwd, 'results', 'p', 'e', 'a.png'), cwd)).toBe('results/p/e/a.png');
    expect(keyForLocalPath(path.join('data', 'secret.txt'), cwd)).toBeNull();
  });

  it('knows what the runner writes', () => {
    expect(contentTypeFor('a/b.png')).toBe('image/png');
    expect(contentTypeFor('a/b.webm')).toBe('video/webm');
    expect(contentTypeFor('a/trace.zip')).toBe('application/zip');
    expect(contentTypeFor('a/b.bin')).toBe('application/octet-stream');
  });
});

describe('the local store', () => {
  it('keeps run files and baselines where they have always been', async () => {
    const store = createLocalArtifactStore(cwd);

    await store.write('results/p/e/a.png', Buffer.from('run'));
    await store.write('visual-baselines/org_1/test_2/chromium/step_000.png', Buffer.from('baseline'));

    expect(await fs.readFile(path.join(cwd, 'results', 'p', 'e', 'a.png'), 'utf8')).toBe('run');
    expect(await fs.readFile(path.join(cwd, 'baselines-here', 'org_1', 'test_2', 'chromium', 'step_000.png'), 'utf8')).toBe('baseline');
    expect((await store.read('visual-baselines/org_1/test_2/chromium/step_000.png'))?.toString()).toBe('baseline');
    expect(await store.read('results/p/e/missing.png')).toBeNull();
  });

  it('opens a file with its type and size, and nothing for a directory or a missing file', async () => {
    const store = createLocalArtifactStore(cwd);
    await store.write('results/p/e/a.png', Buffer.from('12345'));

    const opened = await store.open('results/p/e/a.png');
    expect(opened).toMatchObject({ contentType: 'image/png', size: 5 });
    opened!.stream.destroy();
    expect(await store.open('results/p/e')).toBeNull();
    expect(await store.open('results/p/e/nope.png')).toBeNull();
  });

  it('publishes a directory by leaving it where it is', async () => {
    const dir = await writeRunFiles();
    const store = createLocalArtifactStore(cwd);

    expect(await store.publishDirectory(dir)).toBe(2);
    expect(await fs.pathExists(path.join(dir, 'step_click.png'))).toBe(true);
  });
});

describe('the S3 store', () => {
  it('writes, reads and opens objects under its prefix', async () => {
    const client = fakeS3();
    const store = createS3ArtifactStore({ client, bucket: 'evidence', prefix: 'wfm-prod/', cwd });

    await store.write('results/p/e/a.png', Buffer.from('run'));

    expect([...client.objects.keys()]).toEqual(['wfm-prod/results/p/e/a.png']);
    expect(client.objects.get('wfm-prod/results/p/e/a.png')?.contentType).toBe('image/png');
    expect((await store.read('results/p/e/a.png'))?.toString()).toBe('run');
    const opened = await store.open('results/p/e/a.png');
    expect(opened).toMatchObject({ contentType: 'image/png', size: 3 });
    const chunks: Buffer[] = [];
    for await (const chunk of opened!.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('run');
  });

  it('answers a missing object with nothing rather than an error', async () => {
    const store = createS3ArtifactStore({ client: fakeS3(), bucket: 'evidence', cwd });
    expect(await store.read('results/p/e/nope.png')).toBeNull();
    expect(await store.open('results/p/e/nope.png')).toBeNull();
  });

  it('uploads a run directory under the keys the report asks for, then frees the disk', async () => {
    const dir = await writeRunFiles();
    const client = fakeS3();
    const store = createS3ArtifactStore({ client, bucket: 'evidence', cwd });

    expect(await store.publishDirectory(dir)).toBe(2);

    expect([...client.objects.keys()].sort()).toEqual([
      'results/plan-1/exec-1/ui_5_chromium/row_1/video.webm',
      'results/plan-1/exec-1/ui_5_chromium/step_click.png',
    ]);
    expect(client.objects.get('results/plan-1/exec-1/ui_5_chromium/row_1/video.webm')?.contentType).toBe('video/webm');
    expect(await fs.pathExists(dir)).toBe(false);
  });

  it('keeps the local copy when an upload fails, because then it is the only copy', async () => {
    const dir = await writeRunFiles();
    const store = createS3ArtifactStore({ client: fakeS3({ failPutsAfter: 1 }), bucket: 'evidence', cwd });

    await expect(store.publishDirectory(dir)).rejects.toThrow(/SlowDown/);
    expect(await fs.pathExists(path.join(dir, 'step_click.png'))).toBe(true);
    expect(await fs.pathExists(path.join(dir, 'row_1', 'video.webm'))).toBe(true);
  });

  it('never writes a key that climbs out of its prefix', async () => {
    const store = createS3ArtifactStore({ client: fakeS3(), bucket: 'evidence', prefix: 'tenant-a', cwd });
    await expect(store.write('../tenant-b/results/x.png', Buffer.from('x'))).rejects.toThrow(/Invalid artifact key/);
  });
});

describe('deletePrefix', () => {
  it("removes one run's files from the disk and not a run whose id merely starts the same", async () => {
    const store = createLocalArtifactStore(cwd);
    await store.write('results/p/exec-1/ui_1/a.png', Buffer.from('a'));
    await store.write('results/p/exec-1/ui_1/row_1/b.webm', Buffer.from('b'));
    await store.write('results/p/exec-10/ui_1/c.png', Buffer.from('c'));

    expect(await store.deletePrefix('results/p/exec-1/')).toBe(2);

    expect(await store.read('results/p/exec-1/ui_1/a.png')).toBeNull();
    expect((await store.read('results/p/exec-10/ui_1/c.png'))?.toString()).toBe('c');
    expect(await store.deletePrefix('results/p/never-ran/')).toBe(0);
  });

  it('removes them from the bucket, page by page, under its prefix only', async () => {
    const client = fakeS3();
    const store = createS3ArtifactStore({ client, bucket: 'evidence', prefix: 'wfm', cwd });
    for (const name of ['a', 'b', 'c', 'd', 'e']) await store.write(`results/p/exec-1/${name}.png`, Buffer.from(name));
    await store.write('results/p/exec-10/keep.png', Buffer.from('keep'));

    expect(await store.deletePrefix('results/p/exec-1/')).toBe(5);

    expect([...client.objects.keys()]).toEqual(['wfm/results/p/exec-10/keep.png']);
    expect(client.commands.filter((c) => c.startsWith('list'))).toHaveLength(3);
  });

  it('refuses a prefix that is not a directory or that climbs', async () => {
    const store = createLocalArtifactStore(cwd);
    await expect(store.deletePrefix('results/p/exec-1')).rejects.toThrow(/must end with/);
    await expect(store.deletePrefix('results/../')).rejects.toThrow(/Invalid artifact key/);
    await expect(store.deletePrefix('/')).rejects.toThrow(/Invalid artifact key/);
  });
});

describe('artifactStoreFromEnv', () => {
  it('is the local disk unless told otherwise', () => {
    expect(artifactStoreFromEnv({} as NodeJS.ProcessEnv).kind).toBe('local');
  });

  it('builds an S3 store from its settings, and refuses one without a bucket or an unknown kind', () => {
    expect(artifactStoreFromEnv({ ARTIFACT_STORE: 's3', S3_BUCKET: 'b', S3_ENDPOINT: 'http://minio:9000' } as NodeJS.ProcessEnv).kind).toBe('s3');
    expect(() => artifactStoreFromEnv({ ARTIFACT_STORE: 's3' } as NodeJS.ProcessEnv)).toThrow(/S3_BUCKET/);
    expect(() => artifactStoreFromEnv({ ARTIFACT_STORE: 'ftp' } as NodeJS.ProcessEnv)).toThrow(/"local" or "s3"/);
  });
});
