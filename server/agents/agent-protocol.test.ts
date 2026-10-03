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

const secret = 'protocol-relay-test';
const proto = 'syntax = "proto3"; package lab; service Echo { rpc Say (Message) returns (Message); } message Message { string text = 1; }';
let server: http.Server;
let relay: AgentRelay;
let agent: ReturnType<typeof runAgent>;
let wsServer: WebSocketServer;
let rpc: grpc.Server;
let base: string;
let wsUrl: string;
let rpcUrl: string;
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

it('returns a gRPC deadline as a response that assertions can inspect', async () => {
  const response = await runProtocolOnAgent({ organizationId: 1, pool: 'lab' }, {
    protocol: 'grpc', url: rpcUrl, proto, body: '{"text":"hang"}', headers: {}, timeoutMs: 50,
  });
  expect(response.status).toBe(grpc.status.DEADLINE_EXCEEDED);
});

it('keeps gRPC error statuses available to assertions instead of reporting a transport error', async () => {
  const result = await runApiRequest({ method: 'GRPC', url: rpcUrl, protoDefinition: proto,
    body: { text: 'missing' }, assertions: [{ id: 'missing', enabled: true, source: 'status_code', comparison: 'equals', targetValue: '5' }],
  }, {}, transport.fetch);
  expect(result.error).toBeUndefined();
  expect(result.passed).toBe(true);
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
