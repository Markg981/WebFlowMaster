import { describe, expect, it } from 'vitest';
import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { asyncHandler } from './async-handler';

const caught: ErrorRequestHandler = (err, _req, res, _next) => {
  res.status(500).json({ caught: (err as Error).message });
};

describe('asyncHandler', () => {
  it('hands a rejected handler to the error middleware instead of leaving the request open', async () => {
    const app = express();
    app.get(
      '/boom',
      asyncHandler(async () => {
        throw new Error('database is down');
      }),
    );
    app.use(caught);

    const response = await request(app).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ caught: 'database is down' });
  });

  it('hands a synchronous throw over the same way', async () => {
    const app = express();
    app.get(
      '/boom',
      asyncHandler(() => {
        throw new Error('sync');
      }),
    );
    app.use(caught);

    expect((await request(app).get('/boom')).body).toEqual({ caught: 'sync' });
  });

  it('leaves an answered request alone', async () => {
    const app = express();
    app.get(
      '/ok',
      asyncHandler(async (_req, res) => {
        res.status(201).json({ ok: true });
      }),
    );
    app.use(caught);

    const response = await request(app).get('/ok');

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });
  });
});
