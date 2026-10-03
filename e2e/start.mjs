// Starts the shipped bundles, not the development server. The stores must belong to this
// disposable installation: never point acceptance tests at a customer's or Collaudo database.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';

const database = new URL(process.env.DATABASE_URL || 'invalid:');
if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.pathname !== '/wfm_ci_e2e') {
  throw new Error('DATABASE_URL must name the dedicated PostgreSQL database wfm_ci_e2e.');
}
// Queue names are shared across installations unless the Redis store is separate. Merely
// isolating PostgreSQL would let this worker consume jobs from an ordinary local stack.
if (process.env.REDIS_URL !== 'redis://127.0.0.1:6388') {
  throw new Error('REDIS_URL must be redis://127.0.0.1:6388, the dedicated E2E store.');
}

mkdirSync('e2e-artifacts/services', { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: '5080',
  REGISTRATION: 'open',
  SESSION_COOKIE_SECURE: 'false',
  WEBFLOW_PUBLIC_URL: 'http://127.0.0.1:5080',
  APP_BASE_URL: 'http://127.0.0.1:5081',
};
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  fixture.close();
  for (const child of children) child.kill('SIGTERM');
  const deadline = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 5000);
  deadline.unref();
  process.exitCode = code;
}
function start(name, entry) {
  const log = createWriteStream(`e2e-artifacts/services/${name}.log`);
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', data => { log.write(data); process.stdout.write(`[${name}] ${data}`); });
  }
  child.on('error', error => { console.error(error); stop(1); });
  child.on('exit', code => {
    log.end();
    if (!stopping) { console.error(`${name} exited unexpectedly (${code})`); stop(1); }
  });
}
// A real HTTP target under our control; it does not replace any product endpoint.
const fixture = createServer((req, res) => {
  if (req.url !== '/echo') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ source: 'ci-real-http', method: req.method }));
});
fixture.on('error', error => { console.error(error); stop(1); });
fixture.listen(5081, '127.0.0.1', () => {
  start('worker', 'dist/worker.js');
  start('api', 'dist/index.js');
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
