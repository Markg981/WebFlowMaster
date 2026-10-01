/**
 * Brings a running collaudo stack to the state the protocol's cases start from, so a case fails
 * only for what the product does, never for something missing around it.
 *
 *   npm run collaudo:prepare
 *
 * Runs on the tester's machine, against https://wfm.collaudo.test (WFM_URL to change it), and
 * through the product's API as its users would. Running it again changes nothing that is there:
 * every object is looked up by name first. What it leaves behind:
 *
 *   - the people of collaudo/seed.mjs (it runs it in the api container);
 *   - a signed-in session per role in collaudo/.sessions/<user>.cookies, in curl's format
 *     (curl --cookie collaudo/.sessions/viewer.a.cookies ...), and .json for scripts;
 *   - environment "Staging" with baseUrl, USERNAME, PASSWORD, apiBase, token (ENV, API-05);
 *   - test "Login ok" (WEB, PLN) and plan "Collaudo · rete e trace" capturing network and trace,
 *     already run once with Staging, so a report with an HAR exists (REP-04);
 *   - project "Progetto P", restricted, editor.a as viewer, with a test in it (MEM-06).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const PASSWORD = 'Collaudo.2026!';
const HERE = dirname(fileURLToPath(import.meta.url));
const SESSIONS = join(HERE, '.sessions');
const COMPOSE = ['compose', '-p', 'wfm-collaudo', '-f', 'docker-compose.yml', '-f', 'collaudo/docker-compose.collaudo.yml'];

const step = (text) => console.log(`\n▸ ${text}`);
const ok = (text) => console.log(`  ✓ ${text}`);

async function login(username) {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Sign-in of ${username}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid='));
  if (!cookie) throw new Error(`Sign-in of ${username} returned no session cookie`);
  const body = await res.json().catch(() => ({}));
  if (body?.mfaRequired) throw new Error(`${username} has two-factor on: reset it (collaudo/README.md, "Credenziali perse")`);
  return cookie;
}

function saveSession(username, cookie) {
  const host = new URL(BASE).hostname;
  const value = cookie.slice('connect.sid='.length);
  const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  writeFileSync(
    join(SESSIONS, `${username}.cookies`),
    `# Netscape HTTP Cookie File\n#HttpOnly_${host}\tFALSE\t/\tTRUE\t${expires}\tconnect.sid\t${value}\n`,
  );
  writeFileSync(join(SESSIONS, `${username}.json`), JSON.stringify({ baseUrl: BASE, username, cookie }, null, 2));
}

function client(cookie) {
  return async function api(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return data;
  };
}

const list = (data, key) => (Array.isArray(data) ? data : (data?.[key] ?? data?.data ?? []));

const step_ = (id, type, targetElement, value) => ({
  id,
  action: { id: type, type, name: type, icon: '', description: '' },
  targetElement,
  value,
});
const el = (id, selector, tag) => ({ id, type: tag, selector, text: '', tag, attributes: {} });

const LOGIN_SEQUENCE = [
  step_('s1', 'navigate', null, '{{baseUrl}}/login'),
  step_('s2', 'input', el('e1', '#username', 'input'), '{{USERNAME}}'),
  step_('s3', 'input', el('e2', '#password', 'input'), '{{PASSWORD}}'),
  step_('s4', 'click', el('e3', 'button[type="submit"]', 'button'), ''),
  step_('s5', 'assertTextContains', el('e4', '#flash', 'div'), 'You logged into a secure area!'),
];

async function ensureTest(api, name, projectId) {
  const existing = list(await api('GET', '/api/tests'), 'tests').find((t) => t.name === name);
  if (existing) return existing;
  return api('POST', '/api/tests', {
    name,
    url: 'https://the-internet.herokuapp.com/login',
    sequence: LOGIN_SEQUENCE,
    elements: [],
    ...(projectId ? { projectId } : {}),
  });
}

async function ensureProject(api, name) {
  const existing = list(await api('GET', '/api/projects'), 'projects').find((p) => p.name === name);
  return existing ?? api('POST', '/api/projects', { name });
}

async function main() {
  mkdirSync(SESSIONS, { recursive: true });

  step('Persone (collaudo/seed.mjs)');
  execFileSync('docker', [...COMPOSE, 'exec', '-T', 'api', 'node', '/collaudo/seed.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });

  step('Sessioni per ruolo');
  const sessions = { 'owner.a': await login('owner.a') };
  saveSession('owner.a', sessions['owner.a']);
  ok('owner.a → collaudo/.sessions/owner.a.cookies');
  const owner = client(sessions['owner.a']);

  // Cases SSO-06 and MFA-08 leave the organization requiring single sign-on or a second factor,
  // and then every later case that signs in with a password fails for that and nothing else.
  // owner.a still signs in with a password under both, so it puts them back.
  const sso = (await owner('GET', '/api/organization/sso'))?.settings;
  if (sso?.required) {
    const { issuer, clientId, domains, defaultRole, enabled } = sso;
    await owner('PUT', '/api/organization/sso', { issuer, clientId, domains, defaultRole, enabled, required: false });
    ok('single sign-on non più obbligatorio (lasciato da SSO-06)');
  }
  await owner('PUT', '/api/organization/mfa-policy', { required: false });
  ok('secondo fattore non richiesto all\'organizzazione');

  for (const username of ['editor.a', 'viewer.a']) {
    sessions[username] = await login(username);
    saveSession(username, sessions[username]);
    ok(`${username} → collaudo/.sessions/${username}.cookies`);
  }
  const editor = client(sessions['editor.a']);

  step('Ambiente Staging');
  let staging = list(await editor('GET', '/api/environments'), 'environments').find((e) => e.name === 'Staging');
  if (!staging) staging = await editor('POST', '/api/environments', { name: 'Staging' });
  const have = new Set(list(await editor('GET', `/api/environments/${staging.id}/secrets`), 'secrets').map((s) => s.keyName));
  const secrets = {
    baseUrl: 'https://the-internet.herokuapp.com',
    USERNAME: 'tomsmith',
    PASSWORD: 'SuperSecretPassword!',
    apiBase: 'https://httpbin.org',
    token: 'collaudo-token',
  };
  for (const [keyName, value] of Object.entries(secrets)) {
    if (!have.has(keyName)) await editor('POST', `/api/environments/${staging.id}/secrets`, { keyName, value });
  }
  ok(`Staging (id ${staging.id}) con ${Object.keys(secrets).join(', ')}`);

  step('Test e piano con rete e trace');
  const loginTest = await ensureTest(editor, 'Login ok');
  ok(`test "Login ok" (id ${loginTest.id})`);
  const planName = 'Collaudo · rete e trace';
  let plan = list(await editor('GET', '/api/test-plans'), 'testPlans').find((p) => p.name === planName);
  if (!plan) {
    plan = await editor('POST', '/api/test-plans', {
      name: planName,
      captureNetwork: 'always',
      captureTrace: 'always',
      selectedTests: [{ id: loginTest.id, type: 'ui' }],
    });
  }
  ok(`piano "${planName}" (id ${plan.id})`);

  const runs = list(await editor('GET', `/api/test-plan-executions?planId=${plan.id}`), 'items')
    // REP-09 purges a run's evidence on purpose: such a run no longer has the HAR REP-04 opens.
    .filter((r) => r.completedAt && !r.artifactsPurgedAt);
  if (runs.length === 0) {
    const started = await editor('POST', `/api/run-test-plan/${plan.id}`, { environmentId: staging.id });
    const runId = started?.data?.id;
    process.stdout.write(`  … run ${runId} in corso`);
    const deadline = Date.now() + 5 * 60_000;
    let run;
    do {
      await new Promise((r) => setTimeout(r, 5000));
      process.stdout.write('.');
      run = await editor('GET', `/api/test-plan-executions/${runId}`);
    } while (!run.completedAt && Date.now() < deadline);
    console.log('');
    if (!run.completedAt) throw new Error(`Run ${runId} not finished after 5 minutes: is the worker up?`);
    ok(`run ${runId} concluso: ${run.status}`);
  } else {
    ok(`run già presente (${runs[0].id})`);
  }

  step('Progetto riservato P');
  // As owner.a: once P is restricted editor.a is only its viewer, and a second run would fail.
  const projectP = await ensureProject(owner, 'Progetto P');
  await ensureTest(owner, 'P · login', projectP.id);
  const { members } = await owner('GET', '/api/organization');
  const editorA = members.find((m) => m.username === 'editor.a');
  await owner('PUT', `/api/projects/${projectP.id}/access`, {
    restricted: true,
    members: [{ userId: editorA.id, role: 'viewer' }],
  });
  ok(`"Progetto P" (id ${projectP.id}) riservato, editor.a viewer`);

  console.log('\nAmbiente pronto. Verifica con: npm run collaudo:check');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
