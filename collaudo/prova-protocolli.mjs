// Provision a dedicated single-slot pool without replacing the mobile agent or resetting data.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const docker = process.env.DOCKER_BIN || 'docker';
const compose = ['compose', '-p', 'wfm-collaudo', '--env-file', 'collaudo/collaudo.env', '-f', 'docker-compose.yml', '-f', 'collaudo/docker-compose.collaudo.yml'];
const base = process.env.WFM_URL || 'https://wfm.collaudo.test';
const saved = join(root, 'collaudo/.sessions/agent-interno.json');
const cookie = JSON.parse(readFileSync(join(root, 'collaudo/.sessions/owner.a.json'), 'utf8')).cookie;
async function api(method, path, body) {
  const reply = await fetch(base + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!reply.ok) throw new Error(`${method} ${path}: HTTP ${reply.status}`);
  return reply.json();
}
const { agents } = await api('GET', '/api/agents');
let credentials;
if (existsSync(saved)) {
  credentials = JSON.parse(readFileSync(saved, 'utf8'));
  if (!agents.some(agent => agent.id === credentials.id && !agent.revokedAt && agent.pool === 'interno')) throw new Error('Saved private-pool agent was revoked or changed; remove its local credentials file to enroll a replacement.');
} else {
  const issued = await api('POST', '/api/agents', { name: 'agente-protocolli', pool: 'interno' });
  credentials = { id: issued.agent.id, token: issued.token };
  mkdirSync(join(root, 'collaudo/.sessions'), { recursive: true });
  writeFileSync(saved, JSON.stringify(credentials), { mode: 0o600 });
}
const { organization } = await api('GET', '/api/organization');
const env = { ...process.env, WFM_AGENT_TOKEN_INTERNO: credentials.token };
const run = args => execFileSync(docker, args, { cwd: root, env, stdio: 'inherit' });
run([...compose, '--profile', 'protocolli', 'up', '-d', '--build', '--wait', '--wait-timeout', '180', 'agente-interno', 'protocolli']);
let online = false;
for (let i = 0; i < 30; i++) {
  const current = (await api('GET', '/api/agents')).agents.find(agent => agent.id === credentials.id);
  if (current?.connected) { online = true; break; }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!online) throw new Error('The private-pool agent did not connect within 30 seconds.');
const worker = execFileSync(docker, [...compose, 'ps', '-q', 'worker'], { cwd: root, encoding: 'utf8' }).trim();
if (!worker) throw new Error('Start the collaudo worker first.');
const temp = mkdtempSync(join(tmpdir(), 'wfm-protocol-check-'));
const remote = `/app/wfm-protocol-check-${randomUUID()}`;
try {
  await build({ entryPoints: [join(root, 'collaudo/protocolli/check.ts')], outfile: join(temp, 'check.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', tsconfig: join(root, 'tsconfig.json') });
  run(['cp', join(temp, 'check.mjs'), `${worker}:${remote}.mjs`]);
  run(['cp', join(root, 'collaudo/protocolli/echo.proto'), `${worker}:${remote}.proto`]);
  run(['exec', worker, 'node', `${remote}.mjs`, String(organization.id), 'interno', `${remote}.proto`]);
} finally {
  // Only the two paths copied above; never remove application data or Docker volumes.
  try { run(['exec', worker, 'rm', '-f', `${remote}.mjs`, `${remote}.proto`]); }
  finally { rmSync(temp, { recursive: true, force: true }); }
}
