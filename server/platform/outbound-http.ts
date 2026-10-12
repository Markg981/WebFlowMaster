import { Agent, ProxyAgent, buildConnector, type Dispatcher } from 'undici';
import { egressProxy, targetEgressDispatcher } from './egress-proxy';
import { denialForHostname, denialForUrl, egressDenialCause, vettedLookup } from './egress-policy';
import { defaultVariables } from '../runtime/variables';
import { substituteGenerators } from '../runtime/generators';

/**
 * Outbound HTTP for the systems under test (DMO and friends).
 *
 * Three concerns live here because all apply to every outbound call, whichever
 * runner makes it: resolving `{{variables}}` in URLs, deciding whether a
 * host is allowed to present a certificate Node would otherwise reject, and
 * refusing the targets the egress policy denies (server/platform/egress-policy.ts).
 */

/**
 * Variables available to saved tests, e.g. `{{baseUrl}}/api/NetContent/GetEquipment`.
 *
 * Only the defaults — no environment is known at this level. A caller that has a user and
 * an environment should use `resolveVariables` in ./variables, which layers that
 * environment's decrypted secrets on top of these. This stays as the fallback for the few
 * call sites with no scope to resolve against.
 */
export function requestVariables(): Record<string, string> {
  return defaultVariables();
}

/**
 * Replaces `{{name}}` placeholders. Unknown names are left untouched rather than
 * blanked, so a typo surfaces as an obviously wrong URL instead of a silently
 * mangled one.
 *
 * Generators (`{{$uuid}}`, see ./generators) are made up here too, after the variables, so
 * everything that resolves a placeholder can use them.
 */
export function substituteVariables(
  value: string,
  vars: Record<string, string> = requestVariables(),
): string {
  return substituteGenerators(
    value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) =>
      key in vars ? vars[key] : match,
    ),
    vars,
  );
}

/** Applies substitution to every string value of a record, leaving keys alone. */
export function substituteInValues<T extends Record<string, string | string[]>>(
  record: T | undefined | null,
  vars: Record<string, string> = requestVariables(),
): T | undefined | null {
  if (!record) return record;
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = Array.isArray(value)
      ? value.map((v) => substituteVariables(v, vars))
      : substituteVariables(value, vars);
  }
  return out as T;
}

/**
 * Hosts whose TLS certificate is not verified, from INSECURE_TLS_HOSTS
 * (comma-separated `host:port`, e.g. "localhost:7000,dev.internal:8443").
 *
 * Development systems commonly serve https with a self-signed certificate, which
 * Node rejects outright (DEPTH_ZERO_SELF_SIGNED_CERT) before any request is sent.
 * The exemption is deliberately per-host and opt-in: it never disables
 * certificate verification globally, and it is ignored in production, where an
 * untrusted certificate is a real signal rather than a dev-setup annoyance.
 */
function insecureHosts(): Set<string> {
  return new Set(
    (process.env.INSECURE_TLS_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function allowsSelfSignedCertificate(url: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return insecureHosts().has(host);
}

/**
 * How a direct connection to a target is opened: undici's own connector, resolving names
 * through the policy's lookup, behind a check of the name itself. The check runs for every
 * connection the dispatcher opens, so a redirect to a denied host is refused at its own hop,
 * and a name that resolves to a denied address is refused when it is resolved, not only when
 * the URL was read. With WFM_EGRESS_PROXY the target is never resolved here: the proxy's
 * firewall decides, and fetchTarget's check of the URL still answers first for the names and
 * literal addresses the policy denies.
 */
export function guardedConnector(
  options: buildConnector.BuildOptions = {},
): buildConnector.connector {
  const connect = buildConnector({ ...options, lookup: vettedLookup() });
  return (opts, callback) => {
    const denial = denialForHostname(opts.hostname);
    if (denial) {
      queueMicrotask(() => callback(denial, null));
      return;
    }
    connect(opts, callback);
  };
}

let guardedAgent: Agent | undefined;
let insecureAgent: Agent | undefined;

/** The dispatcher to use for a target URL: the proxy where there is one, else a guarded agent. */
export function dispatcherFor(url: string): Dispatcher {
  const insecure = allowsSelfSignedCertificate(url);
  const proxy = targetEgressDispatcher(insecure);
  if (proxy) return proxy;
  if (insecure) {
    insecureAgent ??= new Agent({ connect: guardedConnector({ rejectUnauthorized: false }) });
    return insecureAgent;
  }
  guardedAgent ??= new Agent({ connect: guardedConnector() });
  return guardedAgent;
}

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

/** fetch hides a refused connection behind "fetch failed"; the policy's own message is the useful one. */
const rethrowDenial = (error: unknown): never => {
  throw egressDenialCause(error) ?? error;
};

/**
 * fetch() for systems under test: same contract, plus the per-host TLS exemption and the egress
 * policy. A denied URL is refused before anything is sent; a denied redirect or resolution is
 * refused by the dispatcher, and surfaces here as the policy's error rather than a network one.
 */
export const fetchTarget: typeof fetch & {
  oneConnection: () => { fetch: typeof fetch; close: () => Promise<void> };
} = Object.assign(
  (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = urlOf(input);
    const denial = denialForUrl(url);
    if (denial) return Promise.reject(denial);
    const dispatcher = dispatcherFor(url);
    // `dispatcher` is an undici extension to RequestInit that Node's fetch honours
    // but the DOM typings don't describe.
    return fetch(input, { ...init, dispatcher } as RequestInit).catch(rethrowDenial);
  },
  {
    /**
     * Requests that all travel on one connection, for NTLM, whose handshake belongs to the
     * connection (server/api-tests/api-test-runner.ts). Closed by the caller when the exchange is over.
     */
    oneConnection() {
      let agent: Agent | ProxyAgent | undefined;
      return {
        fetch: ((input: RequestInfo | URL, init: RequestInit = {}) => {
          const denial = denialForUrl(urlOf(input));
          if (denial) return Promise.reject(denial);
          const proxy = egressProxy();
          agent ??= proxy
            ? new ProxyAgent({
                uri: proxy.origin,
                connections: 1,
                pipelining: 1,
                ...(allowsSelfSignedCertificate(urlOf(input))
                  ? { requestTls: { rejectUnauthorized: false } }
                  : {}),
              })
            : new Agent({
                connections: 1,
                pipelining: 1,
                connect: guardedConnector(
                  allowsSelfSignedCertificate(urlOf(input)) ? { rejectUnauthorized: false } : {},
                ),
              });
          return fetch(input, { ...init, dispatcher: agent } as RequestInit).catch(rethrowDenial);
        }) as typeof fetch,
        close: async () => {
          await agent?.close();
        },
      };
    },
  },
);
