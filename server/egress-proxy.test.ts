import { describe, expect, it, afterEach, vi } from 'vitest';
import { egressProxy, browserEgressOptions, grpcEgressTarget } from './egress-proxy';

afterEach(() => vi.unstubAllEnvs());
describe('operator-controlled egress configuration', () => {
  it('leaves ordinary installations and local agents unchanged when unset', () => {
    vi.stubEnv('WFM_EGRESS_PROXY', '');
    expect(egressProxy()).toBeUndefined();
    expect(browserEgressOptions()).toEqual({});
    expect(grpcEgressTarget('service.test:443', 'service.test')).toEqual({ address: 'service.test:443', options: {} });
  });
  it.each(['garbage', 'socks5://proxy:3128', 'https://proxy:3128', 'http://user:password@proxy:3128', 'http://proxy:3128/path', 'http://proxy:3128?bypass=true'])('fails closed on unsupported configuration %s', value => {
    vi.stubEnv('WFM_EGRESS_PROXY', value);
    expect(() => egressProxy()).toThrow(/WFM_EGRESS_PROXY/);
  });
  it('forces browser loopback requests through the proxy, including Firefox', () => {
    vi.stubEnv('WFM_EGRESS_PROXY', 'http://egress:3128');
    expect(browserEgressOptions()).toEqual({ proxy: { server: 'http://egress:3128', bypass: '<-loopback>' }, firefoxUserPrefs: { 'network.proxy.allow_hijacking_localhost': true } });
  });
  it('preserves gRPC target authority and TLS identity inside CONNECT', () => {
    vi.stubEnv('WFM_EGRESS_PROXY', 'http://egress:3128');
    expect(grpcEgressTarget('service.test:443', 'service.test')).toEqual({ address: 'egress:3128', options: {
      'grpc.enable_http_proxy': 0,
      'grpc.http_connect_target': 'dns:///service.test:443',
      'grpc.default_authority': 'service.test:443',
      'grpc.ssl_target_name_override': 'service.test',
    } });
  });
});
