import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseAllowlist, squidConfig, validateSecrets } from './policy.mjs';

test('empty policy denies every destination', () => {
  const config = squidConfig(parseAllowlist('[]'));
  assert.match(config, /http_access deny all/);
  assert.doesNotMatch(config, /http_access allow/);
});

test('rules bind each exact hostname to its own ports without reverse DNS', () => {
  const config = squidConfig(parseAllowlist('[{"host":"example.com","ports":[80,443]},{"host":"other.example.com","ports":[8443]}]'));
  assert.match(config, /acl destination_0 dstdomain -n example.com/);
  assert.match(config, /acl ports_0 port 80 443/);
  assert.match(config, /http_access allow destination_0 ports_0/);
  assert.match(config, /http_access deny reserved/);
  assert.ok(config.indexOf('http_access deny reserved') < config.indexOf('http_access allow'));
  assert.doesNotMatch(config, /%ru|%rp|%rq|%un/);
});

test('reject malformed, wildcard, literal, numeric, local and injectable policies', () => {
  for (const host of ['*.example.com', '.example.com', 'localhost', 'localhost.localdomain', 'host.local', '169.254.169.254', '127.1', '2130706433', '0x7f000001', '[::1]', 'example.com/secret', 'example.com\nhttp_access allow all', 'example.com.', '-bad.example.com']) {
    assert.throws(() => parseAllowlist(JSON.stringify([{ host, ports: [443] }])), { message: /policy/i });
  }
  for (const ports of [[], [0], [65536], ['443'], [443.2]]) {
    assert.throws(() => parseAllowlist(JSON.stringify([{ host: 'example.com', ports }])));
  }
  for (const raw of ['{}', 'invalid', '[{"host":"example.com","ports":[443],"wildcard":true}]']) assert.throws(() => parseAllowlist(raw));
});

test('secret inputs must be distinct strong hex values with no defaults', () => {
  const env = Object.fromEntries(['POSTGRES_ADMIN_PASSWORD', 'WFM_DATABASE_PASSWORD', 'REDIS_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'AGENT_RELAY_SECRET'].map(key => [key, randomBytes(32).toString('hex')]));
  assert.doesNotThrow(() => validateSecrets(env));
  assert.throws(() => validateSecrets({ ...env, SESSION_SECRET: undefined }));
  assert.throws(() => validateSecrets({ ...env, ENCRYPTION_KEY: '0'.repeat(64) }));
  assert.throws(() => validateSecrets({ ...env, SESSION_SECRET: env.AGENT_RELAY_SECRET }));
});

test('only guards have NET_ADMIN and only egress guard has an uplink', () => {
  const compose = parse(readFileSync(new URL('./compose.yml', import.meta.url), 'utf8'), { merge: true });
  for (const [name, service] of Object.entries(compose.services)) {
    if (name.endsWith('-guard')) {
      assert.deepEqual(service.cap_add, ['NET_ADMIN']);
      assert.deepEqual(service.cap_drop, ['ALL']);
    } else assert.equal(service.cap_add, undefined);
    if (service.networks?.uplink !== undefined) assert.equal(name, 'egress-guard');
    if (service.networks?.ingress !== undefined) assert.equal(name, 'api-guard');
    if (['api', 'worker', 'migrate', 'egress'].includes(name)) {
      assert.deepEqual(service.cap_drop, ['ALL']);
      assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
      assert.equal(service.networks, undefined);
      assert.match(service.network_mode, /^service:.*-guard$/);
    }
    if (name !== 'api-guard') assert.equal(service.ports, undefined);
  }
  assert.equal(compose.networks.backend.internal, true);
  assert.equal(compose.networks.proxy.internal, true);
  assert.equal(compose.networks.ingress.internal, false);
  assert.ok(compose.services['api-guard'].networks.ingress);
  assert.equal(compose.services.validate.network_mode, 'none');
});

test('proxy ACL and egress guard both deny all reserved address ranges', () => {
  const guard = readFileSync(new URL('./guard.sh', import.meta.url), 'utf8');
  const config = squidConfig([]);
  for (const cidr of ['0.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4', '2001::/23', '2002::/16']) {
    assert.ok(config.includes(cidr));
    assert.ok(guard.includes(cidr));
  }
  for (const cidr of ['::/3', '4000::/2', '8000::/1']) assert.ok(guard.includes(cidr));
  // IPv4 normalization must not make the public IPv4 internet match reserved6.
  assert.doesNotMatch(config, /acl reserved6 dst ::\/3/);
});

test('non-superuser runtime can inspect the migration journal without changing it', () => {
  const sql = readFileSync(new URL('./grant-runtime.sql', import.meta.url), 'utf8');
  assert.match(sql, /GRANT USAGE ON SCHEMA drizzle TO wfm_runtime/);
  assert.match(sql, /GRANT SELECT ON TABLE drizzle\.__drizzle_migrations TO wfm_runtime/);
  assert.doesNotMatch(sql, /GRANT (?:ALL|INSERT|UPDATE|DELETE).*drizzle/);
});

test('compose has standalone guarded namespaces, private stores and mandatory secrets', () => {
  const compose = readFileSync(new URL('./compose.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(compose, /extends:|external:|privileged:\s*true/);
  assert.match(compose, /network_mode: service:api-guard/);
  assert.match(compose, /network_mode: service:worker-guard/);
  assert.match(compose, /127\.0\.0\.1:\$\{WFM_SAAS_PORT:-5090\}:5000/);
  for (const key of ['POSTGRES_ADMIN_PASSWORD', 'WFM_DATABASE_PASSWORD', 'REDIS_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'AGENT_RELAY_SECRET']) assert.match(compose, new RegExp('\\$\\{' + key + ':\\?'));
  assert.match(compose, /WFM_EGRESS_PROXY: http:\/\/egress:3128/);
  const guard = readFileSync(new URL('./guard.sh', import.meta.url), 'utf8');
  assert.match(guard, /iptables -P OUTPUT DROP/);
  assert.match(guard, /ip6tables -P OUTPUT DROP/);
  assert.match(guard, /--dport 5432/);
  assert.match(guard, /--dport 6379/);
  assert.match(guard, /--dport 3128/);
  assert.match(guard, /--dport 5000/);
});
