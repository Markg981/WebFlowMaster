import { describe, expect, it } from 'vitest';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import request from 'supertest';
import { asyncRouter } from './async-router';

const caught: ErrorRequestHandler = (err, _req, res, _next) => {
  res.status(500).json({ caught: (err as Error).message });
};

function appWith(router: ReturnType<typeof asyncRouter>) {
  const app = express();
  app.use(router);
  app.use(caught);
  return app;
}

describe('asyncRouter', () => {
  it('hands a rejected route handler to the error middleware', async () => {
    const router = asyncRouter();
    router.get('/boom', async () => {
      throw new Error('database is down');
    });

    const response = await request(appWith(router)).get('/boom').timeout(2000);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ caught: 'database is down' });
  });

  it('wraps every handler of the chain, middleware included', async () => {
    const router = asyncRouter();
    const failingGuard: RequestHandler = async () => {
      throw new Error('guard failed');
    };
    router.post('/guarded', failingGuard, (_req, res) => {
      res.json({ reached: true });
    });

    expect((await request(appWith(router)).post('/guarded').timeout(2000)).body).toEqual({
      caught: 'guard failed',
    });
  });

  it('wraps handlers passed as an array', async () => {
    const router = asyncRouter();
    router.delete('/x', [
      async () => {
        throw new Error('from an array');
      },
    ]);

    expect((await request(appWith(router)).delete('/x').timeout(2000)).body).toEqual({
      caught: 'from an array',
    });
  });

  it('lets middleware pass to the next handler and the response through', async () => {
    const router = asyncRouter();
    router.put(
      '/ok',
      (_req, res, next) => {
        res.locals.seen = true;
        next();
      },
      async (_req, res) => {
        res.status(201).json({ seen: res.locals.seen });
      },
    );

    const response = await request(appWith(router)).put('/ok');

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ seen: true });
  });

  it('leaves a route-level error handler as an error handler', async () => {
    const router = asyncRouter();
    router.get(
      '/handled',
      () => {
        throw new Error('first');
      },
      ((err, _req, res, _next) => {
        res.status(418).json({ handled: (err as Error).message });
      }) as ErrorRequestHandler,
    );

    const response = await request(appWith(router)).get('/handled');

    expect(response.status).toBe(418);
    expect(response.body).toEqual({ handled: 'first' });
  });
});
