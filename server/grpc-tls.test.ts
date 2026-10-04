import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { executeGrpc, grpcCredentials } from './grpc-protocol';

const proto =
  'syntax="proto3";package tlsfixture;message Msg{string value=1;}service Test{rpc Unary(Msg)returns(Msg);}';
describe('verified gRPC mutual TLS', () => {
  let server: grpc.Server;
  let port: number;
  let rootCa: string;
  let clientCertificate: string;
  let clientKey: string;
  let encryptedKey: string;
  let serverKey: string;
  let serverCertificate: string;
  beforeAll(async () => {
    const base = path.resolve('server/tests/fixtures/grpc-tls');
    [rootCa, clientCertificate, clientKey, encryptedKey, serverKey, serverCertificate] =
      await Promise.all(
        [
          'ca.crt',
          'client.crt',
          'client.key',
          'client-encrypted.key',
          'server.key',
          'server.crt',
        ].map((name) => readFile(path.join(base, name), 'utf8')),
      );
    const dir = await mkdtemp(path.join(os.tmpdir(), 'grpc-tls-fixture-'));
    try {
      const file = path.join(dir, 'fixture.proto');
      await writeFile(file, proto);
      const definition = loader.loadSync(file);
      server = new grpc.Server();
      server.addService(definition['tlsfixture.Test'] as grpc.ServiceDefinition, {
        Unary: (call: any, callback: any) => callback(null, call.request),
      });
      port = await new Promise<number>((res, rej) =>
        server.bindAsync(
          '127.0.0.1:0',
          grpc.ServerCredentials.createSsl(
            Buffer.from(rootCa),
            [{ private_key: Buffer.from(serverKey), cert_chain: Buffer.from(serverCertificate) }],
            true,
          ),
          (err, p) => (err ? rej(err) : res(p)),
        ),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  afterAll(() => new Promise<void>((resolve) => server.tryShutdown(() => resolve())));
  const run = (host: string, tls: any) =>
    executeGrpc({
      url: new URL(`grpcs://${host}:${port}/tlsfixture.Test/Unary`),
      proto,
      headers: {},
      body: '{"value":"secure"}',
      timeoutMs: 1000,
      config: { tls },
    });
  it('accepts a trusted identity and encrypted client key', async () => {
    expect((await run('localhost', { rootCa, clientCertificate, clientKey })).status).toBe(0);
    expect(
      (
        await run('localhost', {
          rootCa,
          clientCertificate,
          clientKey: encryptedKey,
          keyPassphrase: 'fixture-passphrase',
        })
      ).status,
    ).toBe(0);
  });
  it('rejects absent client identity, wrong trust and wrong destination hostname', async () => {
    expect((await run('localhost', { rootCa })).status).not.toBe(0);
    expect(
      (await run('localhost', { rootCa: clientCertificate, clientCertificate, clientKey })).status,
    ).not.toBe(0);
    expect((await run('127.0.0.1', { rootCa, clientCertificate, clientKey })).status).not.toBe(0);
    const foreignCertificate = await readFile(
      path.resolve('server/tests/fixtures/saml-other.crt'),
      'utf8',
    );
    const foreignKey = await readFile(path.resolve('server/tests/fixtures/saml-other.key'), 'utf8');
    expect(
      (
        await run('localhost', {
          rootCa,
          clientCertificate: foreignCertificate,
          clientKey: foreignKey,
        })
      ).status,
    ).not.toBe(0);
  });
  it('validates key matching, PEM/passphrase and plaintext transport before connecting without leaking material', () => {
    for (const tls of [
      { rootCa: 'invalid-CA-value' },
      { clientCertificate, clientKey: serverKey },
      { clientCertificate, clientKey: encryptedKey, keyPassphrase: 'wrong-secret-value' },
    ]) {
      expect(() => grpcCredentials({ tls }, true)).toThrow(
        'Invalid gRPC TLS certificate, private key or passphrase.',
      );
    }
    expect(() => grpcCredentials({ tls: { rootCa } }, false)).toThrow(/grpcs/);
  });
});
