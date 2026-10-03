import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { waitForWorker } from './wait-worker.mjs';

// Full product bootstrap in its own disposable project. No persisted credentials.
const project = `saas-production-check-${randomBytes(4).toString('hex')}`;
const cwd = fileURLToPath(new URL('.', import.meta.url));
const secrets = ['POSTGRES_ADMIN_PASSWORD', 'WFM_DATABASE_PASSWORD', 'REDIS_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'AGENT_RELAY_SECRET'];
const env = { ...process.env, ...Object.fromEntries(secrets.map(key => [key, randomBytes(32).toString('hex')])),
  WEBFLOW_PUBLIC_URL: 'https://saas-check.example.com', WFM_SAAS_ALLOWLIST: '[]', WFM_SAAS_PORT: '0', COMPOSE_PROGRESS: 'plain' };
function compose(args, capture = false, allowFailure = false) {
  const result = spawnSync('docker', ['compose', '-p', project, '-f', 'compose.yml', ...args],
    { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout: 1_800_000 });
  if (!allowFailure && result.status !== 0) throw new Error(`Production Compose check failed (${args[0]})`);
  return capture ? result.stdout.trim() : result.status;
}
try {
  compose(['up', '-d', '--build', '--wait', '--wait-timeout', '150']);
  const port = compose(['port', 'api-guard', '5000'], true);
  assert.match(port, /^127\.0\.0\.1:\d+$/);
  const base = `http://${port}`;
  assert.equal((await fetch(`${base}/api/user`)).status, 401);
  const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'saas-check', email: 'saas-check@example.com', password: randomBytes(24).toString('hex') }) });
  assert.equal(registration.status, 201, 'First account registration must write through the tenant role');
  const roles = compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'webflowmaster', '-tAc',
    "SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname IN ('app_user','wfm_runtime') ORDER BY rolname"], true);
  assert.equal(roles, 'app_user|f|f|f|f\nwfm_runtime|f|f|f|t');
  compose(['exec', '-T', 'worker', 'node', '-e',
    `${waitForWorker.toString()};const{Queue}=require('bullmq');const q=new Queue('test-execution-queue',{connection:{url:process.env.REDIS_URL}});waitForWorker(q).then(()=>q.close()).catch(e=>{console.error(e.message);process.exit(1)})`]);
  console.log('PASS actual production images, loopback ingress, non-superuser runtime, tenant registration and live queue worker');
} finally {
  compose(['down', '--volumes', '--remove-orphans', '--rmi', 'local'], false, true);
}
