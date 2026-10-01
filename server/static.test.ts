import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { apiNotFound } from './static';

describe('apiNotFound', () => {
  // The same order as server/index.ts: routes, then the /api 404, then the client's catch-all.
  const app = express();
  app.get('/api/user', (_req, res) => res.json({ ok: true }));
  app.use('/api', apiNotFound);
  app.use('*', (_req, res) => res.type('html').send('<!DOCTYPE html><html></html>'));

  it('answers an /api path no route handles with a JSON 404, not the client (collaudo SEC-17)', async () => {
    const res = await request(app).post('/api/reports/generate').send({});
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ error: 'No such endpoint.' });
  });

  it('leaves real routes and client routes alone', async () => {
    expect((await request(app).get('/api/user')).body).toEqual({ ok: true });
    const page = await request(app).get('/test-plans');
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/<!DOCTYPE html>/);
  });

  it('does not take paths that only begin with the letters api', async () => {
    expect((await request(app).get('/apidocs')).status).toBe(200);
  });
});
