import { afterAll, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { AgentRelay } from './relay';
import { runBddOnAgent } from './agent-bdd';
import { signTicket } from './agent-credentials';
const secret = 'bdd-relay-secret';
const profile = {id:'shop',label:'Shop',provider:'cucumber-js' as const,revision:'rev-1',maxDurationMs:60000};
const ticketInput = {organizationId:1,pool:'bdd',engine:'chromium' as const,headless:true,playwrightVersion:'1.0.0',bddProfile:{id:profile.id,revision:profile.revision}};
let relay: AgentRelay;
let server: http.Server;
let control: WebSocket;
afterAll(async () => { control?.terminate(); await relay?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });
it('dispatches only the signed profile revision to a browserless BDD host and rejects older hosts', async () => {
  server = http.createServer((req,res) => res.end(JSON.stringify(relay.availability(new URL(req.url!,'http://x').searchParams.get('ticket')!))));
  relay = new AgentRelay({authenticate:async () => ({id:'host',organizationId:1,pool:'bdd',name:'Host'}),secret:() => secret});
  relay.attach(server);
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  control = new WebSocket(base.replace('http','ws')+'/api/agent/v1/connect',{headers:{Authorization:'Bearer host'}});
  await new Promise<void>(resolve => control.once('open',resolve));
  control.send(JSON.stringify({type:'hello',protocol:1,agentVersion:'1.3.0',playwrightVersion:'different',hostname:'Host',browsers:[],maxSessions:1,bddProfiles:[profile]}));
  await new Promise<void>(resolve => control.once('message',() => resolve()));
  expect(relay.availability(signTicket(ticketInput,secret))).toMatchObject({available:true});
  expect(relay.availability(signTicket({...ticketInput,bddProfile:{id:'missing',revision:'rev-1'}},secret))).toMatchObject({available:false,reason:expect.stringContaining('BDD')});
  control.on('message',raw => {
    const message = JSON.parse(raw.toString());
    if (message.type !== 'open') return;
    expect(message.bddProfile).toEqual(ticketInput.bddProfile);
    const session = new WebSocket(base.replace('http','ws')+'/api/agent/v1/session/'+message.sessionId,{headers:{Authorization:'Bearer host'}});
    session.once('message',() => {session.send(JSON.stringify({result:{status:'passed',durationMs:1,steps:[{name:'a',kind:'step',status:'PASSED',durationMs:1}]}}));});
  });
  const result = await runBddOnAgent({organizationId:1,pool:'bdd'},{source:'Feature: F\nScenario: S\nGiven a',uri:'test.feature',scenarioLine:2,profile:{id:'shop',revision:'rev-1'},variables:{},timeoutMs:60000},{AGENT_RELAY_URL:base,AGENT_RELAY_SECRET:secret});
  expect(result.status).toBe('passed');
});

it.each(['capacity', 'capacity-timeout', 'profile', 'execution'] as const)('retries only a capacity refusal before BDD execution (%s)', async mode => {
  let attempts = 0;
  let executions = 0;
  const host = http.createServer((req, res) => res.end(JSON.stringify(localRelay.availability(new URL(req.url!, 'http://x').searchParams.get('ticket')!))));
  const localRelay = new AgentRelay({ authenticate: async () => ({ id: 'handoff', organizationId: 1, pool: 'bdd', name: 'Host' }), secret: () => secret });
  localRelay.attach(host);
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
  const connection = new WebSocket(base.replace('http', 'ws') + '/api/agent/v1/connect', { headers: { Authorization: 'Bearer host' } });
  const lent: WebSocket[] = [];
  try {
    await new Promise<void>(resolve => connection.once('open', resolve));
    connection.send(JSON.stringify({ type: 'hello', protocol: 1, agentVersion: '1.3.0', playwrightVersion: 'different', hostname: 'Host', browsers: [], maxSessions: 1, bddProfiles: [profile] }));
    await new Promise<void>(resolve => connection.once('message', () => resolve()));
    connection.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'open') return;
      attempts++;
      if ((attempts === 1 && mode !== 'execution') || mode === 'capacity-timeout') {
        connection.send(JSON.stringify({ type: 'open_failed', sessionId: message.sessionId, error: mode.startsWith('capacity') ? 'The agent is at capacity.' : 'The BDD profile is unavailable.' }));
        return;
      }
      const session = new WebSocket(base.replace('http', 'ws') + '/api/agent/v1/session/' + message.sessionId, { headers: { Authorization: 'Bearer host' } });
      lent.push(session);
      session.once('message', () => {
        executions++;
        session.send(JSON.stringify({ result: { status: mode === 'execution' ? 'failed' : 'passed', durationMs: 1, steps: [{ name: 'a', kind: 'step', status: mode === 'execution' ? 'FAILED' : 'PASSED', durationMs: 1 }] } }));
      });
    });
    const execution = runBddOnAgent({ organizationId: 1, pool: 'bdd' }, { source: 'Feature: F\nScenario: S\nGiven a', uri: 'test.feature', scenarioLine: 2, profile: { id: 'shop', revision: 'rev-1' }, variables: {}, timeoutMs: 60000 }, { AGENT_RELAY_URL: base, AGENT_RELAY_SECRET: secret });
    if (mode === 'capacity') {
      expect((await execution).status).toBe('passed');
      expect(attempts).toBe(2);
      expect(executions).toBe(1);
    } else if (mode === 'capacity-timeout') {
      await expect(execution).rejects.toThrow('The agent is at capacity.');
      expect(attempts).toBeGreaterThan(1);
      expect(executions).toBe(0);
    } else if (mode === 'profile') {
      await expect(execution).rejects.toThrow('The BDD profile is unavailable.');
      expect(attempts).toBe(1);
      expect(executions).toBe(0);
    } else {
      expect((await execution).status).toBe('failed');
      expect(attempts).toBe(1);
      expect(executions).toBe(1);
    }
  } finally {
    lent.forEach(socket => socket.terminate());
    connection.terminate();
    await localRelay.close();
    await new Promise<void>(resolve => host.close(() => resolve()));
  }
}, 10000);
