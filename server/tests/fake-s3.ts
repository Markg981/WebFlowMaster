import { Readable } from 'stream';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Like } from '../artifact-store';

/**
 * A bucket in memory that answers the two commands the artifact store sends, the way S3 does:
 * a missing key is a NoSuchKey error, and a body comes back as a stream.
 */
export function fakeS3(options: { failPutsAfter?: number } = {}) {
  const objects = new Map<string, { body: Buffer; contentType?: string }>();
  let puts = 0;
  const client: S3Like & { objects: typeof objects; commands: string[] } = {
    objects,
    commands: [],
    async send(command: GetObjectCommand | PutObjectCommand | ListObjectsV2Command | DeleteObjectsCommand) {
      if (command instanceof ListObjectsV2Command) {
        const { Bucket, Prefix, ContinuationToken } = command.input;
        client.commands.push(`list ${Bucket}/${Prefix}`);
        // Two per page, so paging is exercised.
        const all = [...objects.keys()].filter((key) => key.startsWith(Prefix ?? '')).sort();
        const start = ContinuationToken ? Number(ContinuationToken) : 0;
        const page = all.slice(start, start + 2);
        const more = start + 2 < all.length;
        return { Contents: page.map((Key) => ({ Key })), IsTruncated: more, NextContinuationToken: more ? String(start + 2) : undefined };
      }
      if (command instanceof DeleteObjectsCommand) {
        const { Bucket, Delete } = command.input;
        client.commands.push(`delete ${Bucket} ${Delete?.Objects?.length ?? 0}`);
        for (const object of Delete?.Objects ?? []) objects.delete(object.Key!);
        return {};
      }
      if (command instanceof PutObjectCommand) {
        const { Bucket, Key, Body, ContentType } = command.input;
        client.commands.push(`put ${Bucket}/${Key}`);
        puts += 1;
        if (options.failPutsAfter !== undefined && puts > options.failPutsAfter) {
          throw Object.assign(new Error('SlowDown: please reduce your request rate'), { name: 'SlowDown' });
        }
        objects.set(Key!, { body: Buffer.from(Body as Buffer), contentType: ContentType });
        return {};
      }
      const { Bucket, Key } = command.input;
      client.commands.push(`get ${Bucket}/${Key}`);
      const found = objects.get(Key!);
      if (!found) throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
      return { Body: Readable.from([found.body]), ContentType: found.contentType, ContentLength: found.body.length };
    },
  };
  return client;
}
