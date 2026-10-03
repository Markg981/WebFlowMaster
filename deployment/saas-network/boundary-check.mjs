import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';

const mode = process.argv[2] || 'allowed';
const role = process.argv[3] || 'api';
let passed = 0;
async function check(name, fn) {
  await fn();
  console.log(`PASS ${role}: ${name}`);
  passed++;
}
function connect(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1200);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}
function proxy(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'egress', port: 3128, method, path: url, agent: false }, res => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location });
    });
    req.on('connect', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode }); });
    req.on('error', reject);
    req.setTimeout(4000, () => req.destroy(new Error('Proxy check timeout')));
    req.end();
  });
}

await check('Docker DNS and approved database port', async () => assert.equal(await connect('postgres', 5432), true));
await check('approved Redis port', async () => assert.equal(await connect('redis', 6379), true));
await check('unapproved database port blocked', async () => assert.equal(await connect('postgres', 8080), false));
if (role === 'worker') await check('worker API relay available', async () => assert.equal(await connect('api', 5000), true));
await check('capabilities absent and privilege escalation disabled', async () => {
  const status = readFileSync('/proc/self/status', 'utf8');
  assert.match(status, /CapEff:\s*0000000000000000/);
  assert.match(status, /NoNewPrivs:\s*1/);
});

for (const [host, port] of [['11.254.254.10', 80], ['172.29.240.1', 80], ['172.29.240.1', 5432], ['172.29.241.1', 3128], ['169.254.169.254', 80], ['127.0.0.1', 80], ['::1', 80], ['::ffff:169.254.169.254', 80]]) {
  await check(`direct destination blocked (${host}:${port})`, async () => assert.equal(await connect(host, port), false));
}
await check('exact-host policy denial', async () => assert.equal((await proxy('http://denied.wfm.example/')).status, 403));
await check('exact-port policy denial', async () => assert.equal((await proxy('http://public.wfm.example:8443/')).status, 403));
for (const host of ['private.wfm.example', 'loopback.wfm.example', 'metadata.wfm.example', 'transition.wfm.example', '11.254.254.10', '127.0.0.1', '169.254.169.254', '[::1]', '[::ffff:169.254.169.254]']) {
  await check(`proxy rejects private/reserved/literal destination (${host})`, async () => assert.equal((await proxy(`http://${host}/`)).status, 403));
}
if (mode === 'allowed') {
  await check('allowed HTTP host and port via proxy', async () => assert.equal((await proxy('http://public.wfm.example/')).status, 200));
  await check('authorized request with sensitive query succeeds', async () => assert.equal((await proxy('http://public.wfm.example/path?token=wfm-sensitive-query-probe')).status, 200));
  await check('allowed CONNECT host and port via proxy', async () => assert.equal((await proxy('public.wfm.example:443', 'CONNECT')).status, 200));
  await check('allowed HTTP CONNECT port via proxy', async () => assert.equal((await proxy('public.wfm.example:80', 'CONNECT')).status, 200));
  await check('unapproved CONNECT port blocked', async () => assert.equal((await proxy('public.wfm.example:8443', 'CONNECT')).status, 403));
  await check('redirect destination reevaluated', async () => {
    const redirect = await proxy('http://public.wfm.example/redirect');
    assert.equal(redirect.status, 302);
    assert.equal((await proxy(redirect.location)).status, 403);
  });
} else {
  await check('empty policy denies HTTP', async () => assert.equal((await proxy('http://public.wfm.example/')).status, 403));
  await check('empty policy denies CONNECT', async () => assert.equal((await proxy('public.wfm.example:443', 'CONNECT')).status, 403));
}
console.log(`Boundary checks passed: ${passed} (${role}, ${mode})`);
