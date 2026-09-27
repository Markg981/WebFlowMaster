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

  it('reports every problem at once', () => {
    expect(startupConfigErrors({ CONTENT_SECURITY_POLICY: 'strict', REGISTRATION: 'foo' })).toHaveLength(3);
  });
});
