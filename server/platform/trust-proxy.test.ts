import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { trustProxySetting } from './trust-proxy';

describe('TRUST_PROXY parsing', () => {
  it('defaults to one hop', () => {
    expect(trustProxySetting({})).toBe(1);
    expect(trustProxySetting({ TRUST_PROXY: ' ' })).toBe(1);
  });
  it('accepts counts and booleans', () => {
    expect(trustProxySetting({ TRUST_PROXY: '2' })).toBe(2);
    expect(trustProxySetting({ TRUST_PROXY: '0' })).toBe(0);
    expect(trustProxySetting({ TRUST_PROXY: 'false' })).toBe(false);
    expect(trustProxySetting({ TRUST_PROXY: 'TRUE' })).toBe(true);
  });
  it('accepts lists of addresses, CIDRs and named ranges', () => {
    expect(trustProxySetting({ TRUST_PROXY: 'loopback, 10.0.0.0/8,fd00::/8' })).toEqual([
      'loopback',
      '10.0.0.0/8',
      'fd00::/8',
    ]);
  });
  it.each(['yes', '10.0.0.0/33', 'loopback,,', '1.2.3', 'a/b/c'])('rejects %s', (value) => {
    expect(() => trustProxySetting({ TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
  });
});

describe('per-IP limiter and X-Forwarded-For', () => {
  async function hits(trustProxy: string, attempts: number): Promise<number[]> {
    const app = express();
    app.set('trust proxy', trustProxySetting({ TRUST_PROXY: trustProxy }));
    app.use(rateLimit({ windowMs: 60_000, max: 3, standardHeaders: false, legacyHeaders: false }));
    app.get('/', (_req, res) => res.send('ok'));
    const statuses: number[] = [];
    for (let i = 0; i < attempts; i++) {
      const res = await request(app).get('/').set('X-Forwarded-For', `203.0.113.${i + 1}`);
      statuses.push(res.status);
    }
    return statuses;
  }

  it('with TRUST_PROXY=false a rotating X-Forwarded-For does not reset the limit', async () => {
    expect((await hits('false', 5)).slice(3)).toEqual([429, 429]);
  });

  it('with a blindly trusted header the rotation evades the limit (the risk being documented)', async () => {
    expect(await hits('true', 5)).toEqual([200, 200, 200, 200, 200]);
  });
});
