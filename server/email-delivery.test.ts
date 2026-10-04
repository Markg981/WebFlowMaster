import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { auditLog, invitations, organizations, passwordResets, userSettings, users } from '@shared/schema';
import { passwordProblem } from '@shared/password-policy';
import { mailerDeps, sendMail } from './mailer';
import { mailRunFinished, personWantsMail } from './run-mail';
import type { RunSummary } from './notifications';
import { mailSettings } from '@shared/mail-settings';
import { issuePasswordReset } from './password-reset';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';

vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * E-mail delivery (server/mailer.ts): invitations and reset links mailed, "Forgot your password?",
 * run notifications to the plan's addresses and to the person who started the run — and the
 * password policy (shared/password-policy.ts).
 */

let sent: Array<{ to: string; subject: string; text: string }> = [];
const transport = {
  sendMail: vi.fn(async (message: any) => {
    if (String(message.to).startsWith('bounce')) throw new Error('550 mailbox unavailable for smtp://wfm:hunter2@mail');
    sent.push({ to: message.to, subject: message.subject, text: message.text });
    return { accepted: [message.to], rejected: [] };
  }),
};

let app: Express;

beforeAll(async () => {
  const { setupAuth } = await import('./auth');
  app = express();
  app.use(express.json());
  setupAuth(app);
});

beforeEach(async () => {
  sent = [];
  mailerDeps.transport = transport as any;
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(passwordResets);
  await privilegedDb.delete(invitations);
  await privilegedDb.delete(userSettings);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});
afterEach(() => {
  mailerDeps.transport = undefined;
  delete process.env.PASSWORD_POLICY;
});

describe('password policy', () => {
  it('basic: length and not the username', () => {
    expect(passwordProblem('short', 'ann', 'basic')).toMatch(/at least 8/);
    expect(passwordProblem('ann@shop.test', 'ann@shop.test', 'basic')).toMatch(/not be the username/);
    expect(passwordProblem('password123', 'ann', 'basic')).toBeNull();
  });

  it('strong: 12 characters, three kinds, no username, nothing common', () => {
    expect(passwordProblem('Short1!', 'ann', 'strong')).toMatch(/at least 12/);
    expect(passwordProblem('alllowercaseletters', 'ann', 'strong')).toMatch(/three of/);
    expect(passwordProblem('Annabel-2026-x', 'annabel@shop.test', 'strong')).toMatch(/contain the username/);
    expect(passwordProblem('Password1234!', 'ann', 'strong')).toMatch(/too common/);
    expect(passwordProblem('Blue-Kettle-2026', 'ann@shop.test', 'strong')).toBeNull();
  });

  it('is applied when registering and when choosing a new password, under PASSWORD_POLICY', async () => {
    process.env.PASSWORD_POLICY = 'strong';
    const refused = await request(app).post('/api/register').send({ username: 'ann@shop.test', password: 'password123' }).expect(400);
    expect(refused.body.message).toMatch(/at least 12/);
    await request(app).post('/api/register').send({ username: 'ann@shop.test', password: 'Blue-Kettle-2026' }).expect(201);
  });
});

describe('sendMail', () => {
  it('does not report SMTP rejection as sent when sendMail resolves', async () => {
    mailerDeps.transport = { sendMail: async () => ({ accepted: [], rejected: ['ann@shop.test'] }) } as any;
    const result = await sendMail({ to: 'ann@shop.test', subject: 'Subject', text: 'Body' });
    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/rejected|refused/i);
  });
  it('says why nothing was sent, and keeps the SMTP credentials out of the answer', async () => {
    mailerDeps.transport = null;
    expect(await sendMail({ to: 'ann@shop.test', subject: 's', text: 't' })).toEqual({ sent: false, error: expect.stringMatching(/not configured/) });
    mailerDeps.transport = transport as any;
    expect((await sendMail({ to: 'not an address', subject: 's', text: 't' })).error).toMatch(/not an e-mail address/);
    const env = { SMTP_URL: 'smtp://wfm:hunter2@mail', SMTP_FROM: 'WFM <qa@shop.test>' } as NodeJS.ProcessEnv;
    const bounced = await sendMail({ to: 'bounce@shop.test', subject: 's', text: 't' }, env);
    expect(bounced.sent).toBe(false);
    expect(bounced.error).toContain('550');
    expect(bounced.error).not.toContain('hunter2');
  });
});

describe('Forgot your password?', () => {
  it('keeps an owner handoff link usable when the target organization disables sending', async () => {
    await request(app).post('/api/register').send({ username: 'handoff@shop.test', password: 'first-password' }).expect(201);
    const [user] = await privilegedDb.select().from(users).where(eq(users.username, 'handoff@shop.test'));
    await privilegedDb.insert(mailSettings).values({ organizationId: user.organizationId!, smtpMode: 'disabled' });
    const issued = await runWithTenant(user.organizationId!, () => withTenantTransaction(tx => issuePasswordReset(tx, { organizationId: user.organizationId!, userId: user.id, createdBy: user.id })));
    const known = await request(app).post('/api/password-reset/request').send({ username: user.username }).expect(202);
    const unknown = await request(app).post('/api/password-reset/request').send({ username: 'unknown-handoff@shop.test' }).expect(202);
    expect(known.body).toEqual(unknown.body); expect(sent).toHaveLength(0);
    await request(app).post('/api/password-reset').send({ token: issued.token, newPassword: 'second-password' }).expect(200);
  });
  it('is offered only with mail, mails a working link to an account, and answers the same for anyone', async () => {
    mailerDeps.transport = null;
    expect((await request(app).get('/api/password-reset/available').expect(200)).body).toEqual({ available: false });
    await request(app).post('/api/password-reset/request').send({ username: 'ann@shop.test' }).expect(404);

    mailerDeps.transport = transport as any;
    expect((await request(app).get('/api/password-reset/available').expect(200)).body).toEqual({ available: true });
    await request(app).post('/api/register').send({ username: 'ann@shop.test', password: 'first-password' }).expect(201);

    const known = await request(app).post('/api/password-reset/request').send({ username: 'ann@shop.test' }).expect(202);
    const unknown = await request(app).post('/api/password-reset/request').send({ username: 'nobody@shop.test' }).expect(202);
    expect(unknown.body).toEqual(known.body);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ann@shop.test');

    const token = new URL(/https?:\/\/\S+/.exec(sent[0].text)![0]).searchParams.get('reset')!;
    await request(app).post('/api/password-reset').send({ token, newPassword: 'second-password' }).expect(200);
    await request(app).post('/api/login').send({ username: 'ann@shop.test', password: 'second-password' }).expect(200);

    const [entry] = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'auth.password_reset_issued'));
    expect(entry.metadata).toMatchObject({ requestedByEmail: true });
    expect(JSON.stringify(entry.metadata)).not.toContain(token);
  });
});

describe('run notifications by e-mail', () => {
  const summary = (status: string): RunSummary => ({
    planId: 'p1', planName: 'Nightly', executionId: 'run-1', status, totalTests: 3, passedTests: status === 'completed' ? 3 : 2,
    failedTests: status === 'completed' ? 0 : 1, skippedTests: 0, durationMs: 4200, triggeredBy: 'manual',
  });

  it("follows the person's switches", () => {
    const on = { notifyByEmail: true, notifyRunCompleted: false, notifyRunFailed: true };
    expect(personWantsMail(on, 'failed')).toBe(true);
    expect(personWantsMail(on, 'completed')).toBe(false);
    expect(personWantsMail({ ...on, notifyRunCompleted: true }, 'completed')).toBe(true);
    expect(personWantsMail({ ...on, notifyByEmail: false }, 'failed')).toBe(false);
    expect(personWantsMail(undefined, 'failed')).toBe(false);
  });

  it("mails the plan's addresses when its switches say so, and the person who started the run", async () => {
    await request(app).post('/api/register').send({ username: 'ann@shop.test', password: 'first-password' }).expect(201);
    const [ann] = await privilegedDb.select().from(users).where(eq(users.username, 'ann@shop.test'));
    await privilegedDb.insert(userSettings).values({ userId: ann.id, notifyByEmail: true, notifyRunCompleted: false, notifyRunFailed: true } as any);
    const plan = { failed: true, passed: false, emails: ['qa@shop.test', 'not an address', 'bounce@shop.test'] };

    const failed = await mailRunFinished(plan, ann.id, summary('failed'));
    expect(failed.map((o) => [o.to, o.sent])).toEqual([['qa@shop.test', true], ['bounce@shop.test', false], ['ann@shop.test', true]]);
    expect(sent[0].subject).toBe('[WebFlowMaster] Nightly: failed');
    expect(sent[0].text).toContain('2/3 passed, 1 failed');

    sent = [];
    // A passing run: the plan says no, and so does Ann.
    expect(await mailRunFinished(plan, ann.id, summary('completed'))).toEqual([]);

    mailerDeps.transport = null;
    expect(await mailRunFinished(plan, ann.id, summary('failed'))).toEqual([]);
  });
});
