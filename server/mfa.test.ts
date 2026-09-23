import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { eq } from 'drizzle-orm';

/**
 * The second factor, end to end: the algorithm against the RFC's own vectors, then enrolment,
 * the two-step sign-in, and the organization's policy, through real sessions.
 *
 * What these hold: a password alone signs nobody in once MFA is on; a code works once; a
 * recovery code works once; five wrong codes end the attempt; the secret is never stored or
 * returned in the clear after enrolment; and a policy requiring MFA confines a member without
 * it to setting it up, while keys are unaffected.
 */

vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

const { privilegedDb } = await import('./db');
const { auditLog, invitations, organizations, userMfa, users } = await import('@shared/schema');
const { base32Decode, base32Encode, currentStep, matchingStep, totpAt } = await import('./mfa');

let app: Express;

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  const { setupAuth } = await import('./auth');
  const { tenancyMiddleware } = await import('./middleware/tenancy');
  const { requireMfaEnrollment } = await import('./middleware/require-mfa-enrollment');
  const { default: mfaRoutes } = await import('./routes/mfa.routes');
  app = express();
  app.use(express.json());
  setupAuth(app);
  // What an API key leaves on a request, for the one test that needs it.
  app.use((req, _res, next) => {
    if (req.get('x-test-api-key')) (req as any).apiKeyId = 'key-1';
    next();
  });
  app.use(tenancyMiddleware);
  app.use(requireMfaEnrollment);
  app.use(mfaRoutes);
  // Stands in for every other endpoint of the application.
  app.get('/api/tests', (_req, res) => res.json([]));
});

beforeEach(async () => {
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(invitations);
  await privilegedDb.delete(userMfa);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});

const alice = { username: 'alice', password: 'password123' };

async function signedIn(credentials = alice) {
  const agent = request.agent(app);
  await agent.post('/api/register').send(credentials).expect(201);
  return agent;
}

/** Turns MFA on for the signed-in agent; answers the secret, the recovery codes and the step spent. */
async function enrol(agent: ReturnType<typeof request.agent>) {
  const enrollment = await agent.post('/api/mfa/enrollment').expect(201);
  const step = currentStep();
  const confirmed = await agent
    .post('/api/mfa/enrollment/confirm')
    .send({ code: totpAt(enrollment.body.secret, step) })
    .expect(200);
  return { secret: enrollment.body.secret as string, recoveryCodes: confirmed.body.recoveryCodes as string[], step };
}

describe('TOTP', () => {
  // RFC 6238, appendix B, SHA-1, truncated to six digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('produces the RFC test vectors', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpAt(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpAt(secret, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpAt(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts one step of drift either way, and no more', () => {
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    expect(matchingStep(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(matchingStep(secret, totpAt(secret, step + 1), now)).toBe(step + 1);
    expect(matchingStep(secret, totpAt(secret, step + 2), now)).toBeNull();
    expect(matchingStep(secret, 'abcdef', now)).toBeNull();
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });
});

describe('enrolling', () => {
  it('needs a code from the new secret, then answers ten recovery codes once and keeps the secret encrypted', async () => {
    const agent = await signedIn();
    const enrollment = await agent.post('/api/mfa/enrollment').expect(201);
    expect(enrollment.body.otpauthUri).toContain(`secret=${enrollment.body.secret}`);
    expect(enrollment.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    await agent.post('/api/mfa/enrollment/confirm').send({ code: '000000' }).expect(400);
    const confirmed = await agent
      .post('/api/mfa/enrollment/confirm')
      .send({ code: totpAt(enrollment.body.secret, currentStep()) })
      .expect(200);

    expect(confirmed.body.recoveryCodes).toHaveLength(10);
    const me = await agent.get('/api/user').expect(200);
    expect(me.body).toMatchObject({ mfaEnabled: true, mfaEnrollmentRequired: false });
    expect(JSON.stringify(me.body)).not.toContain(enrollment.body.secret);

    const [row] = await privilegedDb.select().from(userMfa);
    expect(JSON.stringify(row)).not.toContain(enrollment.body.secret);
    expect(JSON.stringify(row)).not.toContain(confirmed.body.recoveryCodes[0]);

    // Moving it to another phone means turning it off first.
    await agent.post('/api/mfa/enrollment').expect(409);
  });

  it('cannot be done with an API key', async () => {
    const agent = await signedIn();
    await agent.post('/api/mfa/enrollment').set('x-test-api-key', '1').expect(403);
  });
});

describe('signing in with a second factor', () => {
  it('signs nobody in on the password alone, and signs in on a fresh code', async () => {
    const setup = await signedIn();
    const { secret, step } = await enrol(setup);

    const agent = request.agent(app);
    const first = await agent.post('/api/login').send(alice).expect(200);
    expect(first.body).toEqual({ mfaRequired: true });
    await agent.get('/api/user').expect(401);

    // The code that confirmed enrolment is spent.
    await agent.post('/api/login/mfa').send({ code: totpAt(secret, step) }).expect(401);
    const signedInNow = await agent.post('/api/login/mfa').send({ code: totpAt(secret, step + 1) }).expect(200);
    expect(signedInNow.body.username).toBe('alice');
    await agent.get('/api/user').expect(200);

    // And so is that one, on any later attempt.
    const again = request.agent(app);
    await again.post('/api/login').send(alice).expect(200);
    await again.post('/api/login/mfa').send({ code: totpAt(secret, step + 1) }).expect(401);

    const [success] = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'auth.login'));
    expect(success.metadata).toEqual({ mfa: 'totp' });
  });

  it('accepts a recovery code once, and says so in the trail', async () => {
    const setup = await signedIn();
    const { recoveryCodes } = await enrol(setup);

    const agent = request.agent(app);
    await agent.post('/api/login').send(alice).expect(200);
    await agent.post('/api/login/mfa').send({ code: recoveryCodes[0].toUpperCase() }).expect(200);

    const again = request.agent(app);
    await again.post('/api/login').send(alice).expect(200);
    await again.post('/api/login/mfa').send({ code: recoveryCodes[0] }).expect(401);

    const [used] = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'mfa.recovery_code_used'));
    expect(used.metadata).toEqual({ recoveryCodesLeft: 9 });
  });

  it('ends the attempt after five wrong codes', async () => {
    const setup = await signedIn();
    const { recoveryCodes } = await enrol(setup);

    const agent = request.agent(app);
    await agent.post('/api/login').send(alice).expect(200);
    for (let i = 0; i < 4; i++) {
      const wrong = await agent.post('/api/login/mfa').send({ code: '000000' }).expect(401);
      expect(wrong.body.code).toBe('mfa_code_invalid');
    }
    const fifth = await agent.post('/api/login/mfa').send({ code: '000000' }).expect(401);
    expect(fifth.body.code).toBe('mfa_challenge_expired');

    // Even a good code does not revive it: the password comes first again.
    await agent.post('/api/login/mfa').send({ code: recoveryCodes[1] }).expect(401);
  });

  it('refuses a code step with no password step before it', async () => {
    await request(app).post('/api/login/mfa').send({ code: '123456' }).expect(401);
  });
});

describe("an organization's policy", () => {
  async function member(organizationId: number) {
    const agent = request.agent(app);
    await agent.post('/api/register').send({ username: 'bob', password: 'password123' }).expect(201);
    await privilegedDb.update(users).set({ organizationId, role: 'editor' }).where(eq(users.username, 'bob'));
    // Sign in again, so the session's user carries the organization.
    await agent.post('/api/logout').expect(200);
    await agent.post('/api/login').send({ username: 'bob', password: 'password123' }).expect(200);
    return agent;
  }

  it('can be set only by an owner who has MFA', async () => {
    const owner = await signedIn();
    await owner.put('/api/organization/mfa-policy').send({ required: true }).expect(409);
    await enrol(owner);
    await owner.put('/api/organization/mfa-policy').send({ required: true }).expect(200);

    const [entry] = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'mfa.policy_changed'));
    expect(entry.metadata).toEqual({ required: true });
  });

  it('confines a member without MFA to setting it up, and lets them go once they have', async () => {
    const owner = await signedIn();
    await enrol(owner);
    await owner.put('/api/organization/mfa-policy').send({ required: true }).expect(200);
    const [aliceRow] = await privilegedDb.select().from(users).where(eq(users.username, 'alice'));

    const bob = await member(aliceRow.organizationId);
    expect((await bob.get('/api/user').expect(200)).body.mfaEnrollmentRequired).toBe(true);
    const blocked = await bob.get('/api/tests').expect(403);
    expect(blocked.body.code).toBe('mfa_enrollment_required');
    // A key is not held back by it.
    await bob.get('/api/tests').set('x-test-api-key', '1').expect(200);

    await enrol(bob);
    await bob.get('/api/tests').expect(200);

    // And while it is required, it cannot be turned off.
    await bob.delete('/api/mfa').send({ password: 'password123', code: '000000' }).expect(409);
  });

  it('lets an owner reset a member who lost their phone', async () => {
    const owner = await signedIn();
    const [aliceRow] = await privilegedDb.select().from(users).where(eq(users.username, 'alice'));
    const bob = await member(aliceRow.organizationId);
    await enrol(bob);
    const [bobRow] = await privilegedDb.select().from(users).where(eq(users.username, 'bob'));

    await owner.delete(`/api/organization/members/${bobRow.id}/mfa`).expect(204);
    expect(await privilegedDb.select().from(userMfa).where(eq(userMfa.userId, bobRow.id))).toHaveLength(0);
    await owner.delete(`/api/organization/members/${aliceRow.id}/mfa`).expect(400);

    const [entry] = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'mfa.disabled'));
    expect(entry).toMatchObject({ actorUserId: aliceRow.id, metadata: { by: 'owner', userId: bobRow.id } });
  });
});

describe('turning it off', () => {
  it('needs the password and a code', async () => {
    const agent = await signedIn();
    const { recoveryCodes } = await enrol(agent);

    await agent.delete('/api/mfa').send({ password: 'wrong-password', code: recoveryCodes[0] }).expect(400);
    await agent.delete('/api/mfa').send({ password: 'password123', code: '000000' }).expect(400);
    await agent.delete('/api/mfa').send({ password: 'password123', code: recoveryCodes[1] }).expect(204);

    expect((await agent.get('/api/user').expect(200)).body.mfaEnabled).toBe(false);
    const signIn = await request.agent(app).post('/api/login').send(alice).expect(200);
    expect(signIn.body.username).toBe('alice');
  });
});
