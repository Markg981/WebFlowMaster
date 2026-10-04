import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import WebSocket, { WebSocketServer } from 'ws';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { AgentRelay } from './relay';
import { AgentHttp } from './agent-fetch';
import { runAgent } from '../../scripts/wfm-agent';
import { runApiRequest } from '../api-test-runner';
import { signTicket } from './agent-credentials';
import { AGENT_PROTOCOL_VERSION } from '@shared/agents';
import { runProtocolOnAgent } from './agent-protocol';
import { requiredApiFeatures } from './api-protocol-features';

const secret = 'protocol-relay-test';
const proto = 'syntax = "proto3"; package lab; service Echo { rpc Say (Message) returns (Message); rpc Watch (Message) returns (stream Message); } message Message { string text = 1; }';
let server: http.Server;
let relay: AgentRelay;
let agent: ReturnType<typeof runAgent>;
let wsServer: WebSocketServer;
let rpc: grpc.Server;
let base: string;
let wsUrl: string;
let rpcUrl: string;
let tlsRpcUrl: string;
let tlsValues: Record<string, string>;
let temp: string;
const borrow = vi.fn();
let transport: AgentHttp;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(relay.availability(new URL(req.url!, 'http://relay').searchParams.get('ticket')!)));
  });
  relay = new AgentRelay({
    authenticate: async (token) => token === 'wfa_lab' || token === 'wfa_old'
      ? { id: token, organizationId: 1, pool: token === 'wfa_lab' ? 'lab' : 'old', name: token }
      : null,
    secret: () => secret,
  });
  relay.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv('AGENT_RELAY_URL', base);
  vi.stubEnv('AGENT_RELAY_SECRET', secret);
  agent = runAgent({ url: base, token: 'wfa_lab', maxSessions: 2, browsers: [], log: () => {} });
  await agent.ready;
  transport = new AgentHttp({ organizationId: 1, pool: 'lab' }, borrow);
  wsServer = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wsServer.on('listening', resolve));
  wsUrl = `ws://127.0.0.1:${(wsServer.address() as AddressInfo).port}`;
  wsServer.on('connection', (ws, req) => ws.on('message', (message) => ws.send(JSON.stringify({ text: message.toString(), auth: req.headers.authorization }))));
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-agent-test-'));
  const file = path.join(temp, 'echo.proto');
  await fs.writeFile(file, proto);
  const definition = loader.loadSync(file);
  rpc = new grpc.Server();
  rpc.addService(definition['lab.Echo'] as grpc.ServiceDefinition, {
    Watch: (call: grpc.ServerWritableStream<{ text: string }, { text: string }>) => { call.write({ text: call.request.text }); call.write({ text: 'complete' }); call.end(); },
    Say: (call: grpc.ServerUnaryCall<{ text: string }, { text: string }>, callback: grpc.sendUnaryData<{ text: string }>) => {
      if (call.request.text === 'hang') return;
      if (call.request.text === 'missing') return callback({ code: grpc.status.NOT_FOUND, details: 'No such item' });
      const metadata = new grpc.Metadata();
      metadata.set('x-agent-service', 'lab');
      call.sendMetadata(metadata);
      callback(null, { text: `${call.request.text}:${call.metadata.get('authorization')[0]}` });
    },
  });
  const port = await new Promise<number>((resolve, reject) => rpc.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : resolve(port)));
  rpcUrl = `grpc://127.0.0.1:${port}/lab.Echo/Say`;
  const fixture = path.resolve('server/tests/fixtures/grpc-tls');
  const [ca, cert, key, serverCert, serverKey] = await Promise.all(['ca.crt', 'client.crt', 'client.key', 'server.crt', 'server.key'].map(name => fs.readFile(path.join(fixture, name), 'utf8')));
  tlsValues = { secret_ca: ca, secret_cert: cert, secret_key: key };
  const tlsPort = await new Promise<number>((resolve, reject) => rpc.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createSsl(Buffer.from(ca), [{ private_key: Buffer.from(serverKey), cert_chain: Buffer.from(serverCert) }], true), (error, port) => error ? reject(error) : resolve(port)));
  tlsRpcUrl = `grpcs://localhost:${tlsPort}/lab.Echo/Watch`;
});

afterAll(async () => {
  await transport?.close();
  await agent?.stop();
  relay?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  wsServer?.clients.forEach((ws) => ws.terminate());
  await new Promise<void>((resolve) => wsServer?.close(() => resolve()));
  rpc?.forceShutdown();
  if (temp) await fs.remove(temp);
  vi.unstubAllEnvs();
});

it('runs WebSocket on a browserless agent and evaluates auth, variables and captures on the runner', async () => {
  const result = await runApiRequest({
    method: 'WS', url: wsUrl, body: { send: ['hello {{name}}'], until: 1 },
    auth: { type: 'bearer', params: { token: '{{token}}' } },
    assertions: [{ id: 'auth', enabled: true, source: 'body_json_path', comparison: 'equals', targetValue: 'Bearer private', property: 'last.auth' }],
    extractions: [{ id: 'reply', name: 'reply', source: 'body_json_path', property: 'last.text' }],
  }, { name: 'lab', token: 'private' }, transport.fetch);
  expect(result.error).toBeUndefined();
  expect(result.passed).toBe(true);
  expect(result.extracted).toEqual({ reply: 'hello lab' });
  expect(borrow).not.toHaveBeenCalled();
});

it('runs a unary gRPC call on the agent with the supplied proto and authorization metadata', async () => {
  const result = await runApiRequest({
    method: 'GRPC', url: rpcUrl, protoDefinition: proto, body: { text: '{{name}}' },
    auth: { type: 'bearer', params: { token: 'private' } },
    assertions: [{ id: 'status', enabled: true, source: 'status_code', comparison: 'equals', targetValue: '0' }, { id: 'body', enabled: true, source: 'body_json_path', comparison: 'equals', targetValue: 'lab:Bearer private', property: 'text' }],
  }, { name: 'lab' }, transport.fetch);
  expect(result.error).toBeUndefined();
  expect(result.passed).toBe(true);
  expect(borrow).not.toHaveBeenCalled();
  expect(result.headers?.['x-agent-service']).toBe('lab');
});

it('rejects a local gRPC deadline instead of accepting a partial execution', async () => {
  await expect(runProtocolOnAgent({ organizationId: 1, pool: 'lab' }, {
    protocol: 'grpc', url: rpcUrl, proto, body: '{"text":"hang"}', headers: {}, timeoutMs: 50,
  })).rejects.toThrow(/deadline|timeout/i);
});

it('keeps gRPC error statuses available to assertions instead of reporting a transport error', async () => {
  const result = await runApiRequest({ method: 'GRPC', url: rpcUrl, protoDefinition: proto,
    body: { text: 'missing' }, assertions: [{ id: 'missing', enabled: true, source: 'status_code', comparison: 'equals', targetValue: '5' }],
  }, {}, transport.fetch);
  expect(result.error).toBeUndefined();
  expect(result.passed).toBe(true);
});

it('enforces advanced response bounds on the agent instead of ignoring the supplied configuration', async () => {
  const result = await runApiRequest({ method: 'WS', url: wsUrl, body: { send: ['oversized'], until: 1 }, protocolConfig: { maxBytes: 1 } }, {}, transport.fetch);
  expect(result.passed).toBe(false);
  expect(result.error).toMatch(/byte|limit/i);
});

it('does not require conversation capabilities for an ordinary unary steps field', async () => {
  expect(await requiredApiFeatures({ protocol: 'grpc', url: rpcUrl, proto, headers: {}, body: '{"steps":[]}', timeoutMs: 1000 })).toEqual([]);
});

it('resolves secret references and executes verified mutual TLS streaming on an agent', async () => {
  const result = await runApiRequest({ method: 'GRPC', url: tlsRpcUrl, protoDefinition: proto, body: { text: 'mtls-agent' }, protocolConfig: { tls: { rootCa: '{{secret_ca}}', clientCertificate: '{{secret_cert}}', clientKey: '{{secret_key}}' } } }, tlsValues, transport.fetch);
  expect(result.error).toBeUndefined();
  expect(result.passed).toBe(true);
  expect(result.body).toMatchObject({ count: 2, last: { text: 'complete' } });
});

it('relays a bounded transcript whose JSON representation exceeds 16 MiB', async () => {
  const message = '"'.repeat(3 * 1024 * 1024);
  const result = await runApiRequest({ method: 'WEBSOCKET', url: wsUrl,
    body: { steps: [{ type: 'send', message }, { type: 'receive' }, { type: 'end' }] },
    protocolConfig: { maxBytes: 8 * 1024 * 1024 },
  }, {}, transport.fetch);
  expect(result.error).toBeUndefined();
  expect(result.passed).toBe(true);
  expect((result.body as any).last.text).toBe(message);
});

it('runs a streamed gRPC method on the agent with ordered responses', async () => {
  const result = await runApiRequest({ method: 'GRPC', url: rpcUrl.replace('/Say', '/Watch'), protoDefinition: proto, body: { text: 'first' }, assertions: [{ id: 'count', enabled: true, source: 'body_json_path', property: 'count', comparison: 'equals', targetValue: '2' }] }, {}, transport.fetch);
  expect(result.error).toBeUndefined();
  expect(result.passed).toBe(true);
  expect(result.body).toMatchObject({ count: 2, last: { text: 'complete' } });
});

it('executes receive/capture/dependent send through the agent', async () => {
  const result = await runApiRequest({ method: 'WS', url: wsUrl, body: { steps: [{ type: 'send', message: 'hello' }, { type: 'receive' }, { type: 'capture', name: 'echo', property: 'text' }, { type: 'send', message: '{{capture.echo}}:done' }, { type: 'receive' }] }, protocolConfig: { timeoutMs: 1500 } }, {}, transport.fetch);
  expect(result.error).toBeUndefined();
  expect(result.body).toMatchObject({ last: { text: 'hello:done' }, count: 2, captures: { echo: 'hello' } });
});

it('cancels an active WebSocket request when its run transport closes and frees agent capacity', async () => {
  const connected = new Promise<WebSocket>((resolve) => wsServer.once('connection', resolve));
  const pending = runApiRequest({ method: 'WS', url: wsUrl, body: { send: [], waitMs: 60_000 } }, {}, transport.fetch);
  const target = await connected;
  const closed = new Promise<void>((resolve) => target.once('close', () => resolve()));
  await transport.close();
  const result = await pending;
  expect(result.error).toMatch(/aborted/i);
  await closed;
  await vi.waitFor(() => expect(agent.activeSessions()).toBe(0));
  await vi.waitFor(() => expect(relay.sessionsOf('wfa_lab')).toBe(0));
});

it('refuses protocol requests that do not match the signed session capability', async () => {
  const ticket = signTicket({ organizationId: 1, pool: 'lab', engine: 'chromium', headless: true, playwrightVersion: '0.0.0', apiProtocol: 'grpc' }, secret);
  const socket = new WebSocket(`${base.replace('http', 'ws')}/api/agent/v1/browser?ticket=${encodeURIComponent(ticket)}`);
  const reply = await new Promise<{ error: string }>((resolve, reject) => {
    socket.on('open', () => socket.send(JSON.stringify({ protocol: 'websocket', url: wsUrl, headers: {}, body: '', timeoutMs: 50 })));
    socket.on('message', (raw) => resolve(JSON.parse(raw.toString())));
    socket.on('error', reject);
  });
  expect(reply.error).toMatch(/does not match.*authorized/);
  socket.close();
});

it('refuses to use another organization’s pool without sending a target request', async () => {
  const other = new AgentHttp({ organizationId: 2, pool: 'lab' }, borrow);
  const result = await runApiRequest({ method: 'WS', url: wsUrl, body: { send: ['no'], until: 1 } }, {}, other.fetch);
  expect(result.passed).toBe(false);
  expect(result.error).toMatch(/No agent.*lab/);
});

it('keeps old agents connected but asks for an upgrade when they lack protocol support', async () => {
  const old = new WebSocket(`${base}/api/agent/v1/connect`, { headers: { Authorization: 'Bearer wfa_old' } });
  await new Promise<void>((resolve) => {
    old.on('open', () => old.send(JSON.stringify({ type: 'hello', protocol: AGENT_PROTOCOL_VERSION, agentVersion: '1.0.0', playwrightVersion: '1.0.0', hostname: 'old', browsers: ['chromium'], maxSessions: 1 })));
    old.once('message', () => resolve());
  });
  try {
    const result = await runApiRequest({ method: 'WS', url: wsUrl }, {}, new AgentHttp({ organizationId: 1, pool: 'old' }, borrow).fetch);
    expect(result.error).toMatch(/update|download.*agent/i);
    const ticket = signTicket({ organizationId: 1, pool: 'old', engine: 'chromium', headless: true, playwrightVersion: '1.0.0' }, secret);
    expect(relay.availability(ticket)).toEqual({ available: true });
  } finally {
    old.close();
  }
});

it('does not assign advanced protocol tickets to native v1 agents, while retaining legacy availability', async () => {
  const old = new WebSocket(`${base}/api/agent/v1/connect`, { headers: { Authorization: 'Bearer wfa_old' } });
  await new Promise<void>((resolve) => {
    old.on('open', () => old.send(JSON.stringify({ type: 'hello', protocol: AGENT_PROTOCOL_VERSION, agentVersion: '1.0.0', playwrightVersion: '1.0.0', hostname: 'native-v1', browsers: [], apiProtocols: ['grpc', 'websocket'], maxSessions: 1 })));
    old.once('message', () => resolve());
  });
  try {
    const common = { organizationId: 1, pool: 'old', engine: 'chromium' as const, headless: true, playwrightVersion: '0.0.0', apiProtocol: 'grpc' as const };
    expect(relay.availability(signTicket(common, secret))).toEqual({ available: true });
    const advanced = signTicket({ ...common, apiFeatures: ['native-protocol-v2'] } as any, secret);
    expect(relay.availability(advanced)).toMatchObject({ available: false, reason: expect.stringMatching(/update|agent/i) });
  } finally { old.close(); }
});
