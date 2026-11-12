import { describe, expect, it } from 'vitest';
import { comparisonPolicyOf, type NetworkCheckpointEntry } from '@shared/comparison';
import { diffNetwork } from './diff-network';
import { stepsWith } from './test-fixtures';

const e = (over: Partial<NetworkCheckpointEntry> = {}): NetworkCheckpointEntry => ({
  method: 'GET',
  path: '/api/orders',
  query: [],
  requestBodyHash: null,
  status: 200,
  ...over,
});
const net = (...entries: NetworkCheckpointEntry[]) =>
  stepsWith('network', { name: 'calls', data: { entries } });
const policy = comparisonPolicyOf({});
const paths = (d: { path: string }[]) => d.map((x) => x.path);

describe('diffNetwork', () => {
  it('finds nothing between the same calls, whatever their order', () => {
    expect(
      diffNetwork(net(e(), e({ method: 'POST' })), net(e({ method: 'POST' }), e()), policy),
    ).toEqual([]);
  });

  it('reports a call made a different number of times, a status and a request body', () => {
    const d = diffNetwork(
      net(e(), e({ path: '/api/lines' }), e({ method: 'POST', requestBodyHash: 'a' })),
      net(
        e(),
        e(),
        e({ path: '/api/lines', status: 500 }),
        e({ method: 'POST', requestBodyHash: 'b' }),
      ),
      policy,
    );
    expect(paths(d).sort()).toEqual([
      'requests[GET /api/lines].status',
      'requests[GET /api/orders].count',
      'requests[POST /api/orders].requestBody',
    ]);
  });

  it('counts only the paths the policy includes, and drops the ignored query parameters', () => {
    const a = net(e({ query: ['_=1', 'id=7'] }), e({ path: '/static/app.js' }));
    const b = net(e({ query: ['_=2', 'id=7'] }));
    expect(paths(diffNetwork(a, b, policy))).toEqual([
      'requests[GET /api/orders?_=1&id=7].count',
      'requests[GET /api/orders?_=2&id=7].count',
    ]);
    const ignoring = comparisonPolicyOf({ network: { ignoreQueryParams: ['_'] } });
    expect(diffNetwork(a, b, ignoring)).toEqual([]);
    const everything = comparisonPolicyOf({ network: { include: [], ignoreQueryParams: ['_'] } });
    expect(paths(diffNetwork(a, b, everything))).toEqual(['requests[GET /static/app.js].count']);
  });

  it('compares the response hashes only when the policy asks, and only where both have one', () => {
    const a = net(e({ responseBodyHash: 'x' }), e({ path: '/api/img' }));
    const b = net(e({ responseBodyHash: 'y' }), e({ path: '/api/img', responseBodyHash: 'z' }));
    expect(diffNetwork(a, b, policy)).toEqual([]);
    const hashing = comparisonPolicyOf({ network: { compareResponseHash: true } });
    expect(paths(diffNetwork(a, b, hashing))).toEqual(['requests[GET /api/orders].responseBody']);
  });
});
