import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { egressGuardProxyOrigin, guardedBrowserLaunchOptions } from './egress-guard-proxy';
import { EGRESS_POLICY_HEADER, egressPolicyDeps } from './egress-policy';

/**
 * The proxy the runner's browsers are launched behind decides each connection itself: by the
 * name the browser asked for, and by the address that name resolves to when it connects.
 */

let target: http.Server;
let wss: WebSocketServer;
let port: number;
let proxy: URL;
let hits: string[];
const realLookup = egressPolicyDeps.lookup;

beforeAll(async () => {
  hits = [];
  target = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/plain' }).end('secret');
  });
  wss = new WebSocketServer({ server: target });
  wss.on('connection', (_socket, req) => hits.push(`WS ${req.url}`));
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  port = (target.address() as AddressInfo).port;
  proxy = new URL(await egressGuardProxyOrigin());
  // What a rebinding record answers: a name whose address, at connect time, is the metadata service.
  egressPolicyDeps.lookup = ((hostname: string, options: any, callback: any) => {
    if (hostname !== 'rebind.test') return realLookup(hostname, options, callback);
    if (options?.all) return callback(null, [{ address: '169.254.169.254', family: 4 }]);
    callback(null, '169.254.169.254', 4);
  }) as net.LookupFunction;
});

afterAll(() => {
  egressPolicyDeps.lookup = realLookup;
  wss?.close();
  target?.closeAllConnections();
  target?.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  hits.length = 0;
});

/** Sends raw bytes to the proxy and returns what it answers first. */
function ask(request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port), proxy.hostname);
    let answer = '';
    socket.on('data', (chunk) => {
      answer += chunk.toString();
      if (answer.includes('\r\n\r\n')) {
        // Give a body a moment to follow its head.
        setTimeout(() => {
          socket.destroy();
          resolve(answer);
        }, 50);
      }
    });
    socket.on('error', reject);
    socket.on('close', () => resolve(answer));
    socket.write(request);
  });
}

const connect = (authority: string) =>
  ask(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);

describe('egress guard proxy', () => {
  it('opens a tunnel to an allowed address and refuses a denied one with the policy', async () => {
    expect(await connect(`127.0.0.1:${port}`)).toMatch(/^HTTP\/1\.1 200/);
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'deny');
    const refused = await connect(`127.0.0.1:${port}`);
    expect(refused).toMatch(/^HTTP\/1\.1 403/);
    expect(refused).toContain(`${EGRESS_POLICY_HEADER}: private`);
    expect(refused).toContain('127.0.0.1 is a private network address');
    vi.stubEnv('EGRESS_ALLOW_HOSTS', '127.0.0.1');
    expect(await connect(`127.0.0.1:${port}`)).toMatch(/^HTTP\/1\.1 200/);
  });

  it('refuses the metadata service by address and by a name that resolves to it', async () => {
    expect(await connect('169.254.169.254:80')).toContain(`${EGRESS_POLICY_HEADER}: metadata`);
    expect(await connect('[::ffff:169.254.169.254]:80')).toMatch(/^HTTP\/1\.1 403/);
    const rebound = await connect(`rebind.test:${port}`);
    expect(rebound).toMatch(/^HTTP\/1\.1 403/);
    expect(rebound).toContain('rebind.test resolves to a cloud metadata endpoint');
    expect(rebound).not.toContain('169.254');
  });

  it('relays a plain-HTTP request only to an allowed address', async () => {
    const get = () =>
      ask(`GET http://127.0.0.1:${port}/api/x HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
    expect(await get()).toMatch(/^HTTP\/1\.1 200[\s\S]*secret/);
    expect(hits).toEqual(['GET /api/x']);
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'deny');
    hits.length = 0;
    const refused = await get();
    expect(refused).toMatch(/^HTTP\/1\.1 403/);
    expect(refused).toContain('Blocked by the egress policy');
    expect(hits).toEqual([]);
  });

  it('relays a ws:// upgrade only to an allowed address', async () => {
    const upgrade = () =>
      ask(
        `GET http://127.0.0.1:${port}/socket HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
          'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
      );
    expect(await upgrade()).toMatch(/^HTTP\/1\.1 101/);
    expect(hits).toEqual(['WS /socket']);
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'deny');
    hits.length = 0;
    expect(await upgrade()).toMatch(/^HTTP\/1\.1 403/);
    expect(hits).toEqual([]);
  });

  it("launches the runner's browsers behind it, or behind WFM_EGRESS_PROXY when there is one", async () => {
    expect(await guardedBrowserLaunchOptions()).toEqual({
      proxy: { server: proxy.origin, bypass: '<-loopback>' },
      firefoxUserPrefs: { 'network.proxy.allow_hijacking_localhost': true },
    });
    vi.stubEnv('WFM_EGRESS_PROXY', 'http://egress-proxy:3128');
    expect((await guardedBrowserLaunchOptions()).proxy?.server).toBe('http://egress-proxy:3128');
  });
});
