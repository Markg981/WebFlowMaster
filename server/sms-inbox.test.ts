import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Application } from 'express';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { auditLog, smsMessages, users, type User } from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { runWithTenant, tenancyMiddleware } from './middleware/tenancy';
import { normalizePhone, parseSmsQuery, readInbound, receiveSms } from './sms-inbox';
import { executeStep } from './step-executor';

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn(), verbose: vi.fn() },
  updateLogLevel: vi.fn(),
}));

/** The test SMS inbox (server/sms-inbox.ts): the provider posts, a waitForSms step reads. */

describe('reading what providers post', () => {
  it('understands Twilio, Vonage and a plain body, and normalises numbers', () => {
    expect(readInbound({ MessageSid: 'SM1', To: '+39 333 123-4567', From: '+15005550006', Body: 'Your code is 482913' })).toEqual({
      to: '+393331234567', from: '+15005550006', body: 'Your code is 482913', provider: 'twilio',
    });
    expect(readInbound({ msisdn: '447700900000', to: '447700900001', text: 'Code 1234' })).toMatchObject({ to: '+447700900001', from: '447700900000', provider: 'vonage' });
    expect(readInbound({ to: '0039 333 1234567', text: 'x' })).toMatchObject({ to: '+393331234567', provider: 'generic' });
    expect(readInbound({ text: 'no number' })).toBeNull();
    expect(normalizePhone('(+1) 500-555')).toBe('+1500555');
    expect(parseSmsQuery('+39 333 1234567|codice (\\d{6})')).toMatchObject({ number: '+393331234567', pattern: /codice (\d{6})/i });
    expect(parseSmsQuery('abc')).toEqual({ error: expect.stringContaining('not a phone number') });
  });
});

describe('the inbox', () => {
  let app: Application;
  let user: User;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    const routes = await import('./routes/sms-inbox.routes');
    app.use(routes.SMS_INBOUND_PATH, routes.smsInboundRouter);
    app.use((req, _res, next) => {
      req.user = user;
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    });
    app.use(tenancyMiddleware);
    app.use(routes.default);
  });

  beforeEach(async () => {
    await privilegedDb.delete(smsMessages);
    await privilegedDb.delete(auditLog);
  });

  async function owner(name: string) {
    const organizationId = await createTestOrganization(name);
    [user] = await privilegedDb.insert(users).values({ username: `${name}-${Math.random()}`, password: 'x.y', organizationId, role: 'owner' }).returning();
    return organizationId;
  }

  it('files a provider’s message into the organization whose address it is, and nowhere else', async () => {
    const acme = await owner('Acme');
    const issued = await request(app).post('/api/organization/sms-inbox/token').expect(201);
    const inbound = new URL(issued.body.inboundUrl).pathname;
    expect(inbound).toMatch(/^\/api\/sms\/inbound\/wfm_sms_/);

    const twilio = await request(app).post(inbound).type('form').send({ MessageSid: 'SM1', To: '+393331234567', From: '+15005550006', Body: 'Il tuo codice è 482913' }).expect(200);
    expect(twilio.text).toBe('<Response/>');
    await request(app).post('/api/sms/inbound/wfm_sms_wrong').type('form').send({ To: '+1', Body: 'x' }).expect(404);
    await request(app).post(inbound).send({ text: 'no number' }).expect(400);

    const listed = await request(app).get('/api/organization/sms-inbox').expect(200);
    expect(listed.body).toMatchObject({ prefix: expect.stringMatching(/^wfm_sms_/), messages: [{ toNumber: '+393331234567', body: 'Il tuo codice è 482913', provider: 'twilio' }] });
    expect(listed.body.inboundUrl).not.toContain(new URL(issued.body.inboundUrl).pathname.split('/').pop());

    // Another organization sees none of it.
    await owner('Beta');
    expect((await request(app).get('/api/organization/sms-inbox').expect(200)).body.messages).toEqual([]);
    const audit = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, acme));
    expect(audit.map((a) => a.action)).toEqual(['sms_inbox.token_issued']);

    // Revoked: the provider is refused.
    user = (await privilegedDb.select().from(users).where(eq(users.organizationId, acme)))[0];
    await request(app).delete('/api/organization/sms-inbox/token').expect(204);
    await request(app).post(inbound).type('form').send({ To: '+1', Body: 'x' }).expect(404);
  });

  it('lets a step wait for the code sent to its number after the test began', async () => {
    const organizationId = await owner('Waiting');
    const res = await request(app).post('/api/organization/sms-inbox/token').expect(201);
    const token = new URL(res.body.inboundUrl).pathname.split('/').pop()!;
    const startedAt = Date.now();
    // An old message for the same number is not this test's.
    await runWithTenant(organizationId, async () => {
      await privilegedDb.insert(smsMessages).values({ organizationId, toNumber: '+393331112222', body: 'old 111111', receivedAt: new Date(startedAt - 600_000) });
    });
    setTimeout(() => void receiveSms(token, { to: '+393331112222', from: 'Bank', body: 'Codice di accesso 654321. Non condividerlo.', provider: 'generic' }), 300);
    const vars: Record<string, string> = { 'sms.timeout': '5' };
    const outcome = await runWithTenant(organizationId, () =>
      executeStep({ page: {} as any, vars, startedAt }, { action: { id: 'waitForSms', name: 'sms' }, value: '+39 333 111 2222' }),
    );
    expect(outcome).toMatchObject({ status: 'passed', detail: 'Text from Bank: {{sms.otp}} = "654321".' });
    expect(vars).toMatchObject({ 'sms.otp': '654321', 'sms.from': 'Bank' });

    const none = await runWithTenant(organizationId, () =>
      executeStep({ page: {} as any, vars: { 'sms.timeout': '1' }, startedAt: Date.now() }, { action: { id: 'waitForSms', name: 'sms' }, value: '+39 000 000 0000' }),
    );
    expect(none).toMatchObject({ status: 'failed', error: expect.stringContaining('No text message to +390000000000 arrived within 1s') });
  });
});
