import { describe, it, expect, vi } from 'vitest';
import { assertStartupConfig, connectSessionStore, startupConfigErrors } from './startup-config';

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

describe('connecting the session store at startup', () => {
  const refused = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

  it('stops a production start and names what Redis answered', async () => {
    const warn = vi.fn();
    await expect(connectSessionStore(refused, warn, { NODE_ENV: 'production' })).rejects.toThrow(/ECONNREFUSED.*REDIS_URL/);
    expect(warn).not.toHaveBeenCalled();
  });

  it('only warns in development', async () => {
    const warn = vi.fn();
    await expect(connectSessionStore(refused, warn, { NODE_ENV: 'development' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('says nothing when Redis answers', async () => {
    const warn = vi.fn();
    await connectSessionStore(() => Promise.resolve(), warn, { NODE_ENV: 'production' });
    expect(warn).not.toHaveBeenCalled();
  });
});
