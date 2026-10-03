// Real plan/report acceptance. Keeps its named tests, plans and runs available for UI inspection.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const base = process.env.WFM_URL || 'https://wfm.collaudo.test';
const sessions = join(import.meta.dirname, '.sessions');
const cookie = JSON.parse(readFileSync(join(sessions, 'editor.a.json'), 'utf8')).cookie;
const proto = readFileSync(join(import.meta.dirname, 'protocolli/echo.proto'), 'utf8');
const stamp = new Date().toISOString();
const scope = process.env.WFM_PROTOCOL_SCOPE || 'all';
assert(['all', 'server', 'legacy'].includes(scope), 'WFM_PROTOCOL_SCOPE must be all, server or legacy');
if (scope === 'legacy') assert(process.env.WFM_LEGACY_POOL, 'WFM_LEGACY_POOL required for legacy scope');
const evidenceFile = join(sessions, `protocol-plan-${scope}-evidence.json`);
async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  assert(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const assertion = (source, property, targetValue) => ({ id: randomUUID(), source, property, comparison: 'equals', targetValue, enabled: true });
const grpc = { method: 'GRPC', url: 'grpc://protocolli:50051/collaudo.Echo/Say', protoDefinition: proto, requestBody: '{"text":"hello agent"}', assertions: [assertion('status_code', '', '0'), assertion('body_json_path', 'text', 'hello agent'), assertion('header', 'x-collaudo', 'private')] };
const ws = { method: 'WEBSOCKET', url: 'ws://protocolli:8080/echo', requestHeaders: { Authorization: 'Bearer private-fixture-token' }, requestBody: '{"send":["hello agent"],"until":1}', assertions: [assertion('status_code', '', '101'), assertion('body_json_path', 'last', 'hello agent')], extractions: [{ id: randomUUID(), name: 'echo', source: 'body_json_path', property: 'last' }] };
const oauth = { ...ws, requestHeaders: {}, requestBody: '{"send":["{{echo}}"],"until":1}', authParams: { type: 'oauth2', params: { grantType: 'client_credentials', tokenUrl: 'http://protocolli:8080/token', clientId: 'collaudo', clientSecret: 'fixture-secret', scope: '', username: '', password: '', clientAuth: 'header' } } };
const deadline = { ...grpc, url: 'grpc://protocolli:50051/collaudo.Echo/Wait', assertions: [assertion('status_code', '', '4')] };
const evidence = { at: stamp, runs: [] };
for (const pool of [scope === 'all' ? 'interno' : null, scope !== 'server' ? process.env.WFM_LEGACY_POOL : null].filter(Boolean)) {
  let connected = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const { agents } = await api('GET', '/api/agents');
    if (agents.some(agent => agent.pool === pool && agent.connected && !agent.revokedAt)) { connected = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(connected, `Connect an agent in pool ${pool} before running acceptance.`);
}
async function plan(label, pool, specs, expected) {
  const tests = [];
  for (const [index, spec] of specs.entries()) {
    const test = await api('POST', '/api/api-tests', { name: `AGT acceptance ${label} ${index + 1} · ${stamp}`, ...spec });
    await api('POST', `/api/api-tests/${test.id}/publish`, {});
    tests.push({ id: test.id, type: 'api' });
  }
  const created = await api('POST', '/api/test-plans', { name: `AGT acceptance ${label} · ${stamp}`, agentPool: pool, selectedTests: tests, testMachinesConfig: [{ browserName: 'chromium', headless: true }], maxParallelTests: 1 });
  const started = await api('POST', `/api/run-test-plan/${created.id}`, {});
  let run;
  for (let i = 0; i < 120; i++) {
    run = await api('GET', `/api/test-plan-executions/${started.data.id}`);
    if (!['queued', 'running', 'pending'].includes(run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  evidence.runs.push({ label, planId: created.id, executionId: run.id, status: run.status, results: run.results, report: `${base}/test-plans/${created.id}/executions/${run.id}/report` });
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
  assert.equal(run.status, expected === 'passed' ? 'completed' : 'failed', JSON.stringify(run));
  assert.equal(run.results.length, specs.length);
  if (expected === 'passed') {
    assert(run.results.every(result => result.success && result.status === 'passed'), JSON.stringify(run.results));
    if (specs.some(spec => spec.extractions?.length)) assert(run.results.some(result => result.extracted?.echo === 'hello agent'));
  } else {
    assert(run.results.every(result => !result.success), JSON.stringify(run.results));
    if (pool === null) {
      // gRPC reports network failure as status 14, so the plan records its failed status assertion.
      // WebSocket retains the DNS failure text. Require both, rather than any failed verdict.
      for (const [index, result] of run.results.entries()) {
        assert.match(result.error || '', specs[index].method === 'GRPC'
          ? /status_code.*actual: 14/
          : /ENOTFOUND|EAI_AGAIN|Name resolution|DNS|name.*resol/i);
      }
    }
  }
  for (const format of ['junit', 'export/html']) {
    const url = `${base}/api/test-plan-executions/${run.id}/${format}`;
    const response = await fetch(url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
    assert(response.ok, `Report export ${format}: HTTP ${response.status}`);
    assert.match(await response.text(), /AGT acceptance/);
  }
  console.log(`PASS ${label}: ${run.status} · ${run.id}`);
  return run;
}
if (scope === 'all') await plan('private grpc websocket oauth deadline recovery', 'interno', [grpc, ws, oauth, deadline, ws], 'passed');
if (scope !== 'legacy') await plan('server cannot reach private endpoints', null, [grpc, ws], 'failed');
if (scope !== 'server' && process.env.WFM_LEGACY_POOL) {
  await plan('legacy HTTP', process.env.WFM_LEGACY_POOL, [{ method: 'GET', url: 'http://intranet.acme.local', assertions: [assertion('status_code', '', '200')] }], 'passed');
  const legacy = await plan('legacy native refusal', process.env.WFM_LEGACY_POOL, [ws], 'failed');
  assert.match(JSON.stringify(legacy.results), /update|upgrade/i);
}
console.log(`Evidence and report links: ${evidenceFile}`);
