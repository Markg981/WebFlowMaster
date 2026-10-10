import { describe, it, expect } from 'vitest';
import { assertStartupConfig, startupConfigErrors } from './startup-config';

const valid = { SESSION_SECRET: 's'.repeat(32) };

describe('the startup configuration check', () => {
  it('passes a configuration with a session secret and the rest left to defaults', () => {
    expect(startupConfigErrors(valid)).toEqual([]);
    expect(() => assertStartupConfig(valid)).not.toThrow();
  });

  it.each([
    [{ CONTENT_SECURITY_POLICY: 'strict' }, 'CONTENT_SECURITY_POLICY'],
    [{ REGISTRATION: 'foo' }, 'REGISTRATION'],
    [{ PORT: 'eighty' }, 'PORT'],
  ])('names the variable that is wrong: %o', (bad, name) => {
    expect(() => assertStartupConfig({ ...valid, ...bad })).toThrow(name);
  });

  it('names a missing SESSION_SECRET', () => {
    expect(() => assertStartupConfig({})).toThrow('SESSION_SECRET');
  });

  it.each([
    ['ENCRYPTION_KEY', '0'.repeat(64)],
    ['ENCRYPTION_KEY', 'change-me-64-hex-characters'],
    ['SESSION_SECRET', 'change-me'],
    ['SESSION_SECRET', '7G823eU1afEmmjSg73Juk_wRoVPt6mqbjBXliA6XXNg'],
    ['AGENT_RELAY_SECRET', '4Qm9zR2vX7cL1pT8wK3nB6yH5dF0sJ'],
  ])('refuses the published %s %s in production', (name, value) => {
    const env = { ...valid, NODE_ENV: 'production', [name]: value };
    expect(() => assertStartupConfig(env)).toThrow(name);
  });

  it('lets development start with the example values', () => {
    expect(startupConfigErrors({ SESSION_SECRET: 'change-me', ENCRYPTION_KEY: '0'.repeat(64) })).toEqual([]);
  });

  it('accepts generated secrets in production', () => {
    const env = { NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(64), ENCRYPTION_KEY: 'b'.repeat(64), AGENT_RELAY_SECRET: 'c'.repeat(64) };
    expect(startupConfigErrors(env)).toEqual([]);
  });

  it('reports every problem at once', () => {
    expect(startupConfigErrors({ CONTENT_SECURITY_POLICY: 'strict', REGISTRATION: 'foo' })).toHaveLength(3);
  });
});
