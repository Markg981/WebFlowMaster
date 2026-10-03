import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Separate project, no existing container/volume removal. A subnet conflict
// fails rather than reusing another project's network.
const project = `saas-network-check-${randomBytes(4).toString('hex')}`;
const cwd = fileURLToPath(new URL('.', import.meta.url));
const allowed = JSON.stringify(['public', 'private', 'loopback', 'metadata', 'transition'].map(prefix => ({ host: `${prefix}.wfm.example`, ports: [80, 443, 8080, 8081, 50051] })));
let env = { ...process.env, WFM_SAAS_ALLOWLIST: allowed, COMPOSE_PROGRESS: 'plain' };
function docker(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout: 600_000 });
  if (!allowFailure && result.status !== 0) throw new Error(`Docker command failed (${args.slice(0, 3).join(' ')}); status ${result.status}`);
  return capture ? result.stdout : result.status;
}
function compose(args, options) { return docker(['compose', '-p', project, '-f', 'check.compose.yml', ...args], options); }

function validateProductionCompose() {
  const secretKeys = ['POSTGRES_ADMIN_PASSWORD', 'WFM_DATABASE_PASSWORD', 'REDIS_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'AGENT_RELAY_SECRET'];
  const configEnv = { ...env, WEBFLOW_PUBLIC_URL: 'https://wfm.example', ...Object.fromEntries(secretKeys.map(key => [key, randomBytes(32).toString('hex')])) };
  const args = ['compose', '-p', `${project}-config`, '-f', 'compose.yml', 'config', '--format', 'json'];
  const valid = spawnSync('docker', args, { cwd, env: configEnv, encoding: 'utf8' });
  assert.equal(valid.status, 0, 'Production Compose must render with valid mandatory inputs');
  const config = JSON.parse(valid.stdout);
  for (const service of ['api', 'worker', 'egress']) {
    assert.deepEqual(config.services[service].cap_drop, ['ALL']);
    assert.match(config.services[service].network_mode, /^service:.*-guard$/);
    assert.equal(config.services[service].networks, undefined);
  }
  assert.equal(config.services.postgres.ports, undefined);
  assert.equal(config.services.redis.ports, undefined);
  for (const key of secretKeys) {
    // No values are printed or stored; this only validates mandatory interpolation.
    const missing = spawnSync('docker', args, { cwd, env: { ...configEnv, [key]: '' }, encoding: 'utf8' });
    assert.notEqual(missing.status, 0, `Missing ${key} must fail Compose validation`);
  }
  console.log('PASS production Compose and mandatory secret validation');
}

try {
  docker(['info'], { capture: true });
  validateProductionCompose();
  compose(['up', '-d', '--build', '--wait', '--wait-timeout', '90']);
  compose(['exec', '-T', 'worker', 'node', '-e', "let n=0;const t=setInterval(()=>{const s=require('net').connect(3128,'egress');s.on('connect',()=>{s.destroy();clearInterval(t);process.exit(0)});s.on('error',()=>{s.destroy();if(++n>50)process.exit(1)})},200)"]);
  // Establish fixture readiness independently of application capabilities.
  for (const service of ['public', 'postgres', 'redis', 'api']) {
    compose(['exec', '-T', service, 'node', '-e', "const p={public:80,postgres:5432,redis:6379,api:5000}[process.argv[1]]; let n=0; const t=setInterval(()=>{const s=require('net').connect(p,'127.0.0.1');s.on('connect',()=>{s.destroy();clearInterval(t);process.exit(0)});s.on('error',()=>{s.destroy();if(++n>30)process.exit(1)})},200)", service]);
  }
  const published = compose(['port', 'api-guard', '5000'], { capture: true }).trim();
  assert.match(published, /^127\.0\.0\.1:\d+$/);
  const ingress = await fetch(`http://${published}/`);
  assert.equal(ingress.status, 200);
  assert.equal(await ingress.text(), 'isolated-fixture');
  console.log('PASS actual loopback-published API ingress with OUTPUT DROP');
  for (const role of ['api', 'worker']) compose(['exec', '-T', role, 'node', '/check/boundary-check.mjs', 'allowed', role]);
  const proxyLogs = compose(['logs', 'egress'], { capture: true });
  assert.doesNotMatch(proxyLogs, /wfm-sensitive-query-probe|http:\/\/public\.wfm\.example|token=/);
  console.log('PASS proxy logs omit complete URLs and query secrets');
  if (env.WFM_SAAS_TRANSPORT_BUNDLE) {
    if (!env.WFM_SAAS_NODE_MODULES) throw new Error('WFM_SAAS_NODE_MODULES is required with the transport bundle');
    compose(['--profile', 'transports', 'up', '-d', 'transport-fixture']);
    compose(['--profile', 'transports', 'run', '--rm', '--no-deps', 'transport']);
  }
  // Confirm the actual firewall policy rather than relying on timeouts alone.
  for (const guard of ['api-guard', 'worker-guard', 'egress-guard']) {
    const ipv4 = compose(['exec', '-T', guard, 'iptables', '-S', 'OUTPUT'], { capture: true });
    const ipv6 = compose(['exec', '-T', guard, 'ip6tables', '-S', 'OUTPUT'], { capture: true });
    assert.match(ipv4, /-P OUTPUT DROP/);
    assert.match(ipv6, /-P OUTPUT DROP/);
  }
  env = { ...env, WFM_SAAS_ALLOWLIST: '[]' };
  compose(['up', '-d', '--force-recreate', '--no-deps', 'egress']);
  // Squid config is generated at process start. Wait for port readiness.
  compose(['exec', '-T', 'worker', 'node', '-e', "let n=0;const t=setInterval(()=>{const s=require('net').connect(3128,'egress');s.on('connect',()=>{s.destroy();clearInterval(t);process.exit(0)});s.on('error',()=>{s.destroy();if(++n>50)process.exit(1)})},200)"]);
  for (const role of ['api', 'worker']) compose(['exec', '-T', role, 'node', '/check/boundary-check.mjs', 'empty', role]);
  console.log('Isolated default-deny network acceptance passed');
} catch (error) {
  compose(['logs', '--tail', '30', 'egress'], { allowFailure: true });
  throw error;
} finally {
  compose(['down', '--volumes', '--remove-orphans', '--rmi', 'local'], { allowFailure: true });
}
