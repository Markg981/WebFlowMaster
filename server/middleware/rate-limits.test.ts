import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { type Request } from 'express';
import { apiRateLimit, webhookRateLimit } from './rate-limits';

/** An app where the x-test-key header stands in for a valid API key (see api-key-auth). */
function apiApp(env: NodeJS.ProcessEnv) {
  const app = express();
  app.use((req, _res, next) => {
    const key = req.header('x-test-key');
    if (key) (req as Request & { apiKeyId?: string }).apiKeyId = key;
    next();
  });
  app.use(apiRateLimit(env));
  app.get('/api/v1/runs', (_req, res) => res.json({ ok: true }));
  app.get('/api/tests', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('apiRateLimit', () => {
  it('stops a key past its limit with 429 and the error envelope', async () => {
    const app = apiApp({ API_RATE_LIMIT: '2' });
    await request(app).get('/api/tests').set('x-test-key', 'k1').expect(200);
    await request(app).get('/api/tests').set('x-test-key', 'k1').expect(200);
    const res = await request(app).get('/api/tests').set('x-test-key', 'k1').expect(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('counts each key on its own, not by the address they share', async () => {
    const app = apiApp({ API_RATE_LIMIT: '1' });
    await request(app).get('/api/tests').set('x-test-key', 'k1').expect(200);
    await request(app).get('/api/tests').set('x-test-key', 'k2').expect(200);
    await request(app).get('/api/tests').set('x-test-key', 'k1').expect(429);
  });

  it('limits anonymous calls to the public API by address', async () => {
    const app = apiApp({ API_RATE_LIMIT: '1' });
    await request(app).get('/api/v1/runs').expect(200);
    await request(app).get('/api/v1/runs').expect(429);
  });

  it('leaves a signed-in browser alone', async () => {
    const app = apiApp({ API_RATE_LIMIT: '1' });
    for (let i = 0; i < 3; i++) await request(app).get('/api/tests').expect(200);
  });

  it('is off at 0 and refuses a value that is not a whole number', async () => {
    const app = apiApp({ API_RATE_LIMIT: '0' });
    for (let i = 0; i < 3; i++) await request(app).get('/api/v1/runs').expect(200);
    expect(() => apiRateLimit({ API_RATE_LIMIT: 'lots' })).toThrow(/whole numbers/);
  });
});

describe('webhookRateLimit', () => {
  it('stops an address past its limit', async () => {
    const app = express();
    app.use('/api/webhooks', webhookRateLimit({ WEBHOOK_RATE_LIMIT: '1' }), (_req, res) => res.json({ ok: true }));
    await request(app).post('/api/webhooks/github').expect(200);
    const res = await request(app).post('/api/webhooks/github').expect(429);
    expect(res.body.error).toMatch(/Too many requests/);
  });
});
