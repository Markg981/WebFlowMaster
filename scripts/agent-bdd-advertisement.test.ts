import {expect,it} from 'vitest';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {WebSocketServer} from 'ws';
import {runAgent} from './wfm-agent';
it('advertises only public BDD capability and refuses an unknown profile before opening a session',async () => {
  const server=http.createServer();
  const sockets=new WebSocketServer({server});
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  let welcome:(value:unknown) => void=() => {};
  let refused:(value:unknown) => void=() => {};
  const hello=new Promise<any>(resolve => {welcome=resolve;});
  const failure=new Promise<any>(resolve => {refused=resolve;});
  sockets.on('connection',socket => socket.on('message',raw => {
    const message=JSON.parse(raw.toString());
    if (message.type === 'hello') {
      welcome(message);
      socket.send(JSON.stringify({type:'welcome',agentId:'bdd',name:'BDD',pool:'bdd'}));
      socket.send(JSON.stringify({type:'open',sessionId:'unknown',bddProfile:{id:'unknown',revision:'rev-1'},engine:'chromium'}));
    } else if (message.type === 'open_failed') refused(message);
  }));
  const profile={id:'shop',label:'Shop',provider:'cucumber-js',revision:'rev-1',maxDurationMs:60000,projectDirectory:process.cwd(),requirePaths:[],importPaths:[],environment:[],maxConcurrency:1};
  const agent=runAgent({url:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,token:'fixture',maxSessions:1,browsers:[],bddProfiles:[profile],log:() => {}} as any);
  try {
    expect((await hello).bddProfiles).toEqual([{id:'shop',label:'Shop',provider:'cucumber-js',revision:'rev-1',maxDurationMs:60000}]);
    expect(await failure).toMatchObject({type:'open_failed',sessionId:'unknown',error:expect.stringContaining('BDD')});
    expect(agent.activeSessions()).toBe(0);
  } finally {
    await agent.stop();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
