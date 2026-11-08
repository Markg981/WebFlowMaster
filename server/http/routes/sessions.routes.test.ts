import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

const recordAuthEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../identity/auth', () => ({ recordAuthEvent }));
vi.mock('../middleware/require-role', () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { default: sessionsRoutes } = await import('./sessions.routes');
const { trackSession, anonymiseIp } = await import('../../identity/session-registry');

/**
 * A member's own sessions. Sign-in is faked by a header naming the user; the store is a real
 * express-session store shared by all "browsers".
 */
const store = new session.MemoryStore();
let nextUserId = 100;

function app() {
  const a = express();
  a.use(session({ secret: 'x', resave: false, saveUninitialized: false, store, name: 'sid' }));
  a.use((req, _res, next) => {
    const id = Number(req.get('x-user'));
    if (id) {
      (req as any).user = { id, username: `u${id}`, organizationId: 1 };
      (req.session as any).passport = { user: { id } };
    }
    next();
  });
  a.use(trackSession);
  a.use(sessionsRoutes);
  return a;
}

async function signIn(userId: number) {
  const agent = request.agent(app());
  await agent
    .get('/api/me/sessions')
    .set('x-user', String(userId))
    .set('User-Agent', 'UA-' + userId);
  return agent;
}

beforeEach(() => {
  nextUserId += 10;
  recordAuthEvent.mockClear();
});

describe('GET/DELETE /api/me/sessions', () => {
  it('lists only the caller own sessions and flags the current one', async () => {
    const me = nextUserId;
    const a = await signIn(me);
    await signIn(me);
    await signIn(me + 1);
    const res = await a.get('/api/me/sessions').set('x-user', String(me));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.filter((s: any) => s.current)).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('UA-' + (me + 1));
    expect(res.body[0]).not.toHaveProperty('sid');
  });

  it("answers 404 when revoking another user's session", async () => {
    const me = nextUserId;
    const a = await signIn(me);
    const other = await signIn(me + 1);
    const theirs = (await other.get('/api/me/sessions').set('x-user', String(me + 1))).body[0].id;
    const res = await a.delete(`/api/me/sessions/${theirs}`).set('x-user', String(me));
    expect(res.status).toBe(404);
    const still = await other.get('/api/me/sessions').set('x-user', String(me + 1));
    expect(still.body).toHaveLength(1);
  });

  it('revokes one other session, never the current one, and audits it', async () => {
    const me = nextUserId;
    const a = await signIn(me);
    const b = await signIn(me);
    const list = (await a.get('/api/me/sessions').set('x-user', String(me))).body;
    const current = list.find((s: any) => s.current).id;
    const otherId = list.find((s: any) => !s.current).id;
    expect((await a.delete(`/api/me/sessions/${current}`).set('x-user', String(me))).status).toBe(
      404,
    );
    expect((await a.delete(`/api/me/sessions/${otherId}`).set('x-user', String(me))).status).toBe(
      204,
    );
    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
    const after = await a.get('/api/me/sessions').set('x-user', String(me));
    expect(after.body).toHaveLength(1);
    void b;
  });

  it('revoke-all keeps the current session', async () => {
    const me = nextUserId;
    const a = await signIn(me);
    await signIn(me);
    await signIn(me);
    const res = await a.delete('/api/me/sessions').set('x-user', String(me));
    expect(res.body).toEqual({ revoked: 2 });
    const after = await a.get('/api/me/sessions').set('x-user', String(me));
    expect(after.body).toHaveLength(1);
    expect(after.body[0].current).toBe(true);
  });
});

describe('anonymiseIp', () => {
  it('truncates IPv4 and IPv6', () => {
    expect(anonymiseIp('203.0.113.77')).toBe('203.0.113.0');
    expect(anonymiseIp('::ffff:10.1.2.3')).toBe('10.1.2.0');
    expect(anonymiseIp('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::');
  });
});
