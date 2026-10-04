import { beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant } from '../middleware/tenancy';
import { privilegedDb } from '../db';
import { mailSettings } from '@shared/mail-settings';
import router from './mail-settings.routes';
import { resolveMailConfiguration } from '../mail-settings';

let app: express.Express;
let owner: any;
let foreign: any;
let current: any;
beforeAll(async () => {
  const org = await createTestOrganization(); const other = await createTestOrganization();
  owner = { id: await createTestUser(org), organizationId: org, role: 'owner', username: 'owner@example.com' };
  foreign = { id: await createTestUser(other), organizationId: other, role: 'owner', username: 'foreign@example.com' };
  current = owner;
  app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    req.user = current; req.isAuthenticated = (() => !!current) as any;
    if (!current) return next();
    runWithTenant(current.organizationId, () => next(), { userId: current.id, role: current.role });
  }); app.use(router);
});
describe('owner mail settings', () => {
  it('keeps legacy inheritance and restricts configuration to owners', async () => {
    expect((await request(app).get('/api/mail-settings').expect(200)).body).toMatchObject({ version: 0, smtpMode: 'inherit', hasSmtpPassword: false });
    current = { ...owner, role: 'viewer' };
    await request(app).get('/api/mail-settings').expect(403);
    await request(app).put('/api/mail-settings').send({}).expect(403);
    current = null; await request(app).get('/api/mail-settings').expect(401); current = owner;
  });
  it('encrypts credentials, retains omitted secrets and rejects concurrent updates', async () => {
    const saved = await request(app).put('/api/mail-settings').send({ version: 0, smtpMode: 'custom', provider: 'mailgun', smtpHost: 'smtp.mailgun.org', smtpPort: 587, smtpUsername: 'postmaster@example.com', smtpPassword: 'smtp-private', smtpSecure: false, fromAddress: 'QA <qa@example.com>', signingSecret: 'webhook-private-key-at-least-32-characters' }).expect(200);
    expect(saved.body).toMatchObject({ version: 1, hasSmtpPassword: true, hasSigningSecret: true, configured: true, trackingConfigured: true });
    expect(JSON.stringify(saved.body)).not.toMatch(/smtp-private|webhook-private/);
    const [row] = await privilegedDb.select().from(mailSettings).where(eq(mailSettings.organizationId, owner.organizationId));
    expect(JSON.stringify(row)).not.toMatch(/smtp-private|webhook-private/);
    const updated = await request(app).put('/api/mail-settings').send({ version: 1, smtpMode: 'custom', provider: 'mailgun', fromAddress: 'new@example.com' }).expect(200);
    expect(updated.body).toMatchObject({ version: 2, hasSmtpPassword: true, hasSigningSecret: true, callbackId: saved.body.callbackId });
    await request(app).put('/api/mail-settings').send({ version: 1, smtpMode: 'disabled', provider: 'none' }).expect(409);
    const resolved = await resolveMailConfiguration(owner.organizationId, {});
    expect(resolved.smtp).toMatchObject({ auth: { user: 'postmaster@example.com', pass: 'smtp-private' }, requireTLS: true });
  });
  it('isolates organizations and rotates callback URLs explicitly', async () => {
    current = foreign; expect((await request(app).get('/api/mail-settings').expect(200)).body.version).toBe(0);
    await request(app).put('/api/mail-settings').send({ version: 0, smtpMode: 'disabled', provider: 'none' }).expect(200);
    expect((await resolveMailConfiguration(foreign.organizationId, { SMTP_URL: 'smtp://installation.test', SMTP_FROM: 'installation@example.com' })).configured).toBe(false);
    current = owner;
    const previous = (await request(app).get('/api/mail-settings').expect(200)).body;
    const rotated = (await request(app).put('/api/mail-settings').send({ version: previous.version, smtpMode: 'custom', provider: 'mailgun', rotateCallback: true }).expect(200)).body;
    expect(rotated.callbackId).not.toBe(previous.callbackId);
    await request(app).put('/api/mail-settings').send({ version: rotated.version, smtpMode: 'custom', provider: 'generic' }).expect(400);
  });
});
