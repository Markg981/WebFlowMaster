import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { chromium } from 'playwright';
import { browserEgressOptions } from './egress-proxy';
import { fetchTarget } from './outbound-http';
import { runGrpc, runWebSocket } from './api-network-protocols';

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const proto = 'syntax = "proto3"; package egress; service Echo { rpc Say (Message) returns (Message); } message Message { string text = 1; }';
const tunnels: string[] = [];
const forwarded: string[] = [];
const sockets = new Set<net.Socket>();
let target: http.Server;
let proxy: http.Server;
let ws: WebSocketServer;
let rpc: grpc.Server;
let targetPort: number;
let rpcPort: number;
let directory: string;
const listen = (server: http.Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

beforeAll(async () => {
  target = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://denied.test/secret' }).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"source":"allowed-fixture"}');
  });
  ws = new WebSocketServer({ server: target });
  ws.on('connection', socket => socket.on('message', message => socket.send(message)));
  targetPort = await listen(target);
  directory = await mkdtemp(join(tmpdir(), 'wfm-egress-'));
  const file = join(directory, 'echo.proto');
  await writeFile(file, proto);
  const pkg = grpc.loadPackageDefinition(loader.loadSync(file)) as any;
  rpc = new grpc.Server();
  rpc.addService(pkg.egress.Echo.service, { Say: (call: any, callback: any) => callback(null, call.request) });
  rpcPort = await new Promise<number>((resolve, reject) => rpc.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : resolve(port)));
  proxy = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://denied.test');
    forwarded.push(url.hostname);
    if (url.hostname !== 'allowed.test') { res.writeHead(403).end('Denied'); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: url.port, path: url.pathname, method: req.method }, response => {
      res.writeHead(response.statusCode || 500, response.headers); response.pipe(res);
    });
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  // Real CONNECT transport, mapping the reserved .test name to local fixtures. Destination
  // enforcement itself is exercised separately against the actual hardened Docker deployment.
  proxy.on('connect', (req, downstream, head) => {
    const authority = req.url || '';
    tunnels.push(authority);
    const match = /^allowed\.test:(\d+)$/.exec(authority);
    if (!match) { downstream.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const upstream = net.connect(Number(match[1]), '127.0.0.1', () => {
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(downstream); downstream.pipe(upstream);
    });
    for (const socket of [downstream, upstream]) {
      sockets.add(socket as net.Socket);
      socket.on('close', () => sockets.delete(socket as net.Socket));
      socket.on('error', () => { downstream.destroy(); upstream.destroy(); });
    }
  });
  const proxyPort = await listen(proxy);
  vi.stubEnv('WFM_EGRESS_PROXY', `http://127.0.0.1:${proxyPort}`);
});
beforeEach(() => { tunnels.length = 0; forwarded.length = 0; });
afterAll(async () => {
  vi.unstubAllEnvs();
  for (const socket of sockets) socket.destroy();
  ws.close(); rpc.forceShutdown();
  target.closeAllConnections(); proxy.closeAllConnections();
  await Promise.all([new Promise<void>(resolve => target.close(() => resolve())), new Promise<void>(resolve => proxy.close(() => resolve()))]);
  await rm(directory, { recursive: true, force: true });
});

describe('mandatory egress proxy transports', () => {
  it('sends target HTTP through CONNECT without resolving the target on the runner', async () => {
    const response = await fetchTarget(`http://allowed.test:${targetPort}/echo`);
    expect(await response.json()).toEqual({ source: 'allowed-fixture' });
    expect(tunnels).toContain(`allowed.test:${targetPort}`);
  });
  it('checks the redirected destination through the proxy instead of connecting directly', async () => {
    await expect(fetchTarget(`http://allowed.test:${targetPort}/redirect`)).rejects.toThrow();
    expect(tunnels).toContain('denied.test:80');
  });
  it('uses one proxied connection for connection-bound HTTP authentication', async () => {
    const connection = fetchTarget.oneConnection();
    try {
      for (let i = 0; i < 2; i++) expect(await (await connection.fetch(`http://allowed.test:${targetPort}/echo`)).json()).toEqual({ source: 'allowed-fixture' });
      expect(tunnels).toEqual([`allowed.test:${targetPort}`]);
    } finally { await connection.close(); }
  });
  it('tunnels WebSocket frames through the configured proxy', async () => {
    const response = await runWebSocket({ url: `ws://allowed.test:${targetPort}/echo`, headers: {}, body: '{"send":["proxied"],"until":1}', timeoutMs: 1500 });
    expect(response.body).toMatchObject({ last: 'proxied', count: 1 });
    expect(tunnels).toContain(`allowed.test:${targetPort}`);
  });
  it('tunnels unary gRPC with the original authority', async () => {
    const response = await runGrpc({ url: new URL(`grpc://allowed.test:${rpcPort}/egress.Echo/Say`), proto, headers: {}, body: '{"text":"proxied"}', timeoutMs: 1500 });
    expect(response).toMatchObject({ status: 0, body: { text: 'proxied' } });
    expect(tunnels).toContain(`allowed.test:${rpcPort}`);
  });
  it('forces real Chromium navigation and loopback through the proxy', async () => {
    const browser = await chromium.launch({ ...browserEgressOptions(), headless: true });
    try {
      const page = await browser.newPage();
      expect((await page.goto(`http://allowed.test:${targetPort}/echo`))?.status()).toBe(200);
      expect(await page.textContent('body')).toContain('allowed-fixture');
      expect((await page.goto(`http://127.0.0.1:${targetPort}/echo`))?.status()).toBe(403);
      expect(forwarded).toContain('127.0.0.1');
    } finally { await browser.close(); }
  }, 30_000);
});
