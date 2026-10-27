import { isIP } from 'node:net';

export type TrustProxySetting = number | boolean | string[];

const NAMED = new Set(['loopback', 'linklocal', 'uniquelocal']);

function validEntry(entry: string): boolean {
  if (NAMED.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (rest.length > 0 || family === 0) return false;
  if (prefix === undefined) return true;
  const max = family === 4 ? 32 : 128;
  return /^\d+$/.test(prefix) && Number(prefix) <= max;
}

/**
 * Parses TRUST_PROXY into Express's `trust proxy` setting: a hop count, `true`/`false`, or a
 * comma-separated list of IPs, CIDRs and `loopback`/`linklocal`/`uniquelocal`. Unset keeps the
 * historical `1` (one reverse proxy in front). A malformed value throws at startup: guessing
 * wrong either lets clients forge X-Forwarded-For or collapses every client onto the proxy IP.
 */
export function trustProxySetting(env: NodeJS.ProcessEnv = process.env): TrustProxySetting {
  const raw = env.TRUST_PROXY?.trim();
  if (!raw) return 1;
  const lower = raw.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  const entries = raw.split(',').map((entry) => entry.trim().toLowerCase());
  if (entries.every((entry) => entry && validEntry(entry))) return entries;
  throw new Error(
    `TRUST_PROXY must be a hop count, "true", "false", or a comma-separated list of IPs, CIDRs or loopback/linklocal/uniquelocal; got "${raw}".`,
  );
}
