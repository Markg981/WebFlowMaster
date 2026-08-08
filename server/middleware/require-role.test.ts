import { describe, it, expect } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { requireRole, type Role } from './require-role';

const appAs = (role: Role | undefined, minimum: Role) => {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = role ? { id: 1, role } : undefined;
    req.isAuthenticated = (() => Boolean(role)) as never;
    next();
  });
  app.post('/thing', requireRole(minimum), (_req, res) => res.json({ ok: true }));
  return app;
};

describe('requireRole', () => {
  it('allows a role above the minimum', async () => {
    const res = await request(appAs('owner', 'editor')).post('/thing');
    expect(res.status).toBe(200);
  });

  it('allows a role equal to the minimum', async () => {
    const res = await request(appAs('editor', 'editor')).post('/thing');
    expect(res.status).toBe(200);
  });

  it('refuses a role below the minimum', async () => {
    const res = await request(appAs('viewer', 'editor')).post('/thing');
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated request with 401, not 403', async () => {
    const res = await request(appAs(undefined, 'viewer')).post('/thing');
    expect(res.status).toBe(401);
  });

  /**
   * A role string that is not one of the three known values must fail closed. A row edited
   * by hand, or a future role added to the database before the code knows about it, must not
   * be treated as sufficient.
   */
  it('refuses an unrecognised role rather than assuming it is sufficient', async () => {
    const res = await request(appAs('superadmin' as Role, 'viewer')).post('/thing');
    expect(res.status).toBe(403);
  });
});
