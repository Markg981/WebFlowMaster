import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  allowsSelfSignedCertificate,
  dispatcherFor,
  requestVariables,
  substituteInValues,
  substituteVariables,
} from './outbound-http';

const ENV_KEYS = ['INSECURE_TLS_HOSTS', 'DMO_BASE_URL', 'NODE_ENV'] as const;
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

  it('only builds a dispatcher for exempted hosts', () => {
    process.env.NODE_ENV = 'development';
    process.env.INSECURE_TLS_HOSTS = 'localhost:7000';
    expect(dispatcherFor('https://localhost:7000/x')).toBeDefined();
    expect(dispatcherFor('https://example.com/x')).toBeUndefined();
  });
});
