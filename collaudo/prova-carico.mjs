/**
 * OPS-15…17: the load test (scripts/wfm-load.ts) on the collaudo stack, with data of its own that it
 * removes afterwards. Run after `npm run collaudo:prepare`, with the API rate limit off so that the
 * reads measure the installation and not the limit:
 *
 *   API_RATE_LIMIT=0 wfmc up -d api
 *   npm run collaudo:carico
 *   wfmc up -d api                       # the limit back, for the other cases
 *
 * In each organization (owner.a for Acme, owner.b for Beta) it creates an API test «CARICO · salute»
 * calling the simulators, a plan «CARICO · piano» holding it, and a key with plans:read, runs:read
 * and runs:write; then it loads the installation with both, and finally deletes the plans (their
 * runs and results go with them), the API tests and the keys — also when the test fails or is
 * interrupted. Runs still going at that point are cancelled first.
 *
 * Variables: WFM_URL (default https://wfm.collaudo.test), CARICO_BERSAGLIO (what the API test
 * calls; default http://simulatori:8080/_admin/health), CARICO_ARGOMENTI (more options for
 * wfm-load, e.g. "--runs 30 --readers 20"), CARICO_MAX_IN_CORSO (the stack's
 * ORG_MAX_CONCURRENT_RUNS, default 2).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.WFM_URL ?? 'https://wfm.collaudo.test').replace(/\/+$/, '');
const TARGET = process.env.CARICO_BERSAGLIO ?? 'http://simulatori:8080/_admin/health';
const PASSWORD = 'Collaudo.2026!';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'CARICO ·';

async function signIn(username) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid='));
  if (!res.ok || !cookie) throw new Error(`Accesso di ${username}: ${res.status}`);
  return async (method, path, body) => {
    const send = () => fetch(BASE + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    // Once more on a network error: after the load phase the connection kept alive may be one the
    // server has already closed.
    const r = await send().catch(() => send());
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data };
  };
}
const list = (d) => (Array.isArray(d) ? d : d?.items ?? d?.data ?? []);

/** Removes whatever an earlier, interrupted run of this script left. */
async function removeLeftovers(api) {
  for (const plan of list((await api('GET', '/api/test-plans')).data).filter((p) => p.name?.startsWith(NAME))) {
    await cancelRuns(api, plan.id);
    await api('DELETE', `/api/test-plans/${plan.id}`);
  }
  for (const test of list((await api('GET', '/api/api-tests')).data).filter((t) => t.name?.startsWith(NAME))) await api('DELETE', `/api/api-tests/${test.id}`);
  for (const key of list((await api('GET', '/api/api-keys')).data).filter((k) => k.name?.startsWith(NAME) && !k.revokedAt)) await api('DELETE', `/api/api-keys/${key.id}`);
}

async function cancelRuns(api, planId) {
  const runs = list((await api('GET', `/api/test-plan-executions?planId=${planId}&limit=100`)).data);
  for (const run of runs.filter((r) => r.testPlanId === planId && ['queued', 'running'].includes(r.status))) {
    await api('POST', `/api/test-plan-executions/${run.id}/cancel`);
  }
}

async function prepare(api, label) {
  await removeLeftovers(api);
  const test = await api('POST', '/api/api-tests', { name: `${NAME} salute ${label}`, method: 'GET', url: TARGET });
  if (test.status !== 201) throw new Error(`Test API di ${label}: ${test.status} ${JSON.stringify(test.data)}`);
  const plan = await api('POST', '/api/test-plans', { name: `${NAME} piano ${label}`, selectedTests: [{ id: test.data.id, type: 'api' }] });
  if (plan.status !== 201) throw new Error(`Piano di ${label}: ${plan.status} ${JSON.stringify(plan.data)}`);
  const key = await api('POST', '/api/api-keys', { name: `${NAME} chiave ${label}`, scopes: ['plans:read', 'runs:read', 'runs:write'], expiresInDays: 1 });
  if (key.status !== 201 || !key.data?.key) throw new Error(`Chiave di ${label}: ${key.status} ${JSON.stringify(key.data)}`);
  return { api, planId: plan.data.id, key: key.data.key };
}

const orgs = [];
let code = 2;
try {
  for (const [user, label] of [['owner.a', 'A'], ['owner.b', 'B']]) orgs.push(await prepare(await signIn(user), label));
  console.log(`Dati pronti in A e B (bersaglio ${TARGET}).`);
  const extra = (process.env.CARICO_ARGOMENTI ?? '').split(/\s+/).filter(Boolean);
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/wfm-load.ts', '--url', BASE, ...orgs.flatMap((o) => ['--target', `${o.key}:${o.planId}`]), '--max-concurrent', process.env.CARICO_MAX_IN_CORSO ?? '2', '--json', 'collaudo/carico-esito.json', ...extra],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  );
  if (result.error) throw result.error;
  code = result.status ?? 2;
  console.log(code === 0 ? '\nOPS-15…17: entro le soglie (esito in collaudo/carico-esito.json).' : `\nOPS-15…17: ${code === 1 ? 'soglie superate' : 'prova non eseguita'} (esito in collaudo/carico-esito.json).`);
} catch (error) {
  console.error(`Prova di carico non eseguita: ${error.message}`);
} finally {
  // The test data does not stay: the runs and their results go with the plans.
  for (const org of orgs) await removeLeftovers(org.api).catch((error) => console.error(`Pulizia non riuscita: ${error.message}`));
  if (orgs.length > 0) console.log('Dati della prova rimossi.');
}
process.exit(code);
