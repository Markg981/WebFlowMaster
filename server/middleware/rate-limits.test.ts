import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { type Request } from 'express';
import { apiRateLimit, heavyRateLimit, sessionRateLimit, webhookRateLimit } from './rate-limits';

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
    app.use('/api/webhooks', webhookRateLimit({ WEBHOOK_RATE_LIMIT: '1' }), (_req, res) =>
      res.json({ ok: true }),
    );
    await request(app).post('/api/webhooks/github').expect(200);
    const res = await request(app).post('/api/webhooks/github').expect(429);
    expect(res.body.error).toMatch(/Too many requests/);
  });
});

describe('heavyRateLimit', () => {
  /** An app where the x-test-user header stands in for a signed-in session. */
  function heavyApp(env: NodeJS.ProcessEnv) {
    const app = express();
    app.use((req, _res, next) => {
      const id = req.header('x-test-user');
      if (id) req.user = { id: Number(id) } as Express.User;
      next();
    });
    app.post('/api/load-website', heavyRateLimit(env), (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('stops a signed-in user past the limit, whatever apiRateLimit lets through', async () => {
    const app = heavyApp({ HEAVY_RATE_LIMIT: '2' });
    await request(app).post('/api/load-website').set('x-test-user', '1').expect(200);
    await request(app).post('/api/load-website').set('x-test-user', '1').expect(200);
    const res = await request(app).post('/api/load-website').set('x-test-user', '1').expect(429);
    expect(res.body.error).toMatch(/Too many requests/);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('counts each user on its own, and anonymous calls by address', async () => {
    const app = heavyApp({ HEAVY_RATE_LIMIT: '1' });
    await request(app).post('/api/load-website').set('x-test-user', '1').expect(200);
    await request(app).post('/api/load-website').set('x-test-user', '2').expect(200);
    await request(app).post('/api/load-website').set('x-test-user', '1').expect(429);
    await request(app).post('/api/load-website').expect(200);
    await request(app).post('/api/load-website').expect(429);
  });

  it('is off at 0 and defaults to 30 a minute', async () => {
    const app = heavyApp({ HEAVY_RATE_LIMIT: '0' });
    for (let i = 0; i < 3; i++)
      await request(app).post('/api/load-website').set('x-test-user', '1').expect(200);
    const defaults = heavyApp({});
    const res = await request(defaults).post('/api/load-website').set('x-test-user', '1');
    expect(res.headers['ratelimit-policy']).toMatch(/^30;/);
    expect(() => heavyRateLimit({ HEAVY_RATE_LIMIT: 'many' })).toThrow(/whole numbers/);
  });
});

describe('sessionRateLimit', () => {
  /** x-test-user stands in for a signed-in session, x-test-key for a valid API key. */
  function sessionApp(env: NodeJS.ProcessEnv) {
    const app = express();
    app.use((req, _res, next) => {
      const id = req.header('x-test-user');
      if (id) req.user = { id: Number(id) } as Express.User;
      const key = req.header('x-test-key');
      if (key) (req as Request & { apiKeyId?: string }).apiKeyId = key;
      next();
    });
    app.use('/api', sessionRateLimit(env));
    app.get('/api/tests', (_req, res) => res.json({ ok: true }));
    app.get('/assets/app.js', (_req, res) => res.send(''));
    return app;
  }

  it('stops a signed-in user past the limit, and counts each user on their own', async () => {
    const app = sessionApp({ SESSION_RATE_LIMIT: '2' });
    await request(app).get('/api/tests').set('x-test-user', '1').expect(200);
    await request(app).get('/api/tests').set('x-test-user', '1').expect(200);
    const res = await request(app).get('/api/tests').set('x-test-user', '1').expect(429);
    expect(res.body.error).toMatch(/Too many requests/);
    expect(res.headers['retry-after']).toBeDefined();
    await request(app).get('/api/tests').set('x-test-user', '2').expect(200);
  });

  it('leaves API keys, anonymous calls and the client assets to their own limits', async () => {
    const app = sessionApp({ SESSION_RATE_LIMIT: '1' });
    for (let i = 0; i < 3; i++) {
      await request(app)
        .get('/api/tests')
        .set('x-test-user', '7')
        .set('x-test-key', 'k')
        .expect(200);
      await request(app).get('/api/tests').expect(200);
      await request(app).get('/assets/app.js').set('x-test-user', '8').expect(200);
    }
  });

  it('is off at 0 and defaults to 1200 a minute', async () => {
    const app = sessionApp({ SESSION_RATE_LIMIT: '0' });
    for (let i = 0; i < 3; i++)
      await request(app).get('/api/tests').set('x-test-user', '1').expect(200);
    const res = await request(sessionApp({})).get('/api/tests').set('x-test-user', '3');
    expect(res.headers['ratelimit-policy']).toMatch(/^1200;/);
    expect(() => sessionRateLimit({ SESSION_RATE_LIMIT: '-1' })).toThrow(/whole numbers/);
  });
});
