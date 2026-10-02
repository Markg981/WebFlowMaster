/**
 * SSO-23…26: provisioning with SCIM 2.0. Keycloak has no SCIM client, so this script plays the
 * identity provider, speaking as Entra ID and Okta do. Run after `npm run collaudo:prepare`, with
 * single sign-on set up for acme.test (SSO-01) and the groups mapped (SSO-18):
 *
 *   npm run collaudo:scim
 *
 * Issues a token as owner.a (replacing any token issued before), then creates «scim.ada@acme.test»,
 * puts her in the group «wfm-editor», deactivates and reactivates her, and finally removes her and
 * the group, leaving Acme as it was.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const ok = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function call(headers, method, path, body) {
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, type: res.headers.get('content-type') ?? '' };
}
const cookie = JSON.parse(readFileSync(join(HERE, '.sessions', 'owner.a.json'), 'utf8')).cookie;
const owner = (method, path, body) => call({ Cookie: cookie, 'Content-Type': 'application/json' }, method, path, body);

const issued = await owner('POST', '/api/organization/sso/scim-token');
if (issued.status !== 201) {
  console.log(`Token non emesso (${issued.status} ${issued.data?.error ?? ''}): configurare prima il single sign-on di Acme (SSO-01).`);
  process.exit(1);
}
const scim = (method, path, body) =>
  call({ Authorization: `Bearer ${issued.data.token}`, 'Content-Type': 'application/scim+json' }, method, `/api/scim/v2${path}`, body);

console.log('SSO-23 · token e scoperta');
ok('URL di base', issued.data.baseUrl === `${BASE}/api/scim/v2`, issued.data.baseUrl);
const config = await scim('GET', '/ServiceProviderConfig');
ok('ServiceProviderConfig in application/scim+json', config.status === 200 && config.type.includes('application/scim+json'));
ok('senza token: 401', (await call({}, 'GET', '/api/scim/v2/Users')).status === 401);

console.log('SSO-24 · utenti');
const existing = await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "scim.ada@acme.test"')}`);
for (const u of existing.data?.Resources ?? []) await scim('DELETE', `/Users/${u.id}`);
const created = await scim('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'scim.ada@acme.test', externalId: 'collaudo-ada', active: true });
ok('creata', created.status === 201, `${created.status} ${created.data?.detail ?? ''}`);
const ada = created.data?.id;
ok('ritrovata per userName', (await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "scim.ada@acme.test"')}`)).data?.totalResults === 1);
ok('fuori dai domini: 400', (await scim('POST', '/Users', { userName: 'eve@altrove.test' })).status === 400);

console.log('SSO-25 · gruppi e ruoli');
const oldGroup = await scim('GET', `/Groups?filter=${encodeURIComponent('displayName eq "wfm-editor"')}`);
for (const g of oldGroup.data?.Resources ?? []) await scim('DELETE', `/Groups/${g.id}`);
const group = await scim('POST', '/Groups', { displayName: 'wfm-editor', members: [{ value: ada }] });
ok('gruppo inviato', group.status === 201);
const role = (await scim('GET', `/Users/${ada}`)).data?.['urn:ietf:params:scim:schemas:extension:webflowmaster:2.0:User']?.role;
ok('ruolo dal gruppo: editor (con la mappatura di SSO-18)', role === 'editor', role);

console.log('SSO-26 · disattivazione e rimozione');
const off = await scim('PATCH', `/Users/${ada}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] });
ok('disattivata', off.data?.active === false);
const members = (await owner('GET', '/api/organization')).data?.members ?? [];
ok('Impostazioni → Membri la segna come disattivata', Boolean(members.find((m) => m.username === 'scim.ada@acme.test')?.disabledAt));
ok('riattivata', (await scim('PATCH', `/Users/${ada}`, { Operations: [{ op: 'replace', value: { active: true } }] })).data?.active === true);
ok('gruppo rimosso', (await scim('DELETE', `/Groups/${group.data?.id}`)).status === 204);
ok('utente rimosso', (await scim('DELETE', `/Users/${ada}`)).status === 204);

console.log(failures === 0 ? '\nTutto come atteso.' : `\n${failures} verifiche non riuscite.`);
process.exit(failures === 0 ? 0 : 1);
