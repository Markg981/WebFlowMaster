import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  allowsSelfSignedCertificate,
  dispatcherFor,
  fetchTarget,
  requestVariables,
  substituteInValues,
  substituteVariables,
} from './outbound-http';
import { egressPolicyDeps, isEgressDenied } from './egress-policy';

const ENV_KEYS = [
  'INSECURE_TLS_HOSTS',
  'DMO_BASE_URL',
  'NODE_ENV',
  'EGRESS_PRIVATE_TARGETS',
  'EGRESS_ALLOW_HOSTS',
] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('substituteVariables', () => {
  it('resolves {{baseUrl}} from DMO_BASE_URL', () => {
    process.env.DMO_BASE_URL = 'https://localhost:7000';
    expect(substituteVariables('{{baseUrl}}/api/NetContent/GetEquipment')).toBe(
      'https://localhost:7000/api/NetContent/GetEquipment',
    );
  });

  it('falls back to the local default when DMO_BASE_URL is unset', () => {
    delete process.env.DMO_BASE_URL;
    expect(requestVariables().baseUrl).toBe('http://localhost:7000');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(substituteVariables('{{ baseUrl }}/x', { baseUrl: 'http://h' })).toBe('http://h/x');
  });

  it('leaves unknown variables untouched so the mistake stays visible', () => {
    expect(substituteVariables('{{nope}}/x', { baseUrl: 'http://h' })).toBe('{{nope}}/x');
  });

  it('substitutes values of a record, including array values, but not keys', () => {
    const out = substituteInValues(
      { '{{baseUrl}}': '{{baseUrl}}/a', list: ['{{baseUrl}}/b', 'plain'] },
      { baseUrl: 'http://h' },
    );
    expect(out).toEqual({ '{{baseUrl}}': 'http://h/a', list: ['http://h/b', 'plain'] });
  });

  it('passes null/undefined records through', () => {
    expect(substituteInValues(null)).toBeNull();
    expect(substituteInValues(undefined)).toBeUndefined();
  });
});

describe('allowsSelfSignedCertificate', () => {
  it('allows only hosts listed in INSECURE_TLS_HOSTS', () => {
    process.env.NODE_ENV = 'development';
    process.env.INSECURE_TLS_HOSTS = 'localhost:7000, dev.internal:8443';

    expect(allowsSelfSignedCertificate('https://localhost:7000/api/x')).toBe(true);
    expect(allowsSelfSignedCertificate('https://dev.internal:8443/x')).toBe(true);
    // A different port is a different host: the exemption must not widen.
    expect(allowsSelfSignedCertificate('https://localhost:7001/api/x')).toBe(false);
    expect(allowsSelfSignedCertificate('https://example.com/x')).toBe(false);
  });

  it('never exempts anything in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.INSECURE_TLS_HOSTS = 'localhost:7000';
    expect(allowsSelfSignedCertificate('https://localhost:7000/api/x')).toBe(false);
  });

  it('exempts nothing when the variable is unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.INSECURE_TLS_HOSTS;
    expect(allowsSelfSignedCertificate('https://localhost:7000/api/x')).toBe(false);
  });

  it('returns false for a malformed URL instead of throwing', () => {
    process.env.NODE_ENV = 'development';
    process.env.INSECURE_TLS_HOSTS = 'localhost:7000';
    expect(allowsSelfSignedCertificate('not a url')).toBe(false);
  });

  it('uses a separate dispatcher for exempted hosts, and the guarded one for the rest', () => {
    process.env.NODE_ENV = 'development';
    process.env.INSECURE_TLS_HOSTS = 'localhost:7000';
    const exempted = dispatcherFor('https://localhost:7000/x');
    const ordinary = dispatcherFor('https://example.com/x');
    expect(exempted).toBeDefined();
    expect(ordinary).toBeDefined();
    expect(ordinary).not.toBe(exempted);
    expect(dispatcherFor('https://other.example/x')).toBe(ordinary);
  });
});

describe('fetchTarget under the egress policy', () => {
  let server: http.Server;
  let port: number;
  let hits: string[];
  const realLookup = egressPolicyDeps.lookup;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/to-metadata')
        return void res.writeHead(302, { Location: 'http://169.254.169.254/latest/' }).end();
      if (req.url === '/to-self')
        return void res.writeHead(302, { Location: `http://127.0.0.1:${port}/landed` }).end();
      res.writeHead(200, { 'content-type': 'text/plain' }).end('reached');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    // Names that do not exist answer with a chosen address, as a rebinding resolver would.
    egressPolicyDeps.lookup = (hostname, options, callback) => {
      const mapped = { 'rebind.test': '169.254.169.254', 'intranet.test': '127.0.0.1' }[hostname];
      realLookup(mapped ?? hostname, options, callback);
    };
  });
  beforeEach(() => {
    hits = [];
    delete process.env.WFM_EGRESS_PROXY;
  });
  afterAll(async () => {
    egressPolicyDeps.lookup = realLookup;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const denied = async (url: string, rule: 'metadata' | 'private') => {
    const error = await fetchTarget(url).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isEgressDenied(error), `expected a denial for ${url}`).toBe(true);
    expect(error).toMatchObject({ rule, status: 403 });
    expect(String((error as Error).message)).toMatch(/Blocked by the egress policy/);
    return error as Error;
  };

  it('reaches private addresses by default, as every installation did before', async () => {
    expect(await (await fetchTarget(`http://127.0.0.1:${port}/ok`)).text()).toBe('reached');
    expect(hits).toEqual(['/ok']);
  });

  it('refuses a metadata address before connecting, with the policy named', async () => {
    const error = await denied('http://169.254.169.254/latest/meta-data/', 'metadata');
    expect(error.message).toContain('169.254.169.254');
    await denied('http://[::ffff:169.254.169.254]/latest/', 'metadata');
    await denied('http://metadata.google.internal/computeMetadata/v1/', 'metadata');
  });

  it('refuses a redirect to a denied address at that hop', async () => {
    const error = await denied(`http://127.0.0.1:${port}/to-metadata`, 'metadata');
    expect(hits).toEqual(['/to-metadata']);
    expect(error.message).toContain('169.254.169.254');
    // A redirect to an allowed address is followed as before.
    expect(await (await fetchTarget(`http://127.0.0.1:${port}/to-self`)).text()).toBe('reached');
    expect(hits).toEqual(['/to-metadata', '/to-self', '/landed']);
  });

  it('refuses a name that resolves to a denied address, naming only the name', async () => {
    const error = await denied(`http://rebind.test:${port}/`, 'metadata');
    expect(error.message).toContain('rebind.test');
    expect(error.message).not.toContain('169.254');
    expect(hits).toEqual([]);
  });

  it('denies private targets, by literal and by resolution, only when asked to', async () => {
    process.env.EGRESS_PRIVATE_TARGETS = 'deny';
    await denied(`http://127.0.0.1:${port}/ok`, 'private');
    await denied(`http://intranet.test:${port}/ok`, 'private');
    await denied(`http://localhost:${port}/ok`, 'private');
    expect(hits).toEqual([]);
  });

  it('lets EGRESS_ALLOW_HOSTS exempt a name or a range from the denial', async () => {
    process.env.EGRESS_PRIVATE_TARGETS = 'deny';
    process.env.EGRESS_ALLOW_HOSTS = 'intranet.test, 10.0.0.0/8';
    expect(await (await fetchTarget(`http://intranet.test:${port}/ok`)).text()).toBe('reached');
    await denied(`http://127.0.0.1:${port}/ok`, 'private');
    process.env.EGRESS_ALLOW_HOSTS = '127.0.0.0/8';
    expect(await (await fetchTarget(`http://127.0.0.1:${port}/ok`)).text()).toBe('reached');
    expect(hits).toEqual(['/ok', '/ok']);
  });

  it('applies the same checks to the single-connection fetch used for NTLM', async () => {
    const connection = fetchTarget.oneConnection();
    try {
      await expect(connection.fetch('http://169.254.169.254/latest/')).rejects.toMatchObject({
        rule: 'metadata',
      });
      await expect(connection.fetch(`http://rebind.test:${port}/`)).rejects.toMatchObject({
        rule: 'metadata',
        resolved: true,
      });
      expect(await (await connection.fetch(`http://127.0.0.1:${port}/one`)).text()).toBe('reached');
    } finally {
      await connection.close();
    }
  });
});
