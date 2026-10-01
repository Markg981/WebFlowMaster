/**
 * INT-08 with Jenkins: makes an API key for it, starts it with the shared library of
 * integrations/jenkins and runs the job "INT-08" on the plan "Collaudo · rete e trace".
 * Run after `npm run collaudo:prepare`:
 *
 *   npm run collaudo:jenkins            # start (or restart) and run the job
 *   npm run collaudo:jenkins -- stop
 *
 * Jenkins is at http://localhost:8088 (admin / Collaudo.2026!).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const JENKINS = 'http://localhost:8088';
const COMPOSE = ['compose', '-p', 'wfm-collaudo', '-f', 'docker-compose.yml', '-f', 'collaudo/docker-compose.collaudo.yml', '--profile', 'jenkins'];
const docker = (args, env = {}) => execFileSync('docker', [...COMPOSE, ...args], { stdio: 'inherit', env: { ...process.env, ...env } });

if (process.argv[2] === 'stop') {
  docker(['stop', 'jenkins']);
  process.exit(0);
}

const cookie = JSON.parse(readFileSync(join(HERE, '..', '.sessions', 'owner.a.json'), 'utf8')).cookie;
async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
const list = (d) => (Array.isArray(d) ? d : d?.items ?? d?.data ?? []);

const plan = list(await api('GET', '/api/test-plans')).find((p) => p.name === 'Collaudo · rete e trace');
if (!plan) throw new Error('Manca il piano «Collaudo · rete e trace»: eseguire prima npm run collaudo:prepare');
const staging = list(await api('GET', '/api/environments')).find((e) => e.name === 'Staging');
const { key } = await api('POST', '/api/api-keys', { name: `Jenkins INT-08 ${new Date().toISOString().slice(0, 16)}`, scopes: ['runs:write', 'runs:read'] });

console.log(`Avvio Jenkins (piano ${plan.id}${staging ? `, ambiente ${staging.id}` : ''})…`);
docker(['up', '-d', '--build', '--force-recreate', 'jenkins'], {
  WFM_JENKINS_API_KEY: key,
  WFM_JENKINS_PLAN: String(plan.id),
  WFM_JENKINS_ENVIRONMENT: staging ? String(staging.id) : '',
});

// Basic auth and a crumb from the same session: Jenkins wants both for a POST.
const auth = 'Basic ' + Buffer.from('admin:Collaudo.2026!').toString('base64');
let crumb;
let session = '';
for (let i = 0; i < 90 && !crumb; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const res = await fetch(`${JENKINS}/crumbIssuer/api/json`, { headers: { Authorization: auth } });
    if (res.ok && (await fetch(`${JENKINS}/job/INT-08/api/json`, { headers: { Authorization: auth } })).ok) {
      crumb = await res.json();
      session = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    }
  } catch { /* not up yet */ }
}
if (!crumb) throw new Error('Jenkins non risponde su http://localhost:8088 (docker compose logs jenkins)');

const headers = { Authorization: auth, Cookie: session, [crumb.crumbRequestField]: crumb.crumb };
const queued = await fetch(`${JENKINS}/job/INT-08/build`, { method: 'POST', headers });
if (queued.status !== 201) throw new Error(`Avvio del job: ${queued.status}`);
console.log('Job INT-08 avviato, attendo l\'esito…');

let build;
for (let i = 0; i < 300; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const res = await fetch(`${JENKINS}/job/INT-08/lastBuild/api/json`, { headers });
  if (res.ok) build = await res.json();
  if (build && !build.building) break;
}
const log = await (await fetch(`${JENKINS}/job/INT-08/lastBuild/consoleText`, { headers })).text();
console.log(log.split('\n').slice(-25).join('\n'));
console.log(`\nBuild #${build?.number}: ${build?.result} — ${JENKINS}/job/INT-08/${build?.number}/`);
process.exit(build?.result === 'SUCCESS' || build?.result === 'UNSTABLE' ? 0 : 1);
