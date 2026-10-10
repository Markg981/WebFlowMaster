/**
 * Says whether the collaudo stack is ready for a cycle, before any case is run: a case that
 * fails on a stopped service or a missing session is a failure of the environment, and it
 * must show up here instead of in the results.
 *
 *   npm run collaudo:check
 *
 * Exits 1 when anything required is missing, naming what and how to fix it. Warnings (the
 * public sites the cases use, the sign-in limit) do not stop a cycle.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const SESSIONS = join(dirname(fileURLToPath(import.meta.url)), '.sessions');
const COMPOSE = ['compose', '-p', 'wfm-collaudo', '--env-file', 'collaudo/collaudo.env', '-f', 'docker-compose.yml', '-f', 'collaudo/docker-compose.collaudo.yml'];

const REQUIRED_SERVICES = ['api', 'worker', 'postgres', 'redis', 'caddy', 'keycloak', 'mailpit', 'ricevitore', 'display', 'loki', 'grafana', 'simulatori'];

let failures = 0;
let warnings = 0;
const pass = (text) => console.log(`  ✓ ${text}`);
const fail = (text, fix) => { failures++; console.log(`  ✗ ${text}${fix ? `\n      → ${fix}` : ''}`); };
const warn = (text) => { warnings++; console.log(`  ! ${text}`); };
const section = (text) => console.log(`\n${text}`);

async function reachable(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    return res;
  } catch (error) {
    return { ok: false, status: error.cause?.code ?? error.name };
  }
}

function session(username) {
  try {
    return JSON.parse(readFileSync(join(SESSIONS, `${username}.json`), 'utf8')).cookie;
  } catch {
    return null;
  }
}

async function api(cookie, path) {
  const res = await reachable(`${BASE}${path}`, { headers: { Cookie: cookie } });
  return res.ok ? res.json() : null;
}

section('Servizi');
try {
  const out = execFileSync('docker', [...COMPOSE, 'ps', '--format', 'json'], { encoding: 'utf8' });
  const rows = out.trim().startsWith('[') ? JSON.parse(out) : out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const running = new Map(rows.map((r) => [r.Service, r]));
  for (const name of REQUIRED_SERVICES) {
    const row = running.get(name);
    if (row?.State === 'running' && !/unhealthy/.test(row.Health ?? row.Status ?? '')) pass(name);
    else fail(`${name}: ${row ? row.Status : 'non avviato'}`, `wfmc up -d ${name}`);
  }
} catch (error) {
  fail(`docker compose non risponde (${error.message.split('\n')[0]})`, 'avviare Docker Desktop, poi wfmc up -d --build');
}

section('Raggiungibilità');
const app = await reachable(`${BASE}/api/user`);
if (app.status === 401) pass(`${BASE} (HTTPS valido)`);
else fail(`${BASE}: ${app.status}`, 'file hosts e certificato: collaudo/README.md, passi 2 e 4; NODE_EXTRA_CA_CERTS=collaudo/collaudo-root.crt');

const realm = await reachable('https://keycloak.collaudo.test/realms/acme/.well-known/openid-configuration');
realm.ok ? pass('Keycloak, realm acme') : fail(`Keycloak: ${realm.status}`, 'wfmc logs keycloak');

const mailpit = await reachable('http://localhost:8025/api/v1/info');
mailpit.ok ? pass('Mailpit http://localhost:8025') : fail(`Mailpit: ${mailpit.status}`, 'wfmc up -d mailpit');

const loki = await reachable('http://localhost:13100/ready');
loki.ok ? pass('Loki http://localhost:13100') : fail(`Loki: ${loki.status}`, 'wfmc up -d loki; poi wfmc up -d api worker per LOKI_URL');

const simulatori = await reachable('http://localhost:8090/_admin/health');
simulatori.ok ? pass('Servizi simulati http://localhost:8090') : fail(`Servizi simulati: ${simulatori.status}`, 'wfmc up -d simulatori');

const grafana = await reachable('http://localhost:13001/api/health');
grafana.ok ? pass('Grafana http://localhost:13001') : fail(`Grafana: ${grafana.status}`, 'wfmc up -d grafana');

// Opzionale: l'emulatore Android con Appium (npm run collaudo:mobile) serve all'area MOB.
const appium = await reachable('http://localhost:4723/status');
if (appium.ok) {
  const status = await appium.json().catch(() => null);
  pass(`Appium http://localhost:4723 (emulatore Android)${status?.value?.build?.version ? `, versione ${status.value.build.version}` : ''}`);
} else {
  warn(`Appium non raggiungibile (${appium.status}): i casi MOB-16 e successivi sull'emulatore restano Bloccati; avviarlo con npm run collaudo:mobile`);
}

for (const url of ['https://the-internet.herokuapp.com/login', 'https://httpbin.org/get', 'https://jsonplaceholder.typicode.com/posts/1']) {
  const res = await reachable(url);
  res.ok ? pass(url) : warn(`${url} non raggiungibile (${res.status}): i casi che la usano falliranno per l'ambiente, segnarli Bloccati`);
}

section('Sessioni per ruolo');
const cookies = {};
for (const [username, role] of [['owner.a', 'owner'], ['editor.a', 'editor'], ['viewer.a', 'viewer']]) {
  const cookie = session(username);
  const user = cookie && (await api(cookie, '/api/user'));
  if (user?.username === username && user.role === role) {
    cookies[username] = cookie;
    pass(`${username} (${role})`);
  } else {
    fail(`${username}: sessione ${cookie ? 'scaduta o ruolo cambiato' : 'assente'}`, 'npm run collaudo:prepare');
  }
}

section('Dati di partenza');
const editor = cookies['editor.a'];
const owner = cookies['owner.a'];
if (editor) {
  const environments = (await api(editor, '/api/environments')) ?? [];
  const staging = environments.find((e) => e.name === 'Staging');
  const keys = staging ? ((await api(editor, `/api/environments/${staging.id}/secrets`)) ?? []).map((s) => s.keyName) : [];
  const missing = ['baseUrl', 'USERNAME', 'PASSWORD', 'apiBase', 'token'].filter((k) => !keys.includes(k));
  staging && missing.length === 0 ? pass('ambiente Staging con i suoi segreti') : fail(`ambiente Staging: mancano ${missing.join(', ') || 'tutto'}`, 'npm run collaudo:prepare');

  const plans = (await api(editor, '/api/test-plans')) ?? [];
  const plan = (Array.isArray(plans) ? plans : plans.testPlans ?? []).find((p) => p.name === 'Collaudo · rete e trace');
  const runs = plan ? ((await api(editor, `/api/test-plan-executions?planId=${plan.id}`))?.items ?? []) : [];
  runs.some((r) => r.completedAt && !r.artifactsPurgedAt) ? pass('piano con rete e trace già eseguito (REP-04)') : fail('nessun run con cattura di rete', 'npm run collaudo:prepare');
}
if (owner) {
  const projects = (await api(owner, '/api/projects')) ?? [];
  const p = (Array.isArray(projects) ? projects : projects.projects ?? []).find((x) => x.name === 'Progetto P');
  p?.restricted ? pass('Progetto P riservato (MEM-06)') : fail('Progetto P assente o non riservato', 'npm run collaudo:prepare');
}

section('Impostazioni');
try {
  const limit = execFileSync('docker', [...COMPOSE, 'exec', '-T', 'api', 'printenv', 'AUTH_RATE_LIMIT'], { encoding: 'utf8' }).trim();
  if (Number(limit) > 20) pass(`AUTH_RATE_LIMIT=${limit}: ciclo automatico (per ACC-07 riportarlo a 20)`);
  else warn(`AUTH_RATE_LIMIT=${limit || 20}: 20 accessi ogni 15 minuti; per un ciclo automatico AUTH_RATE_LIMIT=1000 wfmc up -d api`);
} catch {
  warn('AUTH_RATE_LIMIT non leggibile dal container api');
}

console.log(`\n${failures === 0 ? 'Pronto' : 'Non pronto'}: ${failures} errori, ${warnings} avvisi.`);
process.exit(failures === 0 ? 0 : 1);
