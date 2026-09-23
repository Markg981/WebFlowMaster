import path from 'path';
import fs from 'fs-extra';
import { Readable } from 'stream';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

/**
 * Where a run's evidence and the visual baselines are kept.
 *
 * Everything lived on the local disk of whichever process wrote it: screenshots, videos and
 * traces under ./results, baselines under ./data/visual-baselines. That holds on one machine and
 * breaks the moment there are two. A worker on another host writes a screenshot the web server
 * cannot serve, and two workers each keep their own baselines, so the same step passes on one
 * and "changes" on the other. Container restarts lose all of it.
 *
 * Two stores behind one interface:
 * - local — the disk, exactly as before: the same paths, the same files. The default.
 * - s3 — any S3-compatible bucket (AWS S3, MinIO, Cloudflare R2), shared by every process.
 *
 * Keys are the paths the application already used, with forward slashes:
 *   results/<planId>/<executionId>/<file below the run>
 *   visual-baselines/org_<id>/test_<id>/<browser>/…/step_000.png
 * so the URLs in the database and the report do not change with the store.
 */

export interface StoredArtifact {
  stream: Readable;
  contentType: string;
  size?: number;
}

export interface ArtifactStore {
  readonly kind: 'local' | 's3';
  read(key: string): Promise<Buffer | null>;
  write(key: string, body: Buffer, contentType?: string): Promise<void>;
  open(key: string): Promise<StoredArtifact | null>;
  /**
   * Makes every file under a local directory available from the store, under the key its path
   * below the working directory gives it. A remote store uploads them and removes the local
   * copy, so a worker's disk does not fill with what is now kept elsewhere. Returns how many
   * files were published.
   */
  publishDirectory(localDir: string): Promise<number>;
  /**
   * Removes everything whose key starts with `prefix` — a run's evidence, when retention says
   * it has been kept long enough. Returns how many files were removed. The prefix is checked
   * like a key and must end with '/', so it names a directory and never a sibling of one.
   */
  deletePrefix(prefix: string): Promise<number>;
}

function assertSafePrefix(prefix: string): string {
  if (!prefix.endsWith('/')) throw new Error(`An artifact prefix must end with '/': ${prefix}`);
  return `${assertSafeKey(prefix.slice(0, -1))}/`;
}

export const RESULTS_PREFIX = 'results/';
export const BASELINES_PREFIX = 'visual-baselines/';

/** Where baselines live on the local disk. Deliberately outside results/, which is per run. */
export function baselineRoot(): string {
  return process.env.VISUAL_BASELINE_DIR || path.join('./data', 'visual-baselines');
}

/**
 * A key, checked. A key is always relative and never climbs: it is built from ids and file
 * names, but one of those came from a URL, and a key of ../../.env is not an artifact.
 */
export function assertSafeKey(key: string): string {
  const normalized = key.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error(`Invalid artifact key: ${key}`);
  }
  return normalized;
}

/** The key for a file the runner wrote under ./results, or null when it is not under it. */
export function keyForLocalPath(filePath: string, cwd: string = process.cwd()): string | null {
  const relative = path.relative(cwd, path.resolve(cwd, filePath)).replace(/\\/g, '/');
  if (!relative.startsWith(RESULTS_PREFIX)) return null;
  try {
    return assertSafeKey(relative);
  } catch {
    return null;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentTypeFor(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
}

async function filesUnder(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return [];
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/** The disk, with the paths the application has always used. */
export function createLocalArtifactStore(cwd: string = process.cwd()): ArtifactStore {
  const pathFor = (key: string) => {
    const safe = assertSafeKey(key);
    return safe.startsWith(BASELINES_PREFIX)
      ? path.resolve(cwd, baselineRoot(), safe.slice(BASELINES_PREFIX.length))
      : path.resolve(cwd, safe);
  };

  return {
    kind: 'local',
    async read(key) {
      const file = pathFor(key);
      return (await fs.pathExists(file)) ? fs.readFile(file) : null;
    },
    async write(key, body) {
      const file = pathFor(key);
      await fs.ensureDir(path.dirname(file));
      await fs.writeFile(file, body);
    },
    async open(key) {
      const file = pathFor(key);
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) return null;
        return { stream: fs.createReadStream(file), contentType: contentTypeFor(key), size: stat.size };
      } catch {
        return null;
      }
    },
    async publishDirectory(localDir) {
      // Already where it is served from.
      return (await filesUnder(localDir)).length;
    },
    async deletePrefix(prefix) {
      const dir = pathFor(assertSafePrefix(prefix).slice(0, -1));
      const count = (await filesUnder(dir)).length;
      await fs.remove(dir);
      return count;
    },
  };
}

/** The part of the S3 client this store uses, so tests can stand in for it. */
export interface S3Like {
  send(command: GetObjectCommand | PutObjectCommand | ListObjectsV2Command | DeleteObjectsCommand): Promise<any>;
}

export interface S3StoreOptions {
  client: S3Like;
  bucket: string;
  /** Prepended to every key, so one bucket can hold several installations. */
  prefix?: string;
  cwd?: string;
}

function isMissing(error: any): boolean {
  return error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
}

async function toBuffer(body: any): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') return Buffer.from(await body.transformToByteArray());
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function createS3ArtifactStore(options: S3StoreOptions): ArtifactStore {
  const { client, bucket } = options;
  const cwd = options.cwd ?? process.cwd();
  const prefix = options.prefix ? `${options.prefix.replace(/\/+$/, '')}/` : '';
  const objectKey = (key: string) => `${prefix}${assertSafeKey(key)}`;

  const store: ArtifactStore = {
    kind: 's3',
    async read(key) {
      try {
        const answer = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
        return toBuffer(answer.Body);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async write(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey(key),
          Body: body,
          ContentType: contentType ?? contentTypeFor(key),
        }),
      );
    },
    async open(key) {
      try {
        const answer = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
        if (!answer.Body) return null;
        const stream = answer.Body instanceof Readable ? answer.Body : Readable.from(answer.Body as AsyncIterable<Buffer>);
        return { stream, contentType: answer.ContentType ?? contentTypeFor(key), size: answer.ContentLength };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async publishDirectory(localDir) {
      const files = await filesUnder(localDir);
      let published = 0;
      for (const file of files) {
        const key = keyForLocalPath(file, cwd);
        if (!key) continue;
        await store.write(key, await fs.readFile(file));
        published += 1;
      }
      // Only once every file is up: a failed upload leaves the local copy, which is the one
      // place that evidence still exists.
      await fs.remove(localDir);
      return published;
    },
    async deletePrefix(prefix) {
      const listPrefix = `${objectKey(assertSafePrefix(prefix).slice(0, -1))}/`;
      // Listed in full first, then deleted: removing objects between pages of a listing is not
      // something every S3-compatible store pages through the same way.
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: listPrefix, ContinuationToken: continuationToken }),
        );
        keys.push(...((page.Contents ?? []).map((object: { Key?: string }) => object.Key).filter(Boolean) as string[]));
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);

      // At most 1000 keys per request.
      for (let start = 0; start < keys.length; start += 1000) {
        const batch = keys.slice(start, start + 1000);
        await client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
        );
      }
      return keys.length;
    },
  };
  return store;
}

export type ArtifactStoreKind = 'local' | 's3';

/** The store this installation is configured for, from the environment. */
export function artifactStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ArtifactStore {
  const kind = (env.ARTIFACT_STORE ?? 'local').toLowerCase();
  if (kind === 'local') return createLocalArtifactStore();
  if (kind !== 's3') {
    throw new Error(`ARTIFACT_STORE must be "local" or "s3", not "${env.ARTIFACT_STORE}".`);
  }
  if (!env.S3_BUCKET) throw new Error('ARTIFACT_STORE=s3 needs S3_BUCKET.');

  const config: S3ClientConfig = {
    region: env.S3_REGION || 'us-east-1',
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    // MinIO and most self-hosted stores address buckets by path, not by subdomain.
    forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === 'true' : !!env.S3_ENDPOINT,
    ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } }
      : {}),
  };
  return createS3ArtifactStore({ client: new S3Client(config), bucket: env.S3_BUCKET, prefix: env.S3_PREFIX });
}

let configured: ArtifactStore | undefined;

/** The store every caller uses, built on first use so a bad configuration fails where it is used. */
export function artifactStore(): ArtifactStore {
  configured ??= artifactStoreFromEnv();
  return configured;
}

/** For tests: replace the configured store. */
export function setArtifactStoreForTest(store: ArtifactStore | undefined): void {
  configured = store;
}
