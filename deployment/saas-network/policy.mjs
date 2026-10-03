import { isIP } from 'node:net';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Shared by the Squid ACL and the namespace packet filter. Deny non-public,
// documentation and transition space, including IPv4-mapped IPv6 addresses.
export const RESERVED_IPV4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];
export const RESERVED_IPV6 = ['::/3', '4000::/2', '8000::/1', '2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'];
// Squid normalizes every IPv4 destination into ::ffff:0:0/96 internally.
// Broad ::/3 in a dst ACL would therefore deny the entire public IPv4 internet.
// The kernel guard enforces the broad deny; Squid uses non-overlapping ranges.
const SQUID_RESERVED_IPV6 = ['::/96', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64', '2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8'];

export function parseAllowlist(raw = '[]') {
  let entries;
  try { entries = JSON.parse(raw); } catch { throw new Error('Invalid egress policy JSON'); }
  if (!Array.isArray(entries) || entries.length > 500) throw new Error('Invalid egress policy list');
  const seen = new Set();
  return entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['host', 'ports'].includes(key))) throw new Error('Invalid egress policy entry');
    const { host, ports } = entry;
    // ASCII/punycode exact FQDN only. Reject URL-parser numeric aliases and local suffixes.
    if (typeof host !== 'string' || host.length > 253 || host !== host.toLowerCase() || isIP(host) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) || /(?:^|\.)(?:localhost|localdomain|local|internal|home|lan|invalid|test)$/.test(host)) throw new Error('Invalid egress policy hostname');
    if (!Array.isArray(ports) || !ports.length || ports.length > 100 || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid egress policy ports');
    if (seen.has(host)) throw new Error('Invalid egress policy duplicate hostname');
    seen.add(host);
    return { host, ports: [...new Set(ports)].sort((a, b) => a - b) };
  });
}

export function validateSecrets(env) {
  const keys = ['POSTGRES_ADMIN_PASSWORD', 'WFM_DATABASE_PASSWORD', 'REDIS_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'AGENT_RELAY_SECRET'];
  const values = keys.map(key => {
    const value = env[key];
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || new Set(value).size < 10) throw new Error(`${key} must be an independently generated random 32-byte lowercase hex secret`);
    return value;
  });
  if (new Set(values).size !== values.length) throw new Error('Production secrets must be independently generated and distinct');
}

export function squidConfig(entries) {
  const rules = entries.flatMap(({ host, ports }, i) => [
    `acl destination_${i} dstdomain -n ${host}`,
    `acl ports_${i} port ${ports.join(' ')}`,
    `http_access allow destination_${i} ports_${i}`,
  ]);
  return [
    'http_port 3128',
    'visible_hostname wfm-egress',
    'cache_effective_user proxy',
    'pid_filename /tmp/squid.pid',
    'coredump_dir /tmp',
    'cache deny all',
    'pinger_enable off',
    'cache_store_log none',
    // Status and method only; no URL, path, query, auth identity or headers.
    'logformat policy %ts.%03tu %>a %rm %Ss/%>Hs',
    'access_log stdio:/dev/stdout policy',
    // Squid diagnostic logs can include complete URLs; do not emit them.
    'cache_log /dev/null',
    'debug_options ALL,0',
    'forwarded_for delete',
    'via off',
    'connect_timeout 10 seconds',
    'request_timeout 30 seconds',
    'shutdown_lifetime 1 seconds',
    // Separate families: Squid treats IPv4-mapped CIDRs as overlapping ::/3
    // and otherwise ignores the broad IPv6 block in its ACL splay tree.
    `acl reserved4 dst ${RESERVED_IPV4.join(' ')}`,
    `acl reserved6 dst ${SQUID_RESERVED_IPV6.join(' ')}`,
    'http_access deny reserved4',
    'http_access deny reserved6',
    ...rules,
    'http_access deny all',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const entries = parseAllowlist(process.env.WFM_SAAS_ALLOWLIST || '[]');
    if (process.argv[2] === '--validate-production') {
      validateSecrets(process.env);
      if (!/^https:\/\/[^\s]+$/.test(process.env.WEBFLOW_PUBLIC_URL || '')) throw new Error('WEBFLOW_PUBLIC_URL must be a public HTTPS URL');
      console.log('Production secret and policy validation passed');
    } else {
      writeFileSync(process.argv[2] || '/tmp/squid.conf', squidConfig(entries), { mode: 0o600 });
      writeFileSync('/tmp/reserved-ipv4', RESERVED_IPV4.join('\n'));
      writeFileSync('/tmp/reserved-ipv6', RESERVED_IPV6.join('\n'));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
