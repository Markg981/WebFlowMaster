import dns from 'node:dns';
import net from 'node:net';
import type { BrowserContext, Response as PlaywrightResponse, Route } from 'playwright';

/**
 * Where a test may make this server connect.
 *
 * Tests exist to reach other systems, so the server opens whatever address a tenant wrote in a
 * test, a webhook, an issue tracker or a mail setting. Two things on the server's own network are
 * never a legitimate target of a test: the cloud provider's metadata service, which hands out
 * the machine's credentials to anyone who asks from the machine, and — on an installation shared
 * by several companies — the private network the server sits in. This module decides, and every
 * transport that opens a tenant-chosen address asks it: Node's fetch (server/outbound-http.ts),
 * WebSocket and gRPC (server/api-tests/api-network-protocols.ts, server/api-tests/grpc-protocol.ts), SMTP
 * (server/mailer.ts) and the browsers the runner drives (server/web/playwright-service.ts).
 *
 * Two layers. The hardened SaaS deployment (docs/en/admin/saas-network.md) forces everything
 * through a proxy whose firewall is the authority on destinations; it is not part of a
 * self-hosted installation, which until now could reach its own metadata service from any
 * test. This policy applies everywhere, including behind the proxy, where it answers before a
 * connection is attempted and with a message that names the rule rather than the proxy's 403.
 *
 * - Cloud metadata targets are denied by default, by address and by well-known name.
 * - Private, loopback, link-local and unique-local addresses follow EGRESS_PRIVATE_TARGETS:
 *   `allow` (the default, and what every installation did before this existed: self-hosted
 *   installations test intranet applications from the server) or `deny` for a shared one.
 * - EGRESS_ALLOW_HOSTS exempts hostnames and CIDRs from both, for the one internal address an
 *   installation must still reach.
 *
 * The decision is made on the address the connection is about to use, not only on the name in
 * the URL: a name that resolves to the metadata service is refused when it is resolved, which
 * is what defeats a DNS answer that changes between a check and the connection (rebinding). A
 * redirect is a new connection, so every hop is checked again. The messages name only what the
 * user supplied, never the address a name resolved to.
 */

export type EgressRule = 'metadata' | 'private';

export class EgressDeniedError extends Error {
  override readonly name = 'EgressDeniedError';
  /** What an HTTP handler answers with: the request is refused, not failed. */
  readonly status = 403;
  constructor(
    /** The host as the user wrote it: a name, or a literal address. */
    readonly target: string,
    readonly rule: EgressRule,
    /** True when the host is a name that resolved to a denied address. */
    readonly resolved = false,
  ) {
    super(describeDenial(target, rule, resolved));
  }
}

function describeDenial(target: string, rule: EgressRule, resolved: boolean): string {
  const verb = resolved ? 'resolves to' : 'is';
  const why =
    rule === 'metadata'
      ? `${target} ${verb} a cloud metadata endpoint, which tests may never reach from this server`
      : `${target} ${verb} a private network address and EGRESS_PRIVATE_TARGETS is "deny"`;
  return `Blocked by the egress policy: ${why}. An operator can exempt it with EGRESS_ALLOW_HOSTS.`;
}

export function isEgressDenied(error: unknown): error is EgressDeniedError {
  return error instanceof EgressDeniedError;
}

/** The denial behind an error, when there is one: fetch wraps a refused connection in "fetch failed". */
export function egressDenialCause(error: unknown): EgressDeniedError | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (isEgressDenied(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

// ───────────────────────────── Addresses ─────────────────────────────

interface Address {
  family: 4 | 6;
  bytes: number[];
}

interface Range {
  family: 4 | 6;
  bytes: number[];
  prefix: number;
}

function parseIPv4(text: string): number[] | undefined {
  if (!net.isIPv4(text)) return undefined;
  return text.split('.').map(Number);
}

/** The 16 bytes of an IPv6 address, or undefined when the text is not one. */
function parseIPv6(text: string): number[] | undefined {
  let address = text.trim();
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  const zone = address.indexOf('%');
  if (zone >= 0) address = address.slice(0, zone);
  if (!net.isIPv6(address)) return undefined;
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const groups = (part: string): number[] | undefined => {
    if (!part) return [];
    const out: number[] = [];
    for (const group of part.split(':')) {
      const dotted = parseIPv4(group);
      if (dotted) {
        out.push((dotted[0] << 8) | dotted[1], (dotted[2] << 8) | dotted[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  if (!head || !tail || head.length + tail.length > 8) return undefined;
  if (halves.length === 1 && head.length !== 8) return undefined;
  const words = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  const bytes: number[] = [];
  for (const word of words) bytes.push(word >> 8, word & 0xff);
  return bytes;
}

const IPV4_MAPPED_PREFIX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];
const NAT64_PREFIX = [0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * An address in a form the rules compare: an IPv6 address that carries an IPv4 one
 * (::ffff:169.254.169.254, the deprecated ::169.254.169.254, the NAT64 64:ff9b::/96 form)
 * is that IPv4 address, so a rule written for the one covers the other.
 */
export function parseAddress(text: string): Address | undefined {
  const v4 = parseIPv4(text);
  if (v4) return { family: 4, bytes: v4 };
  const v6 = parseIPv6(text);
  if (!v6) return undefined;
  const prefix = v6.slice(0, 12);
  const embedded = v6.slice(12);
  const same = (a: number[], b: number[]) => a.every((value, i) => value === b[i]);
  if (
    same(prefix, IPV4_MAPPED_PREFIX) ||
    same(prefix, NAT64_PREFIX) ||
    (prefix.every((value) => value === 0) && embedded[0] !== 0)
  )
    return { family: 4, bytes: embedded };
  return { family: 6, bytes: v6 };
}

export function parseRange(text: string): Range | undefined {
  const [addressPart, prefixPart, ...rest] = text.trim().split('/');
  if (rest.length) return undefined;
  const address = parseAddress(addressPart);
  if (!address) return undefined;
  const bits = address.family === 4 ? 32 : 128;
  const prefix = prefixPart === undefined ? bits : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits || !/^\d+$/.test(prefixPart ?? '0'))
    return undefined;
  return { family: address.family, bytes: address.bytes, prefix };
}

function inRange(address: Address, range: Range): boolean {
  if (address.family !== range.family) return false;
  let remaining = range.prefix;
  for (let i = 0; i < address.bytes.length && remaining > 0; i++) {
    const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff;
    if ((address.bytes[i] & mask) !== (range.bytes[i] & mask)) return false;
    remaining -= 8;
  }
  return true;
}

const parseRanges = (list: string[]): Range[] =>
  list.map((text) => {
    const range = parseRange(text);
    if (!range) throw new Error(`Not a network range: ${text}`);
    return range;
  });

/**
 * Always denied: the metadata services of the cloud providers, which hand out the machine's
 * credentials and configuration to whoever asks from the machine. The whole link-local block
 * is listed because every provider's service lives in it.
 */
const METADATA_RANGES = parseRanges([
  '169.254.0.0/16', // AWS, GCP, Azure, DigitalOcean, OpenStack… (169.254.169.254) and link-local
  'fd00:ec2::254/128', // AWS IMDS over IPv6
  '100.100.100.200/32', // Alibaba Cloud
  '192.0.0.192/32', // Oracle Cloud
  '168.63.129.16/32', // Azure WireServer
]);
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata']);

/** Denied under EGRESS_PRIVATE_TARGETS=deny: the server's own network. */
const PRIVATE_RANGES = parseRanges([
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '0.0.0.0/8', // "this host": reaches loopback on Linux
  '::1/128',
  '::/128',
  'fe80::/10', // link-local
  'fc00::/7', // unique local
]);

// ───────────────────────────── Policy ─────────────────────────────

export interface EgressPolicy {
  privateTargets: 'allow' | 'deny';
  /** Lowercase hostnames, `*.suffix` for a subtree. */
  allowHosts: string[];
  allowRanges: Range[];
}

/**
 * From the environment, each time: cheap, and an operator's change in a test or a reload is
 * seen at once. A value that is not one of the documented ones fails rather than meaning
 * "allow": a misspelt `deny` must not open the network.
 */
export function egressPolicy(env: NodeJS.ProcessEnv = process.env): EgressPolicy {
  const mode = (env.EGRESS_PRIVATE_TARGETS ?? 'allow').trim().toLowerCase() || 'allow';
  if (mode !== 'allow' && mode !== 'deny')
    throw new Error('EGRESS_PRIVATE_TARGETS must be "allow" or "deny".');
  const allowHosts: string[] = [];
  const allowRanges: Range[] = [];
  for (const entry of (env.EGRESS_ALLOW_HOSTS ?? '').split(',')) {
    const item = entry.trim().toLowerCase();
    if (!item) continue;
    const range = parseRange(item);
    if (range) {
      allowRanges.push(range);
      continue;
    }
    const name = item.startsWith('*.') ? item.slice(2) : item;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.?$/.test(name))
      throw new Error(`EGRESS_ALLOW_HOSTS: "${entry.trim()}" is neither a hostname nor a CIDR.`);
    allowHosts.push(item.endsWith('.') ? item.slice(0, -1) : item);
  }
  return { privateTargets: mode, allowHosts, allowRanges };
}

/** A hostname as the rules compare it: lowercase, without brackets or the trailing dot. */
export function normalizeHostname(hostname: string): string {
  let name = hostname.trim().toLowerCase();
  if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1);
  if (name.endsWith('.') && name.length > 1) name = name.slice(0, -1);
  return name;
}

function hostAllowListed(hostname: string, policy: EgressPolicy): boolean {
  const name = normalizeHostname(hostname);
  return policy.allowHosts.some((entry) =>
    entry.startsWith('*.')
      ? name.endsWith(entry.slice(1)) || name === entry.slice(2)
      : name === entry,
  );
}

/** The rule that denies an address, or undefined when it may be connected to. */
export function checkAddress(
  ip: string,
  policy: EgressPolicy = egressPolicy(),
): EgressRule | undefined {
  const address = parseAddress(ip);
  if (!address) return undefined;
  if (policy.allowRanges.some((range) => inRange(address, range))) return undefined;
  if (METADATA_RANGES.some((range) => inRange(address, range))) return 'metadata';
  if (policy.privateTargets === 'deny' && PRIVATE_RANGES.some((range) => inRange(address, range)))
    return 'private';
  return undefined;
}

/**
 * What can be decided from the name alone: a literal address, a well-known metadata name,
 * `localhost`. Undefined means "allowed, or not known until resolved".
 */
export function checkHostname(
  hostname: string,
  policy: EgressPolicy = egressPolicy(),
): EgressRule | undefined {
  const name = normalizeHostname(hostname);
  if (!name) return undefined;
  if (hostAllowListed(name, policy)) return undefined;
  if (net.isIP(name)) return checkAddress(name, policy);
  if (METADATA_HOSTS.has(name)) return 'metadata';
  if (policy.privateTargets === 'deny' && (name === 'localhost' || name.endsWith('.localhost')))
    return 'private';
  return undefined;
}

/** The denial a hostname earns before any resolution, or undefined. */
export function denialForHostname(
  hostname: string,
  policy: EgressPolicy = egressPolicy(),
): EgressDeniedError | undefined {
  const rule = checkHostname(hostname, policy);
  return rule ? new EgressDeniedError(normalizeHostname(hostname), rule) : undefined;
}

/** The same for a URL; a text that is not a URL is left to whoever parses it next. */
export function denialForUrl(
  url: string | URL,
  policy: EgressPolicy = egressPolicy(),
): EgressDeniedError | undefined {
  let hostname: string;
  try {
    hostname = (typeof url === 'string' ? new URL(url) : url).hostname;
  } catch {
    return undefined;
  }
  return denialForHostname(hostname, policy);
}

// ───────────────────────────── Resolution ─────────────────────────────

/** The resolver, replaceable in tests that need a name to answer with a chosen address. */
export const egressPolicyDeps = {
  lookup: dns.lookup as net.LookupFunction,
  lookupAll: (hostname: string): Promise<dns.LookupAddress[]> =>
    dns.promises.lookup(hostname, { all: true }),
};

/** The rule denying any of the addresses a name resolved to, unless the name itself is exempt. */
function checkResolved(hostname: string, addresses: string[], policy: EgressPolicy) {
  if (hostAllowListed(hostname, policy)) return undefined;
  for (const address of addresses) {
    const rule = checkAddress(address, policy);
    if (rule) return rule;
  }
  return undefined;
}

/**
 * A `lookup` for net.connect, tls.connect and whatever takes one (undici's connector, ws's
 * createConnection): resolves as Node would, then refuses the connection when the answer is a
 * denied address. Because it runs at connect time, on every new connection, it is also the
 * check on each redirect hop and the answer to DNS rebinding. The policy is read on each call,
 * so a long-lived agent follows the environment.
 */
export function vettedLookup(fixed?: EgressPolicy): net.LookupFunction {
  return (hostname, options, callback) => {
    const policy = fixed ?? egressPolicy();
    egressPolicyDeps.lookup(hostname, options, (error, address, family) => {
      if (error) return callback(error, address, family);
      const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
      const rule = checkResolved(hostname, addresses, policy);
      if (rule) return callback(new EgressDeniedError(normalizeHostname(hostname), rule, true), '');
      callback(null, address, family);
    });
  };
}

/** True for a resolution failure, which is the target's problem, not the policy's. */
const unresolvable = (error: unknown) =>
  ['ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL', 'ENODATA', 'EAI_NODATA', 'EAI_NONAME'].includes(
    String((error as { code?: unknown })?.code ?? ''),
  );

/**
 * The addresses a name resolves to that the policy accepts, in resolver order; empty when the
 * name does not resolve (the connection will then fail on its own, with the right message).
 * Throws the denial when one of the answers is a denied address.
 */
export async function resolveVetted(
  hostname: string,
  policy: EgressPolicy = egressPolicy(),
): Promise<dns.LookupAddress[]> {
  const name = normalizeHostname(hostname);
  const literal = parseAddress(name);
  if (literal) {
    const rule = checkAddress(name, policy);
    if (rule) throw new EgressDeniedError(name, rule);
    return [{ address: name, family: literal.family }];
  }
  const rule = checkHostname(name, policy);
  if (rule) throw new EgressDeniedError(name, rule);
  let answers: dns.LookupAddress[];
  try {
    answers = await egressPolicyDeps.lookupAll(name);
  } catch (error) {
    if (unresolvable(error)) return [];
    throw error;
  }
  const denied = checkResolved(
    name,
    answers.map((entry) => entry.address),
    policy,
  );
  if (denied) throw new EgressDeniedError(name, denied, true);
  return answers;
}

/**
 * Refuses a URL the policy denies, by name or by what the name resolves to now. For transports
 * that resolve on their own and offer no hook; the ones that take a `lookup` use vettedLookup,
 * which leaves no window between this check and the connection.
 */
export async function assertEgressAllowed(
  url: string | URL,
  policy: EgressPolicy = egressPolicy(),
): Promise<void> {
  let hostname: string;
  try {
    hostname = (typeof url === 'string' ? new URL(url) : url).hostname;
  } catch {
    return;
  }
  await resolveVetted(hostname, policy);
}

// ───────────────────────────── Browsers ─────────────────────────────

/** Marks the answer the guard gives a denied request, so a navigation step can report it. */
export const EGRESS_POLICY_HEADER = 'x-wfm-egress-policy';

const RESOLUTION_CACHE_MS = 30_000;
const RESOLUTION_CACHE_MAX = 2000;
const resolutions = new Map<string, { expires: number; denial?: EgressDeniedError }>();

/** The denial for a request's host, with the resolution cached briefly: a page makes many requests to one host. */
async function browserDenial(
  hostname: string,
  policy: EgressPolicy,
): Promise<EgressDeniedError | undefined> {
  const immediate = denialForHostname(hostname, policy);
  if (immediate) return immediate;
  const name = normalizeHostname(hostname);
  if (net.isIP(name)) return undefined;
  const key = `${name}|${JSON.stringify(policy)}`;
  const cached = resolutions.get(key);
  if (cached && cached.expires > Date.now()) return cached.denial;
  let denial: EgressDeniedError | undefined;
  try {
    await resolveVetted(name, policy);
  } catch (error) {
    if (!isEgressDenied(error)) return undefined;
    denial = error;
  }
  if (resolutions.size >= RESOLUTION_CACHE_MAX)
    resolutions.delete(resolutions.keys().next().value as string);
  resolutions.set(key, { expires: Date.now() + RESOLUTION_CACHE_MS, denial });
  return denial;
}

/**
 * Keeps a browser the runner drives from reaching a denied target: the test's page could
 * otherwise read the metadata service with a plain fetch(). Every request of the context
 * is checked, by name and by what the name resolves to from the server (the browser resolves on
 * its own, so a name whose answer changes between the check and the browser's own lookup is
 * the proxy's to catch, in deployments that have one). A denied request is answered with a 403
 * that names the policy, which a navigation step turns into its error. Mocks registered later
 * run first, as Playwright calls the newest route first; this one is reached by fallback.
 */
export async function guardBrowserContext(
  context: BrowserContext,
  fixed?: EgressPolicy,
): Promise<void> {
  await context.route('**/*', async (route: Route) => {
    const policy = fixed ?? egressPolicy();
    let hostname: string;
    try {
      hostname = new URL(route.request().url()).hostname;
    } catch {
      return route.fallback().catch(() => undefined);
    }
    const denial = await browserDenial(hostname, policy);
    if (!denial) return route.fallback().catch(() => undefined);
    await route
      .fulfill({
        status: 403,
        contentType: 'text/plain; charset=utf-8',
        headers: {
          [EGRESS_POLICY_HEADER]: denial.rule,
          'access-control-allow-origin': '*',
          'access-control-expose-headers': EGRESS_POLICY_HEADER,
        },
        body: denial.message,
      })
      .catch(() => undefined);
  });
}

/** The policy's message when a navigation was answered by the guard; undefined for a real page. */
export function egressDenialOfResponse(
  response: PlaywrightResponse | null | undefined,
): string | undefined {
  if (!response) return undefined;
  const rule = response.headers()[EGRESS_POLICY_HEADER];
  if (rule !== 'metadata' && rule !== 'private') return undefined;
  let host = response.url();
  try {
    host = new URL(response.url()).hostname;
  } catch {
    /* the URL as it is */
  }
  return describeDenial(host, rule, false);
}

/** For the places that navigate: a denied page is the step's error, not a page to assert on. */
export function throwIfEgressDenied(response: PlaywrightResponse | null | undefined): void {
  const message = egressDenialOfResponse(response);
  if (message) throw new Error(message);
}
