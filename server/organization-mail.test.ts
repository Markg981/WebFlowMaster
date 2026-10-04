import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { privilegedDb } from './db';
import { mailSettings } from '@shared/mail-settings';
import { createTestOrganization } from './tests/factories';
import { createTestUser } from './tests/factories';
import { testPlans } from '@shared/schema';
import { mailTemplates } from '@shared/mail-templates';
import { runWithTenant } from './middleware/tenancy';
import { mailRunFinished } from './run-mail';
import { mailerDeps, sendMail } from './mailer';
import { queueMail, receiveDeliveryEvent } from './mail-delivery';
let org: number; let foreign: number;
beforeAll(async () => { org = await createTestOrganization(); foreign = await createTestOrganization(); });
afterEach(() => { mailerDeps.transport = undefined; });
describe('organization email sending and callbacks', () => {
  it('uses the run owner organization and its template even under an unrelated ambient tenant', async () => {
    const id = randomUUID(); const user = await createTestUser(foreign);
    await privilegedDb.insert(testPlans).values({ id, name: 'Tenant B plan', userId: user, organizationId: foreign });
    await privilegedDb.insert(mailSettings).values({ organizationId: foreign, smtpMode: 'custom', provider: 'none', smtpHost: 'smtp.example.com', fromAddress: 'tenant-b@example.com' });
    await privilegedDb.insert(mailTemplates).values({ organizationId: foreign, purpose: 'run_finished', subject: 'Tenant B run: {{planName}}', html: '<p>{{summary}}</p>', text: '{{summary}}' });
    const send = vi.fn(async (message: any) => ({ accepted: [message.to] })); mailerDeps.transport = { sendMail: send } as any;
    const result = await runWithTenant(org, () => mailRunFinished({ failed: true, emails: ['qa@example.com'] }, null, { planId: id, executionId: randomUUID(), planName: 'Tenant B plan', status: 'failed', totalTests: 1, passedTests: 0, failedTests: 1, skippedTests: 0, durationMs: 100, triggeredBy: 'manual' }));
    expect(result).toMatchObject([{ sent: true }]);
    expect(send.mock.calls[0][0]).toMatchObject({ from: 'tenant-b@example.com', subject: 'Tenant B run: Tenant B plan' });
  });
  it('respects disabled tenant SMTP despite an enabled installation and transport', async () => {
    await privilegedDb.insert(mailSettings).values({ organizationId: org, smtpMode: 'disabled', provider: 'none' });
    const send = vi.fn(async (message: any) => ({ accepted: [message.to] }));
    mailerDeps.transport = { sendMail: send } as any;
    const result = await sendMail({ organizationId: org, to: 'recipient@example.com', subject: 'Hello', text: 'Hello' });
    expect(result.sent).toBe(false); expect(send).not.toHaveBeenCalled();
    expect((await sendMail({ organizationId: foreign, to: 'recipient@example.com', subject: 'Hi', text: 'Hi' })).sent).toBe(true);
  });
  it('does not accept authenticated foreign-tenant or mismatching recipient callbacks', async () => {
    const delivery = await queueMail(org, 'recipient@example.com', 'other');
    const event = { eventId: randomUUID(), messageId: delivery.id, status: 'hard_bounce' as const };
    expect(await receiveDeliveryEvent(event, foreign)).toBeNull();
    expect(await receiveDeliveryEvent(event, org, 'other@example.com')).toBeNull();
    expect(await receiveDeliveryEvent(event, org, 'RECIPIENT@example.com')).toMatchObject({ received: true, duplicate: false });
  });
});
