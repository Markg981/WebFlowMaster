import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import {
  EgressDeniedError,
  assertEgressAllowed,
  checkAddress,
  checkHostname,
  denialForNavigation,
  denialForUrl,
  egressDenialCause,
  egressPolicy,
  egressPolicyDeps,
  parseAddress,
  parseRange,
  resolveVetted,
  vettedLookup,
} from './egress-policy';
import { runGrpc, runWebSocket } from '../api-tests/api-network-protocols';
import { forbiddenNavigationScheme } from '@shared/browser-navigation';
import { AdhocTestStepSchema, insertTestSchema } from '@shared/schema';

afterEach(() => vi.unstubAllEnvs());

const allow = egressPolicy({});
const deny = egressPolicy({ EGRESS_PRIVATE_TARGETS: 'deny' });

describe('egress policy configuration', () => {
  it('allows private targets by default, which is what every installation did before', () => {
    expect(allow).toEqual({ privateTargets: 'allow', allowHosts: [], allowRanges: [] });
    expect(egressPolicy({ EGRESS_PRIVATE_TARGETS: ' Deny ' }).privateTargets).toBe('deny');
  });
  it('refuses a value that is neither allow nor deny rather than reading it as allow', () => {
    expect(() => egressPolicy({ EGRESS_PRIVATE_TARGETS: 'denied' })).toThrow(
      /EGRESS_PRIVATE_TARGETS/,
    );
  });
  it('reads hostnames, wildcards and CIDRs from EGRESS_ALLOW_HOSTS', () => {
    const policy = egressPolicy({
      EGRESS_ALLOW_HOSTS:
        ' Vault.Internal., *.corp.example, 10.1.0.0/16, 192.0.0.192, fd00:ec2::254/128 ',
    });
    expect(policy.allowHosts).toEqual(['vault.internal', '*.corp.example']);
    expect(policy.allowRanges.map((range) => `${range.family}/${range.prefix}`)).toEqual([
      '4/16',
      '4/32',
      '6/128',
    ]);
    expect(() => egressPolicy({ EGRESS_ALLOW_HOSTS: 'http://x' })).toThrow(/EGRESS_ALLOW_HOSTS/);
    expect(() => egressPolicy({ EGRESS_ALLOW_HOSTS: '10.0.0.0/33' })).toThrow(/EGRESS_ALLOW_HOSTS/);
  });
});

describe('addresses', () => {
  it('reads IPv4-mapped and embedded IPv6 forms as the IPv4 address they carry', () => {
    expect(parseAddress('169.254.169.254')).toEqual({ family: 4, bytes: [169, 254, 169, 254] });
    for (const form of [
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      '[::ffff:a9fe:a9fe]',
      '::169.254.169.254',
      '64:ff9b::169.254.169.254',
    ])
      expect(parseAddress(form), form).toEqual({ family: 4, bytes: [169, 254, 169, 254] });
    expect(parseAddress('::1')).toMatchObject({ family: 6 });
    expect(parseAddress('fe80::1%eth0')?.bytes.slice(0, 2)).toEqual([0xfe, 0x80]);
    expect(parseAddress('metadata')).toBeUndefined();
    expect(parseAddress('1.2.3')).toBeUndefined();
    expect(parseRange('10.0.0.0/8')).toMatchObject({ family: 4, prefix: 8 });
    expect(parseRange('10.0.0.0/8/x')).toBeUndefined();
    expect(parseRange('10.0.0.0/-1')).toBeUndefined();
  });

  it('always denies cloud metadata addresses, in every form', () => {
    for (const address of [
      '169.254.169.254',
      '169.254.170.2', // ECS task metadata, same block
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      'fd00:ec2::254',
      '100.100.100.200',
      '192.0.0.192',
      '168.63.129.16',
    ]) {
      expect(checkAddress(address, allow), address).toBe('metadata');
      expect(checkAddress(address, deny), address).toBe('metadata');
    }
  });

  it('denies private, loopback, link-local and unique-local addresses only under deny', () => {
    for (const address of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(checkAddress(address, allow), address).toBeUndefined();
      expect(checkAddress(address, deny), address).toBe('private');
    }
    for (const address of ['172.32.0.1', '8.8.8.8', '93.184.216.34', '2606:4700::1111'])
      expect(checkAddress(address, deny), address).toBeUndefined();
  });

  it('exempts addresses inside an allow-listed range from both rules', () => {
    const policy = egressPolicy({
      EGRESS_PRIVATE_TARGETS: 'deny',
      EGRESS_ALLOW_HOSTS: '10.1.0.0/16, 169.254.169.254/32',
    });
    expect(checkAddress('10.1.200.7', policy)).toBeUndefined();
    expect(checkAddress('10.2.0.1', policy)).toBe('private');
    expect(checkAddress('169.254.169.254', policy)).toBeUndefined();
    expect(checkAddress('169.254.169.253', policy)).toBe('metadata');
  });
});

describe('reserved ranges under deny', () => {
  it.each([
    '100.64.0.1',
    '100.127.255.254',
    '198.18.0.1',
    '198.19.255.255',
    '192.0.0.1',
    '224.0.0.1',
    '239.255.255.250',
    'ff02::1',
    '2002:c0a8:101::1',
  ])('refuses %s', (address) => {
    expect(checkAddress(address, deny)).toBeDefined();
    expect(checkAddress(address, allow)).toBeUndefined();
  });
});

describe('hostnames', () => {
  it('denies the well-known metadata names and literal addresses, whatever the case', () => {
    expect(checkHostname('metadata.google.internal', allow)).toBe('metadata');
    expect(checkHostname('METADATA.google.internal.', allow)).toBe('metadata');
    expect(checkHostname('metadata', allow)).toBe('metadata');
    expect(checkHostname('[::ffff:169.254.169.254]', allow)).toBe('metadata');
    expect(checkHostname('169.254.169.254', allow)).toBe('metadata');
    expect(checkHostname('metadata.example.com', allow)).toBeUndefined();
  });
  it('treats localhost as private, and leaves other names to resolution', () => {
    expect(checkHostname('localhost', allow)).toBeUndefined();
    expect(checkHostname('localhost', deny)).toBe('private');
    expect(checkHostname('app.localhost', deny)).toBe('private');
    expect(checkHostname('intranet.corp', deny)).toBeUndefined();
  });
  it('exempts allow-listed names and their subtrees', () => {
    const policy = egressPolicy({
      EGRESS_PRIVATE_TARGETS: 'deny',
      EGRESS_ALLOW_HOSTS: 'metadata.google.internal, *.corp.example, localhost',
    });
    expect(checkHostname('metadata.google.internal', policy)).toBeUndefined();
    expect(checkHostname('metadata', policy)).toBe('metadata');
    expect(checkHostname('localhost', policy)).toBeUndefined();
    expect(checkHostname('app.corp.example', policy)).toBeUndefined();
    expect(checkHostname('corp.example', policy)).toBeUndefined();
    expect(checkHostname('corp.example.evil', policy)).toBeUndefined();
  });
  it('answers for a URL, naming the host as the user wrote it', () => {
    const denial = denialForUrl('http://169.254.169.254/latest/meta-data/iam/', allow);
    expect(denial).toBeInstanceOf(EgressDeniedError);
    expect(denial).toMatchObject({ rule: 'metadata', status: 403, target: '169.254.169.254' });
    expect(denial?.message).toMatch(/Blocked by the egress policy.*EGRESS_ALLOW_HOSTS/);
    expect(denialForUrl('http://example.com/', deny)).toBeUndefined();
    expect(denialForUrl('not a url', deny)).toBeUndefined();
    expect(egressDenialCause(new TypeError('fetch failed', { cause: denial }))).toBe(denial);
    expect(egressDenialCause(new Error('other'))).toBeUndefined();
  });
});

describe('resolution', () => {
  const realLookup = egressPolicyDeps.lookup;
  const realLookupAll = egressPolicyDeps.lookupAll;
  const table: Record<string, string[]> = {
    'rebind.test': ['93.184.216.34', '169.254.169.254'],
    'intranet.test': ['10.1.2.3'],
    'public.test': ['93.184.216.34'],
    'v6.test': ['::ffff:a9fe:a9fe'],
  };
  beforeAll(() => {
    egressPolicyDeps.lookupAll = async (hostname) => {
      const answers = table[hostname];
      if (!answers) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
      return answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    };
    egressPolicyDeps.lookup = (hostname, options, callback) => {
      const answers = table[hostname];
      if (!answers)
        return callback(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }), '');
      const all = answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
      if (options.all) callback(null, all);
      else callback(null, all[0].address, all[0].family);
    };
  });
  afterAll(() => {
    egressPolicyDeps.lookup = realLookup;
    egressPolicyDeps.lookupAll = realLookupAll;
  });

  it('refuses a name when any of its answers is denied: the second answer is the rebinding', async () => {
    await expect(resolveVetted('rebind.test', allow)).rejects.toMatchObject({
      rule: 'metadata',
      resolved: true,
      target: 'rebind.test',
    });
    const error = await resolveVetted('v6.test', allow).catch((e: Error) => e);
    expect(error).toMatchObject({ rule: 'metadata', resolved: true });
    expect((error as Error).message).not.toContain('a9fe');
    expect(await resolveVetted('public.test', allow)).toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(await resolveVetted('intranet.test', allow)).toHaveLength(1);
    await expect(resolveVetted('intranet.test', deny)).rejects.toMatchObject({ rule: 'private' });
  });

  it('leaves an unresolvable name to the connection, and a literal to the address rules', async () => {
    expect(await resolveVetted('nowhere.test', deny)).toEqual([]);
    expect(await resolveVetted('[::1]', allow)).toEqual([{ address: '::1', family: 6 }]);
    await expect(resolveVetted('169.254.169.254', allow)).rejects.toMatchObject({
      rule: 'metadata',
      resolved: false,
    });
  });

  it('exempts an allow-listed name whatever it resolves to', async () => {
    const policy = egressPolicy({ EGRESS_ALLOW_HOSTS: 'rebind.test' });
    expect(await resolveVetted('rebind.test', policy)).toHaveLength(2);
    await expect(assertEgressAllowed('http://rebind.test/x', allow)).rejects.toMatchObject({
      rule: 'metadata',
    });
    await expect(assertEgressAllowed('http://rebind.test/x', policy)).resolves.toBeUndefined();
  });

  it('answers net.connect as a lookup, refusing at connect time', async () => {
    const lookup = vettedLookup(deny);
    const call = (hostname: string, all: boolean) =>
      new Promise<{ error: unknown; address: unknown }>((resolve) =>
        lookup(hostname, { all }, (error, address) => resolve({ error, address })),
      );
    expect(await call('public.test', true)).toEqual({
      error: null,
      address: [{ address: '93.184.216.34', family: 4 }],
    });
    expect(await call('public.test', false)).toMatchObject({
      error: null,
      address: '93.184.216.34',
    });
    expect((await call('rebind.test', true)).error).toMatchObject({
      rule: 'metadata',
      resolved: true,
    });
    expect((await call('intranet.test', false)).error).toMatchObject({ rule: 'private' });
    expect((await call('nowhere.test', true)).error).toMatchObject({ code: 'ENOTFOUND' });
    // The policy is read on each call when none is fixed: a long-lived agent follows the environment.
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'deny');
    expect(
      (await new Promise<unknown>((resolve) =>
        vettedLookup()('intranet.test', { all: true }, (error) => resolve(error)),
      )) as object,
    ).toMatchObject({ rule: 'private' });
  });
});

describe('other transports', () => {
  const realLookup = egressPolicyDeps.lookup;
  const realLookupAll = egressPolicyDeps.lookupAll;
  let server: http.Server;
  let port: number;
  const proto =
    'syntax = "proto3"; package egress; service Echo { rpc Say (Message) returns (Message); } message Message { string text = 1; }';
  beforeAll(async () => {
    server = http.createServer((_req, res) => res.writeHead(200).end('http'));
    const ws = new WebSocketServer({ server });
    ws.on('connection', (socket) => socket.on('message', (message) => socket.send(message)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    egressPolicyDeps.lookup = (hostname, options, callback) =>
      realLookup(hostname === 'rebind.test' ? '169.254.169.254' : hostname, options, callback);
    egressPolicyDeps.lookupAll = (hostname) =>
      realLookupAll(hostname === 'rebind.test' ? '169.254.169.254' : hostname);
  });
  afterAll(async () => {
    egressPolicyDeps.lookup = realLookup;
    egressPolicyDeps.lookupAll = realLookupAll;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses a WebSocket to a denied address, by name and at connect time', async () => {
    const plan = { headers: {}, body: '{"send":["hi"],"until":1}', timeoutMs: 1500 };
    await expect(runWebSocket({ ...plan, url: 'ws://169.254.169.254/' })).rejects.toMatchObject({
      rule: 'metadata',
    });
    await expect(runWebSocket({ ...plan, url: `ws://rebind.test:${port}/` })).rejects.toMatchObject(
      { rule: 'metadata', resolved: true },
    );
    const response = await runWebSocket({ ...plan, url: `ws://127.0.0.1:${port}/echo` });
    expect(response.body).toMatchObject({ last: 'hi', count: 1 });
  });

  it('refuses a gRPC channel to a denied address before dialling', async () => {
    const call = (url: string) =>
      runGrpc({
        url: new URL(url),
        proto,
        headers: {},
        body: '{"text":"x"}',
        timeoutMs: 1500,
      });
    await expect(call('grpc://169.254.169.254:50051/egress.Echo/Say')).rejects.toMatchObject({
      rule: 'metadata',
    });
    await expect(call('grpc://rebind.test:50051/egress.Echo/Say')).rejects.toMatchObject({
      rule: 'metadata',
      resolved: true,
    });
  });
});

describe('browser navigation policy', () => {
  it('lets a browser test open web pages and about:blank, and nothing else', () => {
    for (const url of ['https://app.example/x', 'http://10.0.0.5:8080/', 'about:blank'])
      expect(denialForNavigation(url)).toBeUndefined();
    for (const [url, scheme] of [
      ['file:///etc/passwd', 'file://'],
      ['FILE:///C:/Windows/win.ini', 'file://'],
      ['view-source:file:///etc/passwd', 'view-source://'],
      ['chrome://settings', 'chrome://'],
      ['javascript:alert(1)', 'javascript://'],
    ])
      expect(denialForNavigation(url)).toMatchObject({ rule: 'scheme', target: scheme });
    expect(denialForNavigation('file:///x')?.message).toMatch(
      /^Blocked by the egress policy: file:\/\/ pages are not web addresses/,
    );
  });

  it('leaves a value built from variables to the run, where it is finally known', () => {
    expect(forbiddenNavigationScheme('{{baseUrl}}/login')).toBeUndefined();
    expect(forbiddenNavigationScheme('')).toBeUndefined();
    expect(forbiddenNavigationScheme(' file:///tmp/x ')).toBe('file:');
  });

  it('refuses a file:// navigate step and start URL when the test is saved', () => {
    const step = (value: string) =>
      AdhocTestStepSchema.safeParse({
        id: 's',
        action: {
          id: 'navigate',
          type: 'navigate',
          name: 'Navigate',
          icon: 'x',
          description: 'go',
        },
        value,
      });
    expect(step('https://app.example/').success).toBe(true);
    const refused = step('file:///etc/passwd');
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toMatch(/http\(s\) address/);
    const start = insertTestSchema.shape.url;
    expect(start.safeParse('{{baseUrl}}/').success).toBe(true);
    expect(start.safeParse('https://app.example/').success).toBe(true);
    expect(start.safeParse('file:///C:/secrets.html').success).toBe(false);
  });
});
