import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { cspMode, securityHeaders } from './security-headers';

function appWith(env: NodeJS.ProcessEnv) {
  const app = express();
  app.use(securityHeaders(env));
  app.get('/', (_req, res) => res.send('ok'));
  return app;
}

describe('cspMode', () => {
  it('enforces in production and stays off elsewhere unless asked', () => {
    expect(cspMode({ NODE_ENV: 'production' })).toBe('enforce');
    expect(cspMode({ NODE_ENV: 'development' })).toBe('off');
    expect(cspMode({ NODE_ENV: 'development', CONTENT_SECURITY_POLICY: 'report-only' })).toBe('report-only');
    expect(cspMode({ NODE_ENV: 'production', CONTENT_SECURITY_POLICY: 'off' })).toBe('off');
  });

  it('refuses a value it does not know, rather than running without the policy', () => {
    expect(() => cspMode({ NODE_ENV: 'production', CONTENT_SECURITY_POLICY: 'strict' })).toThrow(/CONTENT_SECURITY_POLICY/);
  });
});

describe('securityHeaders', () => {
  it('sends a policy that allows only this origin for scripts and connections', async () => {
    const res = await request(appWith({ NODE_ENV: 'production' })).get('/').expect(200);
    const policy = res.headers['content-security-policy'];
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'self'");
    expect(res.headers['content-security-policy-report-only']).toBeUndefined();
  });

  it('only reports in report-only mode', async () => {
    const res = await request(appWith({ NODE_ENV: 'production', CONTENT_SECURITY_POLICY: 'report-only' })).get('/');
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['content-security-policy-report-only']).toContain("script-src 'self'");
  });

  it('keeps the other headers when the policy is off', async () => {
    const res = await request(appWith({ NODE_ENV: 'development' })).get('/');
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
