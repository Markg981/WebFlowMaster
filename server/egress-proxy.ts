import { EnvHttpProxyAgent, ProxyAgent, setGlobalDispatcher } from 'undici';
import type { LaunchOptions } from 'playwright';
import type { ChannelOptions } from '@grpc/grpc-js';

/** The hardened deployment's only external route. Invalid settings must never mean direct. */
export function egressProxy(): URL | undefined {
  const value = process.env.WFM_EGRESS_PROXY?.trim();
  if (!value) return undefined;
  let proxy: URL;
  try { proxy = new URL(value); } catch { throw new Error('WFM_EGRESS_PROXY must be an HTTP proxy origin.'); }
  if (proxy.protocol !== 'http:' || !proxy.hostname || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash) {
    throw new Error('WFM_EGRESS_PROXY must be an HTTP proxy origin without credentials, path or query.');
  }
  return proxy;
}

const dispatchers = new Map<string, ProxyAgent>();
export function targetEgressDispatcher(insecure = false): ProxyAgent | undefined {
  const proxy = egressProxy();
  if (!proxy) return undefined;
  const key = `${proxy.origin}:${insecure}`;
  let dispatcher = dispatchers.get(key);
  if (!dispatcher) {
    dispatcher = new ProxyAgent({ uri: proxy.origin, ...(insecure ? { requestTls: { rejectUnauthorized: false } } : {}) });
    dispatchers.set(key, dispatcher);
  }
  return dispatcher;
}

/** SDKs using Node fetch use the proxy too. Only the fixed internal relay bypasses it.
 * Target fetches have their own dispatcher, so user-supplied targets cannot opt into bypass. */
export function configureEgressProxy(): void {
  const proxy = egressProxy();
  if (!proxy) return;
  setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: proxy.origin, httpsProxy: proxy.origin, noProxy: 'api' }));
}

/** Chromium implicitly skips loopback; Firefox needs its separate localhost preference. */
export function browserEgressOptions(): LaunchOptions {
  const proxy = egressProxy();
  return proxy ? {
    proxy: { server: proxy.origin, bypass: '<-loopback>' },
    firefoxUserPrefs: { 'network.proxy.allow_hijacking_localhost': true },
  } : {};
}

/** Explicit CONNECT avoids grpc-js's environment/no_proxy fallback and preserves TLS identity. */
export function grpcEgressTarget(address: string, hostname: string): { address: string; options: ChannelOptions } {
  const proxy = egressProxy();
  return proxy ? { address: `${proxy.hostname}:${proxy.port || '80'}`, options: {
    'grpc.enable_http_proxy': 0,
    'grpc.http_connect_target': `dns:///${address}`,
    'grpc.default_authority': address,
    'grpc.ssl_target_name_override': hostname.replace(/^\[|\]$/g, ''),
  } } : { address, options: {} };
}
