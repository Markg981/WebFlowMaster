/**
 * SEC-25…30: the mobile tests, grids, inspector and quarantine stay inside their organization and
 * their project. Run after `npm run collaudo:prepare` and `npm run collaudo:mobile` (the "Lab" grid
 * and the test "Ricerca Wikipedia" of MOB-16):
 *
 *   npm run collaudo:sicurezza-mobile
 *
 * Signs in owner.b and marco@acme.test (an editor outside "Progetto P") itself; leaves in B a
 * BrowserStack grid, a mobile test, a project, a requirement and a TestRail connection, all "SEC · …".
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const HERE = dirname(fileURLToPath(import.meta.url));
const PASSWORD = 'Collaudo.2026!';

let failures = 0;
const ok = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const list = (d) => (Array.isArray(d) ? d : d?.items ?? d?.data ?? []);

function client(cookie) {
  return async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, text };
  };
}
const saved = (user) => client(JSON.parse(readFileSync(join(HERE, '.sessions', `${user}.json`), 'utf8')).cookie);
async function signIn(username) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid='));
  if (!res.ok || !cookie) throw new Error(`Accesso di ${username}: ${res.status}`);
  return client(cookie);
}
const err = (r) => `${r.status} ${typeof r.data === 'object' ? r.data?.error ?? '' : String(r.data).slice(0, 80)}`;

const ownerA = saved('owner.a');
const editorA = saved('editor.a');
const viewerA = saved('viewer.a');
const ownerB = await signIn('owner.b');
const outsider = await signIn('marco@acme.test');

// ─── What A has (MOB-16) and what B needs ─────────────────────────────────────
const testA = list((await editorA('GET', '/api/mobile-tests')).data).find((t) => t.name === 'Ricerca Wikipedia');
const gridA = list((await editorA('GET', '/api/browser-grids')).data).find((g) => g.name === 'Lab');
if (!testA || !gridA) {
  console.log('Manca il test «Ricerca Wikipedia» o la griglia «Lab» di A: eseguire prima MOB-16 (npm run collaudo:mobile).');
  process.exit(1);
}
const findOr = async (api, path, name, body) => list((await api('GET', path)).data).find((x) => x.name === name) ?? (await api('POST', path, body)).data;
const gridB = await findOr(ownerB, '/api/browser-grids', 'SEC · BrowserStack B', { name: 'SEC · BrowserStack B', provider: 'browserstack', username: 'beta-user', key: 'beta-segreta-0001' });
const testB = await findOr(ownerB, '/api/mobile-tests', 'SEC · mobile B', { name: 'SEC · mobile B', platform: 'android', app: 'bs://beta-app', deviceName: 'Google Pixel 8', gridId: gridB.id, steps: [] });
const projectB = await findOr(ownerB, '/api/projects', 'SEC · progetto B', { name: 'SEC · progetto B' });
const requirementsB = (await ownerB('GET', '/api/requirements')).data;
const reqB = [...list(requirementsB), ...(requirementsB?.requirements ?? [])].find((r) => r.key === 'SECB-1')
  ?? (await ownerB('POST', '/api/requirements', { key: 'SECB-1', title: 'Requisito di B', kind: 'story' })).data;
const connB = await findOr(ownerB, '/api/test-management', 'SEC · TestRail B', { name: 'SEC · TestRail B', provider: 'testrail', baseUrl: 'http://simulatori:8080/testrail', username: 'collaudo@acme.test', projectKey: '3', token: 'collaudo-testrail' });
const mobileA = [{ type: 'mobile', id: testA.id }];

console.log('SEC-25 · test mobili nei piani');
let r = await ownerB('POST', '/api/test-plans', { name: `SEC25 ${Date.now()}`, selectedTests: mobileA });
ok('1: piano con il test di A', r.status === 400 && /do not exist/.test(r.text), err(r));
r = await ownerB('PUT', `/api/mobile-tests/${testB.id}`, { ...testB, gridId: gridA.id });
ok('2: test di B sulla griglia di A', r.status === 404 && /Grid not found/.test(r.text), err(r));
const pickable = list((await ownerB('GET', '/api/mobile-tests')).data);
ok('3: la procedura guidata vede solo test di B', pickable.length > 0 && pickable.every((t) => t.id !== testA.id), pickable.map((t) => t.name).join(', '));
const runs = (await editorA('GET', `/api/mobile-tests/${testA.id}`)).data;
ok('4: la chiave della griglia di B non compare nei run di A', !JSON.stringify(runs ?? {}).includes('beta-segreta-0001'));

console.log('SEC-26 · suite, requisiti e casi');
r = await ownerB('POST', '/api/suites', { name: `SEC26 ${Date.now()}`, kind: 'static', items: mobileA });
ok('1: suite statica con il test di A', r.status === 400 && /mobile tests do not exist/.test(r.text), err(r));
r = reqB?.id ? await ownerB('PUT', `/api/requirements/${reqB.id}/tests`, { items: mobileA }) : { status: 0, data: reqB };
ok('2: requisito di B con il test di A', r.status === 400 && /mobile tests do not exist/.test(r.text), err(r));
r = await ownerB('PUT', `/api/test-management/${connB.id}/cases`, { links: [{ ...mobileA[0], caseKey: 'C1' }] });
ok('3: caso di B col test di A', r.status === 400 && /tests do not exist/.test(r.text), err(r));
r = await ownerB('GET', `/api/test-management/${connB.id}/cases`);
ok('4: l\'elenco non contiene test di A', r.status === 200 && !list(r.data?.links ?? r.data).some((l) => l.type === 'mobile' && l.id === testA.id), err(r));

console.log('SEC-27 · inspector');
const opened = await editorA('POST', '/api/mobile-inspector', { gridId: gridA.id, platform: 'android', app: testA.app, deviceName: testA.deviceName });
const sid = opened.data?.id ?? opened.data?.sessionId;
ok('Inspector di editor.a aperto', opened.status === 201 && !!sid, err(opened));
if (sid) {
  for (const [m, p, b] of [['GET', `/api/mobile-inspector/${sid}`], ['POST', `/api/mobile-inspector/${sid}/actions`, { kind: 'tapAt', x: 1, y: 1 }], ['DELETE', `/api/mobile-inspector/${sid}`]]) {
    r = await ownerB(m, p, b);
    ok(`1: owner.b ${m} sulla sessione di A`, r.status === 404 && /has ended/.test(r.text), err(r));
  }
  r = await editorA('GET', `/api/mobile-inspector/${sid}`);
  ok('1: la sessione di A resta aperta', r.status === 200, err(r));
  await editorA('DELETE', `/api/mobile-inspector/${sid}`);
}
r = await ownerB('POST', '/api/mobile-inspector', { gridId: gridA.id, platform: 'android', app: testA.app, deviceName: testA.deviceName });
ok('2: owner.b apre sulla griglia di A', r.status === 404 && /Grid not found/.test(r.text), err(r));
const bs = list((await editorA('GET', '/api/browser-grids')).data).find((g) => g.provider === 'browserstack');
r = await editorA('POST', '/api/mobile-inspector', { gridId: bs?.id ?? gridA.id, platform: 'android', app: 'bs://app-123', deviceName: 'Google Pixel 99' });
ok('3: dispositivo inesistente → 502 senza chiave', r.status === 502 && !/beta-segreta|key=|access_key/i.test(r.text), err(r));
const audit = JSON.stringify((await ownerA('GET', '/api/organization/audit-log?limit=20')).data ?? {});
ok('3: audit «inspector aperto» con dispositivo', /Google Pixel 99/.test(audit) && /inspector/i.test(audit));

console.log('SEC-28 · Appium locale');
// With B's own grid: the 404 can only be the test of A.
r = await ownerB('POST', `/api/mobile-tests/${testA.id}/runs`, { gridId: gridB.id });
ok('1: run del test di A', r.status === 404, err(r));
r = await ownerB('POST', '/api/mobile-inspector', { gridId: gridA.id, platform: 'android', app: testA.app, deviceName: testA.deviceName });
ok('1: inspector con Lab di A', r.status === 404, err(r));
const labB = await findOr(ownerB, '/api/browser-grids', 'SEC · Lab B', { name: 'SEC · Lab B', provider: 'local_appium', endpoint: 'http://host.docker.internal:4723', agentPool: 'lab' });
r = await ownerB('POST', `/api/browser-grids/${labB.id}/test`);
// A's agent of pool "lab" is connected; B, with no agent of its own, must not see it.
ok('2: Lab di B non usa l\'agente di A', r.data?.ok === false && /No agent of pool "lab" is connected/.test(r.text), r.data?.message);
r = await editorA('POST', '/api/browser-grids', { name: `SEC28 ${Date.now()}`, provider: 'local_appium', endpoint: 'http://host.docker.internal:4723', agentPool: 'lab', key: 'non-va-salvata' });
ok('3: griglia locale con chiave → hasKey false', (r.status === 201 || r.status === 200) && r.data?.hasKey === false, `${err(r)} hasKey ${r.data?.hasKey}`);
if (r.data?.id) await editorA('DELETE', `/api/browser-grids/${r.data.id}`);

console.log('SEC-29 · progetti di un\'altra organizzazione');
r = await editorA('POST', '/api/mobile-tests', { name: `SEC29 ${Date.now()}`, platform: 'android', app: 'bs://x', deviceName: 'Google Pixel 8', projectId: projectB.id, steps: [] });
ok('1: nuovo test nel progetto di B', r.status === 400 && /Invalid project ID/.test(r.text), err(r));
r = await editorA('PUT', `/api/mobile-tests/${testA.id}`, { ...testA, projectId: projectB.id });
ok('2: test di A spostato nel progetto di B', r.status === 400 && /Invalid project ID/.test(r.text), err(r));

console.log('SEC-30 · quarantena');
const projectP = list((await ownerA('GET', '/api/projects')).data).find((p) => p.name === 'Progetto P');
const testP = await findOr(ownerA, '/api/mobile-tests', 'SEC · mobile in P', { name: 'SEC · mobile in P', platform: 'android', app: 'bs://x', deviceName: 'Google Pixel 8', projectId: projectP.id, steps: [] });
const existing = list((await ownerA('GET', '/api/quarantine')).data).find((q) => q.testType === 'mobile' && q.testId === testP.id);
if (existing) await ownerA('POST', `/api/quarantine/${existing.id}/release`, {});
const q = { testType: 'mobile', testId: testP.id, reason: 'x' };
r = await editorA('POST', '/api/quarantine', q);
ok('1: viewer del progetto (editor.a)', r.status === 403 && /view this test's project but not change it/.test(r.text), err(r));
r = await outsider('POST', '/api/quarantine', q);
ok('2: editor fuori dal progetto', r.status === 404, err(r));
r = await outsider('GET', '/api/quarantine');
ok('2: l\'elenco non mostra il test', !list(r.data).some((x) => x.testType === 'mobile' && x.testId === testP.id));
r = await ownerA('POST', '/api/quarantine', q);
ok('3: membro → 201', r.status === 201, err(r));
r = await ownerA('POST', '/api/quarantine', q);
ok('3: di nuovo → 409', r.status === 409 && /already in quarantine/.test(r.text), err(r));
const audit30 = JSON.stringify((await ownerA('GET', '/api/organization/audit-log?limit=20')).data ?? {});
ok('3: audit test.quarantined su mobile_test', /test\.quarantined/.test(audit30) && /mobile_test/.test(audit30));
r = await editorA('POST', '/api/quarantine', { testType: 'mobile', testId: testB.id, reason: 'x' });
ok('4: test mobile di B', r.status === 404, err(r));
void viewerA;

console.log(`\n${failures === 0 ? 'SEC-25…30 tutti verificati' : `${failures} verifiche non riuscite`}`);
process.exit(failures === 0 ? 0 : 1);
