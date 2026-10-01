/**
 * Smoke test of the simulated services through the product: connects each one the way a case
 * does and checks the product's answer. Run after `npm run collaudo:prepare`:
 *
 *   npm run collaudo:simulatori
 *
 * Leaves its connections behind, named "Simulato · …", for the cases to use.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const SIM = 'http://simulatori:8080';
const cookie = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '.sessions', 'editor.a.json'), 'utf8')).cookie;

let failures = 0;
const ok = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const list = (d) => (Array.isArray(d) ? d : d?.items ?? d?.connections ?? d?.trackers ?? []);

async function connection(label, body) {
  const existing = list((await api('GET', '/api/test-management')).data).find((c) => c.name === body.name);
  const conn = existing ?? (await api('POST', '/api/test-management', body)).data;
  if (!conn?.id) return ok(label, false, JSON.stringify(conn));
  connections[label] = conn.id;
  const check = await api('POST', `/api/test-management/${conn.id}/test`);
  ok(label, check.data?.ok === true, check.data?.detail ?? JSON.stringify(check.data));
}

async function tracker(label, body) {
  const existing = list((await api('GET', '/api/issue-trackers')).data).find((t) => t.name === body.name);
  const t = existing ?? (await api('POST', '/api/issue-trackers', body)).data;
  if (!t?.id) { ok(label, false, JSON.stringify(t)); return null; }
  const check = await api('POST', `/api/issue-trackers/${t.id}/test`);
  ok(label, check.data?.ok === true, check.data?.detail ?? JSON.stringify(check.data));
  return t;
}

const connections = {};
console.log('Test management');
await connection('TestRail', { name: 'Simulato · TestRail', provider: 'testrail', baseUrl: `${SIM}/testrail`, username: 'collaudo@acme.test', projectKey: '3', token: 'collaudo-testrail' });
await connection('Xray Cloud', { name: 'Simulato · Xray Cloud', provider: 'xray_cloud', baseUrl: `${SIM}/xray`, username: 'collaudo', projectKey: 'SHOP', testPlanKey: 'SHOP-100', token: 'collaudo-xray' });
await connection('Xray Server', { name: 'Simulato · Xray Server', provider: 'xray_server', baseUrl: `${SIM}/jira`, username: 'collaudo@acme.test', projectKey: 'SHOP', token: 'collaudo-jira' });
await connection('Zephyr Scale', { name: 'Simulato · Zephyr', provider: 'zephyr_scale', baseUrl: `${SIM}/zephyr`, projectKey: 'SHOP', token: 'collaudo-zephyr' });

console.log('Issue tracker e requisiti');
const jira = await tracker('Jira', { name: 'Simulato · Jira', provider: 'jira', baseUrl: `${SIM}/jira`, projectKey: 'SHOP', userEmail: 'collaudo@acme.test', token: 'collaudo-jira' });
const azure = await tracker('Azure DevOps', { name: 'Simulato · Azure DevOps', provider: 'azure_devops', baseUrl: `${SIM}/ado`, projectKey: 'Shop', token: 'collaudo-ado' });
if (jira) {
  const imported = await api('POST', '/api/requirements/import', { trackerId: jira.id, keys: ['SHOP-10', 'SHOP-999'] });
  ok('Import Jira SHOP-10, SHOP-999', imported.status === 200, JSON.stringify(imported.data).slice(0, 200));
}
if (azure) {
  const imported = await api('POST', '/api/requirements/import', { trackerId: azure.id, query: "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'User Story'" });
  ok('Import Azure DevOps WIQL', imported.status === 200, JSON.stringify(imported.data).slice(0, 200));
}

console.log('Pubblicazione e analisi AI (sul piano «Collaudo · rete e trace» di prepare)');
const plan = list((await api('GET', '/api/test-plans')).data).find((p) => p.name === 'Collaudo · rete e trace');
const loginTest = list((await api('GET', '/api/tests')).data).find((t) => t.name === 'Login ok');
const run = plan && list((await api('GET', `/api/test-plan-executions?planId=${plan.id}`)).data).find((r) => r.completedAt);
if (!run || !loginTest) {
  ok('Run di prepare presente', false, 'lanciare prima npm run collaudo:prepare');
} else {
  for (const [label, caseKey] of [['TestRail', 'C1'], ['Xray Cloud', 'SHOP-45'], ['Zephyr Scale', 'SHOP-T1']]) {
    await api('PUT', `/api/test-management/${connections[label]}/cases`, { links: [{ type: 'ui', id: loginTest.id, caseKey }] });
    const published = await api('POST', `/api/test-plan-executions/${run.id}/publish`, { connectionId: connections[label] });
    const p = published.data?.publication ?? published.data;
    ok(`Pubblicato su ${label}`, published.status === 200 && p?.status === 'published', `${p?.externalKey ?? ''} ${p?.message ?? published.data?.error ?? ''}`.trim());
  }

}

// REP-15/REP-21: a button found by a CSS class it no longer has.
const step = (id, type, selector, value, tag = 'input') => ({
  id, action: { id: type, type, name: type, icon: '', description: '' },
  targetElement: selector ? { id: `e-${id}`, type: tag, selector, text: '', tag, attributes: {} } : null, value,
});
const failingName = 'REP15 · bottone con classe cambiata';
const failingBody = {
  name: failingName, url: 'https://the-internet.herokuapp.com/login', elements: [],
  sequence: [
    step('s1', 'navigate', null, 'https://the-internet.herokuapp.com/login'),
    step('s2', 'input', '#username', 'tomsmith'),
    step('s3', 'input', '#password', 'SuperSecretPassword!'),
    step('s4', 'click', 'button.btn-vecchia', '', 'button'),
  ],
};
let failing = list((await api('GET', '/api/tests')).data).find((t) => t.name === failingName);
// REP-21 applies the proposed selector, which fixes the test: put the broken one back.
if (failing) await api('PUT', `/api/tests/${failing.id}`, failingBody);
else failing = (await api('POST', '/api/tests', failingBody)).data;
let failingPlan = list((await api('GET', '/api/test-plans')).data).find((p) => p.name === failingName);
if (!failingPlan) failingPlan = (await api('POST', '/api/test-plans', { name: failingName, elementTimeout: 5000, selectedTests: [{ id: failing.id, type: 'ui' }] })).data;
const started = await api('POST', `/api/run-test-plan/${failingPlan.id}`, {});
const runId = started.data?.data?.id;
let finished;
for (let i = 0; i < 40 && !finished?.completedAt; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  finished = (await api('GET', `/api/test-plan-executions/${runId}`)).data;
}
const report = (await api('GET', `/api/test-plan-executions/${runId}/report`)).data;
const failedResult = Object.values(report?.testGroupings ?? {}).flatMap((m) => Object.values(m.components).flatMap((c) => c.tests)).find((t) => t.status === 'Failed');
const analysis = failedResult && (await api('POST', `/api/test-plan-executions/${runId}/results/${failedResult.id}/ai-analysis`, { language: 'it' }));
const a = analysis?.data?.analysis ?? analysis?.data;
ok('Analisi AI (finto Gemini): Locator con selettore proposto', analysis?.status === 200 && a?.category === 'locator' && !!a?.proposedSelector, a ? `${a.category} · step ${a.failedStep} · ${a.proposedSelector} · ${a.summary}` : JSON.stringify(analysis?.data ?? 'nessun risultato fallito'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function runToEnd(id) {
  let r;
  for (let i = 0; i < 40 && !r?.completedAt; i++) { await wait(3000); r = (await api('GET', `/api/test-plan-executions/${id}`)).data; }
  return r;
}

// INT-10: a tracker with a wrong token, and the tracker's own error shown.
console.log('INT-10 · token sbagliato');
const wrong = list((await api('GET', '/api/issue-trackers')).data).find((t) => t.name === 'Simulato · Jira (token errato)')
  ?? (await api('POST', '/api/issue-trackers', { name: 'Simulato · Jira (token errato)', provider: 'jira', baseUrl: `${SIM}/jira`, projectKey: 'SHOP', userEmail: 'collaudo@acme.test', token: 'sbagliato' })).data;
const wrongCheck = wrong?.id && (await api('POST', `/api/issue-trackers/${wrong.id}/test`)).data;
ok('Il test fallisce con l\'errore del tracker', wrongCheck?.ok === false && !!wrongCheck?.detail, wrongCheck?.detail ?? JSON.stringify(wrongCheck));
if (wrong?.id) await api('DELETE', `/api/issue-trackers/${wrong.id}`);

// WEB-16: #usernameX does not exist; the fake Gemini proposes #username and the step heals.
console.log('WEB-16 · selettore corretto automaticamente');
const healName = 'WEB16 · selettore rotto';
// The protocol breaks a saved element: the repaired selector lands in the project's repository.
const project = list((await api('GET', '/api/projects')).data).find((p) => p.access !== 'viewer');
const elements = project ? (await api('GET', `/api/projects/${project.id}/elements`)).data ?? [] : [];
let element = elements.find((e) => e.name === 'WEB16 · username');
if (element) element = (await api('PUT', `/api/project-elements/${element.id}`, { selector: '#usernameX' })).data ?? element;
else if (project) element = (await api('POST', `/api/projects/${project.id}/elements`, { name: 'WEB16 · username', selector: '#usernameX', tag: 'input' })).data;
const healStep = step('s2', 'input', '#usernameX', 'tomsmith');
if (element?.id) healStep.targetElement.elementId = element.id;
const healBody = { ...failingBody, name: healName, ...(project ? { projectId: project.id } : {}), sequence: [failingBody.sequence[0], healStep] };
let healTest = list((await api('GET', '/api/tests')).data).find((t) => t.name === healName);
if (healTest) await api('PUT', `/api/tests/${healTest.id}`, healBody);
else healTest = (await api('POST', '/api/tests', healBody)).data;
let healPlan = list((await api('GET', '/api/test-plans')).data).find((p) => p.name === healName);
if (!healPlan) healPlan = (await api('POST', '/api/test-plans', { name: healName, elementTimeout: 5000, selectedTests: [{ id: healTest.id, type: 'ui' }] })).data;
const healRun = await runToEnd((await api('POST', `/api/run-test-plan/${healPlan.id}`, {})).data?.data?.id);
const healReport = healRun && (await api('GET', `/api/test-plan-executions/${healRun.id}/report`)).data;
const healText = JSON.stringify(healReport ?? {});
ok('Run passato con lo step healed', healRun?.status === 'completed' && /"healed":true/.test(healText), `stato ${healRun?.status}`);
const healed = project && element?.id && ((await api('GET', `/api/projects/${project.id}/elements`)).data ?? []).find((e) => e.id === element.id);
ok('Selettore corretto nel repository, da confermare', healed?.selector === '#username' && !!healed?.healedAt, healed ? `${healed.selector} · healedAt ${healed.healedAt}` : `elemento ${element?.id ?? 'non creato'}`);

// INT-07: GitHub connected to the simulator, a run started from "CI" on a commit of acme/shop.
console.log('INT-07 · stato del commit su GitHub');
const owner = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '.sessions', 'owner.a.json'), 'utf8')).cookie;
const asOwner = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: { Cookie: owner, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const gh = await asOwner('PUT', '/api/source-hosts/github', { apiUrl: `${SIM}/github`, token: 'collaudo-github' });
ok('GitHub (simulato) collegato', gh.status === 200 || gh.status === 201, JSON.stringify(gh.data).slice(0, 160));
const key = (await asOwner('POST', '/api/api-keys', { name: `Collaudo INT-07 ${Date.now()}`, scopes: ['runs:write', 'runs:read'] })).data?.key;
if (plan && key) {
  const sha = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const started = await fetch(`${BASE}/api/v1/plans/${plan.id}/runs`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ci: { provider: 'github', repository: 'acme/shop', commit: sha } }) });
  const startedRun = await started.json().catch(() => null);
  await runToEnd(startedRun?.id ?? startedRun?.data?.id);
  await wait(3000);
  const seen = await (await fetch(`http://localhost:8090/_admin/statuses`)).json();
  const states = seen.filter((s) => s.sha === sha).map((s) => s.state);
  ok('Stati in corso e finale sul commit, con link al report', states[0] === 'pending' && /success|failure/.test(states.at(-1) ?? '') && seen.some((s) => s.sha === sha && s.target_url), `${sha.slice(0, 10)}: ${states.join(' → ')}`);
  const host = list((await asOwner('GET', '/api/source-hosts')).data).find((h) => h.provider === 'github');
  ok('Nessun errore di invio in Impostazioni', host && !host.lastDeliveryError, host?.lastDeliveryError ?? '');
} else ok('Piano e chiave API per INT-07', false, `piano ${!!plan}, chiave ${!!key}`);

console.log(`\n${failures === 0 ? 'Simulatori raggiungibili dal prodotto' : `${failures} problemi`}. Cosa hanno ricevuto: http://localhost:8090`);
process.exit(failures === 0 ? 0 : 1);
