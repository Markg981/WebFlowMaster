import { describe, it, expect } from 'vitest';
import { pinnedGrpcTarget } from './grpc-protocol';

/**
 * A name's vetted answers become one grpc-js target only when they share a family. On the
 * CI runners `localhost` answers `::1` and `127.0.0.1` while the fixture server listens on
 * the latter alone; pinning the first answer dialled an address nobody listened on, and
 * mutual TLS came back UNAVAILABLE.
 */
describe('pinnedGrpcTarget', () => {
  const url = new URL('grpcs://api.example.test:8443/pkg.Service/Method');

  it('pins every answer of one family, keeping the name for TLS and :authority', () => {
    expect(
      pinnedGrpcTarget(url, 'api.example.test', [
        { address: '10.0.0.5', family: 4 },
        { address: '10.0.0.6', family: 4 },
      ]),
    ).toEqual({
      address: 'ipv4:10.0.0.5:8443,10.0.0.6:8443',
      options: {
        'grpc.ssl_target_name_override': 'api.example.test',
        'grpc.default_authority': 'api.example.test:8443',
      },
    });
    expect(
      pinnedGrpcTarget(new URL('grpcs://v6.test/x/Y'), 'v6.test', [
        { address: '2001:db8::1', family: 6 },
      ])?.address,
    ).toBe('ipv6:[2001:db8::1]:443');
  });

  it('leaves a name answering in both families, and one with no answer, to grpc-js', () => {
    expect(
      pinnedGrpcTarget(url, 'localhost', [
        { address: '::1', family: 6 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).toBeNull();
    expect(pinnedGrpcTarget(url, 'nowhere.test', [])).toBeNull();
  });
});
