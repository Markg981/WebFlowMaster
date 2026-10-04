import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runGrpc, runWebSocket } from './api-network-protocols';
import { runApiRequest } from './api-test-runner';

const proto = `syntax="proto3";package fixture;message Msg { string value=1; } service Test { rpc Unary(Msg) returns(Msg); rpc Server(Msg) returns(stream Msg); rpc Client(stream Msg) returns(Msg); rpc Bidi(stream Msg) returns(stream Msg); rpc Never(Msg) returns(stream Msg); rpc Error(Msg) returns(stream Msg); rpc RejectClient(stream Msg) returns(Msg); }`;
describe('bounded real protocol conversations', () => {
  let server: grpc.Server;
  let base: string;
  let wss: WebSocketServer;
  let wsurl: string;
  beforeAll(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'grpc-fixture-'));
    try {
      const file = path.join(dir, 'fixture.proto');
      await writeFile(file, proto);
      const definition = loader.loadSync(file);
      server = new grpc.Server();
      server.addService(definition['fixture.Test'] as grpc.ServiceDefinition, {
        Unary: (call: any, callback: any) => callback(null, call.request),
        Server: (call: any) => {
          call.write({ value: 'first' });
          call.write({ value: 'last' });
          const trailers = new grpc.Metadata();
          trailers.set('fixture-trailer', 'yes');
          call.end(trailers);
        },
        Client: (call: any, callback: any) => {
          const values: string[] = [];
          call.on('data', (m: any) => values.push(m.value));
          call.on('end', () => callback(null, { value: values.join(',') }));
        },
        Bidi: (call: any) => {
          call.write({ value: 'challenge' });
          call.on('data', (m: any) => call.write(m));
          call.on('end', () => call.end());
        },
        Never: (call: any) => {
          call.write({ value: 'first' });
        },
        RejectClient: (_call: any, callback: any) =>
          callback({ code: grpc.status.PERMISSION_DENIED, details: 'fixture rejected client' }),
        Error: (call: any) => {
          const metadata = new grpc.Metadata();
          metadata.set('error-trailer', 'fixture');
          call.emit('error', {
            code: grpc.status.PERMISSION_DENIED,
            details: 'fixture denied',
            metadata,
          });
        },
      });
      const port = await new Promise<number>((resolve, reject) =>
        server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) =>
          e ? reject(e) : resolve(p),
        ),
      );
      base = `grpc://127.0.0.1:${port}/fixture.Test/`;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => wss.once('listening', r));
    wsurl = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
    wss.on('connection', (socket, request) => {
      if (request.url === '/close') {
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ token: 'challenge' }));
      socket.on('message', (data) =>
        socket.send(JSON.stringify({ confirmed: data.toString() === 'challenge' })),
      );
    });
  });
  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.tryShutdown(() => r()));
    if (wss) {
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    }
  });
  const call = (method: string, body: string, config?: any) =>
    runGrpc({ url: new URL(base + method), body, proto, headers: {}, timeoutMs: 1000, config });
  it('dispatches unary and all three streaming modes with order and trailers', async () => {
    expect((await call('Unary', '{"value":"ordinary"}')).body).toMatchObject({ value: 'ordinary' });
    const streamed = await call('Server', '{}');
    expect(streamed.status).toBe(0);
    expect(streamed.body).toMatchObject({ count: 2, last: { value: 'last' } });
    expect(streamed.headers['fixture-trailer']).toBe('yes');
    expect(
      (await call('Client', '{"messages":[{"value":"one"},{"value":"two"}]}')).body,
    ).toMatchObject({ value: 'one,two' });
    expect((await call('Bidi', '{"messages":[{"value":"echo"}]}')).body).toMatchObject({
      count: 2,
      last: { value: 'echo' },
    });
  });
  it('queues immediate challenges and lazily substitutes captures on WS and bidi', async () => {
    const steps = [
      { type: 'receive' },
      { type: 'capture', name: 'token', property: 'token' },
      { type: 'send', message: '{{capture.token}}' },
      { type: 'receive', property: 'confirmed', equals: true },
    ];
    const response = await runWebSocket({
      url: wsurl,
      headers: {},
      body: JSON.stringify({ steps }),
      timeoutMs: 1000,
    });
    expect(response.body).toMatchObject({
      count: 2,
      last: { confirmed: true },
      captures: { token: 'challenge' },
    });
    const body = JSON.stringify({
      steps: [
        { type: 'receive' },
        { type: 'capture', name: 'token', property: 'value' },
        { type: 'send', message: { value: '{{capture.token}}' } },
        { type: 'receive', property: 'value', equals: 'challenge' },
        { type: 'end' },
      ],
    });
    expect((await call('Bidi', body)).body).toMatchObject({
      count: 2,
      captures: { token: 'challenge' },
    });
  });
  it('rejects resource overflow, missing captures and incompatible mode and local deadlines', async () => {
    await expect(call('Server', '{}', { maxMessages: 1 })).rejects.toThrow(/limit/i);
    await expect(call('Unary', '{}', { grpcMode: 'bidi' })).rejects.toThrow(/mode/i);
    await expect(
      call(
        'Bidi',
        JSON.stringify({ steps: [{ type: 'send', message: { value: '{{capture.missing}}' } }] }),
      ),
    ).rejects.toThrow(/capture/i);
    await expect(call('Never', '{}', { timeoutMs: 50 })).rejects.toThrow(/deadline|timeout/i);
  });
  it('fails an incomplete stream without assertions instead of passing the partial transcript', async () => {
    const result = await runApiRequest({ method: 'GRPC', url: base + 'Never', protoDefinition: proto, body: {}, protocolConfig: { timeoutMs: 50 } }, {});
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/deadline|timeout/i);
  });
  it('retains terminal remote errors and honors cancellation', async () => {
    const response = await call('Error', '{}');
    expect(response.status).toBe(7);
    expect(response.statusText).toContain('fixture denied');
    expect(response.headers['error-trailer']).toBe('fixture');
    expect(
      (
        await call(
          'RejectClient',
          JSON.stringify({
            messages: Array.from({ length: 200 }, () => ({ value: 'x'.repeat(1024) })),
          }),
        )
      ).status,
    ).toBe(7);
    const signal = AbortSignal.abort();
    await expect(
      runGrpc({
        url: new URL(base + 'Never'),
        body: '{}',
        proto,
        headers: {},
        timeoutMs: 1000,
        signal,
      }),
    ).rejects.toThrow(/abort/i);
  });
  it('rejects unmatched conditions, missing properties, early close and aggregate bytes', async () => {
    const ws = (steps: unknown[], url = wsurl) =>
      runWebSocket({ url, body: JSON.stringify({ steps }), headers: {}, timeoutMs: 1000 });
    await expect(
      ws([
        { type: 'receive', property: 'missing' },
        { type: 'capture', name: 'token' },
      ]),
    ).rejects.toThrow(/step 1.*missing/i);
    await expect(
      ws([{ type: 'receive', property: 'token', equals: 'wrong', timeoutMs: 20 }]),
    ).rejects.toThrow(/step 1.*timeout/i);
    await expect(ws([{ type: 'receive' }], wsurl + '/close')).rejects.toThrow(/closed/i);
    await expect(call('Server', '{}', { maxBytes: 1 })).rejects.toThrow(/limit/i);
    await expect(call('Unary', '{"value":"large"}', { maxBytes: 1 })).rejects.toThrow(/limit/i);
    await expect(runWebSocket({ url: wsurl, headers: {}, timeoutMs: 1000, config: { maxBytes: 64 }, body: JSON.stringify({ steps: [{ type: 'receive' }, ...Array.from({ length: 10 }, (_, i) => ({ type: 'capture', name: `copy${i}`, property: 'token' }))] }) })).rejects.toThrow(/capture.*limit/i);
  });
  it('keeps ordered client writes through stream backpressure', async () => {
    const messages = Array.from({ length: 200 }, (_, index) => ({
      value: `${index}:` + 'x'.repeat(1024),
    }));
    const response = await call('Client', JSON.stringify({ messages }), { timeoutMs: 5000 });
    expect(response.status).toBe(0);
    expect((response.body as { value: string }).value).toBe(messages.map((m) => m.value).join(','));
  });
});
