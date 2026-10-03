/** Runs the production transports inside the disposable guarded Docker namespaces. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { chromium, firefox, webkit } from 'playwright';
import { browserEgressOptions, targetEgressDispatcher } from '../server/egress-proxy';
import { runGrpc, runWebSocket } from '../server/api-network-protocols';

const proto = 'syntax = "proto3"; package egress; service Echo { rpc Say (Message) returns (Message); } message Message { string text = 1; }';
const host = 'public.wfm.example';
if (process.argv.includes('--fixture')) {
  http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://denied.wfm.example:8080/' }).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('allowed-transport-fixture');
  }).listen(8080, '0.0.0.0');
  const ws = new WebSocketServer({ port: 8081 });
  ws.on('connection', socket => socket.on('message', message => socket.send(message)));
  await writeFile('/tmp/echo.proto', proto);
  const pkg = grpc.loadPackageDefinition(loader.loadSync('/tmp/echo.proto')) as any;
  const rpc = new grpc.Server();
  rpc.addService(pkg.egress.Echo.service, { Say: (call: any, callback: any) => callback(null, call.request) });
  await new Promise<void>((resolve, reject) => rpc.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), error => error ? reject(error) : resolve()));
  console.log('Transport fixture ready');
} else {
  const dispatcher = targetEgressDispatcher();
  assert.ok(dispatcher, 'Probe requires the mandatory proxy');
  // Retry only fixture startup; every policy assertion below runs once and must pass.
  let ready = false;
  for (let attempt = 0; attempt < 50 && !ready; attempt++) {
    try { ready = (await fetch(`http://${host}:8080/`, { dispatcher } as any)).status === 200; } catch { /* starting */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'Allowed HTTP fixture must become reachable through the proxy');
  assert.equal(await (await fetch(`http://${host}:8080/`, { dispatcher } as any)).text(), 'allowed-transport-fixture');
  await assert.rejects(fetch(`http://${host}:8080/redirect`, { dispatcher } as any), 'Redirect must not escape the allowlist');
  for (const url of ['http://denied.wfm.example:8080/', 'http://127.0.0.1:5000/', 'http://169.254.169.254/', 'http://api:5000/']) {
    await assert.rejects(fetch(url, { dispatcher } as any), `Forbidden target ${url}`);
  }
  const ws = await runWebSocket({ url: `ws://${host}:8081/`, headers: {}, body: JSON.stringify({ send: ['proxy-echo'], until: 1 }), timeoutMs: 5000 });
  assert.equal(ws.text, 'proxy-echo');
  await assert.rejects(runWebSocket({ url: 'ws://denied.wfm.example:8081/', headers: {}, body: '', timeoutMs: 3000 }));
  const request = { proto, headers: {}, body: '{"text":"proxy-rpc"}', timeoutMs: 5000 };
  const rpc = await runGrpc({ ...request, url: new URL(`grpc://${host}:50051/egress.Echo/Say`) });
  assert.equal(rpc.status, 0, rpc.statusText);
  assert.equal((rpc.body as any).text, 'proxy-rpc');
  const denied = await runGrpc({ ...request, timeoutMs: 3000, url: new URL('grpc://denied.wfm.example:50051/egress.Echo/Say') });
  assert.notEqual(denied.status, 0, 'gRPC must fail when CONNECT is refused');
  for (const engine of [chromium, firefox, webkit]) {
    const browser = await engine.launch({ ...browserEgressOptions(), headless: true });
    try {
      const page = await browser.newPage();
      assert.equal((await page.goto(`http://${host}:8080/`))?.status(), 200);
      assert.match(await page.textContent('body') || '', /allowed-transport-fixture/);
      // Browsers may expose the proxy's 403 page or a navigation error; neither may succeed.
      for (const url of ['http://denied.wfm.example:8080/', 'http://127.0.0.1:5000/', 'http://api:5000/']) {
        let status = 0;
        try { status = (await page.goto(url, { timeout: 5000 }))?.status() || 0; } catch { /* proxy refusal */ }
        assert.notEqual(status, 200, `${engine.name()} bypass at ${url}`);
      }
      console.log(`PASS ${engine.name()} allowed target and blocked bypasses`);
    } finally { await browser.close(); }
  }
  await dispatcher.close();
  console.log('PASS production HTTP, redirects, WebSocket and gRPC through guarded namespaces');
  // This is a disposable probe process. grpc-js/Node global pools can retain idle handles.
  process.exit(0);
}
