import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AgentHttp } from '../../server/agents/agent-fetch';
import { runProtocolOnAgent } from '../../server/agents/agent-protocol';
import { runApiRequest } from '../../server/api-test-runner';
import type { Assertion } from '../../shared/schema';

const agent = { organizationId: Number(process.argv[2]), pool: process.argv[3] };
assert(Number.isSafeInteger(agent.organizationId) && agent.organizationId > 0 && agent.pool, 'organization and pool required');
const proto = readFileSync(process.argv[4], 'utf8');
const assertion = (source: Assertion['source'], property: string, targetValue: string): Assertion => ({
  id: '00000000-0000-4000-8000-000000000000', source, property, targetValue, comparison: 'equals', enabled: true,
});
const transport = new AgentHttp(agent);
try {
  // The worker has no attachment to privata: guard against accidentally testing server routing.
  await assert.rejects(fetch('http://protocolli:8080/health', { signal: AbortSignal.timeout(3000) }));
  console.log('PASS private network inaccessible from worker');
  const grpc = await runApiRequest({
    method: 'GRPC', url: 'grpc://protocolli:50051/collaudo.Echo/Say', protoDefinition: proto,
    body: { text: 'hello {{name}}' },
    assertions: [assertion('status_code', '', '0'), assertion('body_json_path', 'text', 'hello agent'), assertion('header', 'x-collaudo', 'private')],
  }, { name: 'agent' }, transport.fetch);
  assert(grpc.passed, JSON.stringify(grpc));
  console.log('PASS AGT-06 gRPC, substitution, body and metadata assertions');
  const spec = {
    method: 'WEBSOCKET', url: 'ws://protocolli:8080/echo', body: { send: ['hello {{name}}'], until: 1 },
    headers: { Authorization: 'Bearer private-fixture-token' },
    assertions: [assertion('status_code', '', '101'), assertion('body_json_path', 'last', 'hello agent'), assertion('body_json_path', 'count', '1')],
    extractions: [{ id: 'last', name: 'echo', source: 'body_json_path' as const, property: 'last' }],
  };
  const ws = await runApiRequest(spec, { name: 'agent' }, transport.fetch);
  assert(ws.passed, JSON.stringify(ws));
  assert.equal(ws.extracted.echo, 'hello agent');
  assert.equal(ws.extractionErrors.length, 0);
  console.log('PASS AGT-07 WebSocket, bearer, assertions and extraction');
  const oauth = await runApiRequest({ ...spec, headers: {}, auth: {
    type: 'oauth2', params: {
      grantType: 'client_credentials', tokenUrl: 'http://protocolli:8080/token', clientId: 'collaudo', clientSecret: 'fixture-secret',
      scope: '', username: '', password: '', clientAuth: 'header',
    },
  } }, { name: 'agent' }, transport.fetch);
  assert(oauth.passed, JSON.stringify(oauth));
  console.log('PASS AGT-09 private OAuth and WebSocket through one agent slot');
  await assert.rejects(runProtocolOnAgent(agent, {
    protocol: 'grpc', url: 'grpc://protocolli:50051/collaudo.Echo/Wait', proto, body: '{}', headers: {}, timeoutMs: 500,
  }), /deadline|timeout/i);
  const after = await runApiRequest(spec, { name: 'agent' }, transport.fetch);
  assert(after.passed, JSON.stringify(after));
  console.log('PASS AGT-10 local gRPC deadline fails execution and releases slot for subsequent WebSocket');
} finally {
  await transport.close();
}
