import { beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';

let app: express.Express;
let current: { id: number; organizationId: number; role: string } | undefined;

beforeAll(async () => {
  app = express();
  app.use((req, _res, next) => {
    (req as any).user = current;
    (req as any).isAuthenticated = () => !!current;
    next();
  });
  app.use((await import('./whats-new.routes')).default);
});

describe('GET /api/whats-new', () => {
  it('is for signed-in members only', async () => {
    current = undefined;
    const res = await request(app).get('/api/whats-new');
    expect(res.status).toBe(401);
  });

  it('returns the shipped changelog, newest release first, with a stamp of the newest change', async () => {
    current = { id: 1, organizationId: 1, role: 'viewer' };
    const res = await request(app).get('/api/whats-new');
    expect(res.status).toBe(200);
    expect(res.body.releases.length).toBeGreaterThan(0);
    expect(res.body.releases.length).toBeLessThanOrEqual(5);
    const [latest] = res.body.releases;
    const newest = Math.max(
      ...latest.sections.flatMap((s: any) => s.entries.map((e: any) => e.pr ?? 0)),
    );
    expect(res.body.stamp).toBe(`${latest.version}#${newest}`);
  });
});
