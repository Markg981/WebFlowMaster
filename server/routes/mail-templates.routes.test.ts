import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import router from './mail-templates.routes';
import { runWithTenant } from '../middleware/tenancy';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { builtInTemplates } from '../mail-templates';
import { privilegedDb } from '../db';
import { auditLog } from '@shared/schema';
import { eq } from 'drizzle-orm';

let owner: any; let foreign: any; let current: any; let app: express.Express;
beforeAll(async () => {
  const org = await createTestOrganization(); const other = await createTestOrganization();
  owner = { id: await createTestUser(org), organizationId: org, role: 'owner', username: 'owner@example.test' };
  foreign = { id: await createTestUser(other), organizationId: other, role: 'owner', username: 'foreign@example.test' };
  current = owner; app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = current; req.isAuthenticated = (() => !!current) as any; if (!current) return next(); runWithTenant(current.organizationId, next, { userId: current.id, role: current.role }); });
  app.use(router);
});
describe('owner mail templates', () => {
  it('requires owner authorization and ignores tenant and preview variables supplied by callers', async () => {
    current = null; await request(app).get('/api/mail-templates').expect(401);
    current = { ...owner, role: 'editor' }; await request(app).get('/api/mail-templates').expect(403);
    current = owner;
    const preview = await request(app).post('/api/mail-templates/password_reset/preview').send({ ...builtInTemplates.password_reset, version: 0 }).expect(200);
    expect(preview.body.html).toContain('synthetic-preview'); expect(preview.body.text).toContain('alex@example.test');
    expect(preview.body.html).not.toMatch(/\bhref=/);
    await request(app).post('/api/mail-templates/password_reset/preview').send({ ...builtInTemplates.password_reset, version: 0, variables: { actionUrl: 'https://evil.test/live' } }).expect(400);
  });
  it('saves sanitized source, detects stale edits/resets and isolates organizations', async () => {
    current = owner;
    const saved = await request(app).put('/api/mail-templates/password_reset').send({ ...builtInTemplates.password_reset, html: '<script>secret</script>' + builtInTemplates.password_reset.html, version: 0 }).expect(200);
    expect(saved.body).toMatchObject({ version: 1, custom: true }); expect(saved.body.html).not.toContain('<script');
    await request(app).put('/api/mail-templates/password_reset').send({ ...builtInTemplates.password_reset, version: 0 }).expect(409);
    current = foreign; const list = await request(app).get('/api/mail-templates').expect(200);
    expect(list.body.templates.every((t: any) => !t.custom && t.version === 0)).toBe(true);
    current = owner;
    await request(app).delete('/api/mail-templates/password_reset').send({ version: 0 }).expect(409);
    await request(app).delete('/api/mail-templates/password_reset').send({ version: 1 }).expect(200);
    const reset = await request(app).get('/api/mail-templates').expect(200);
    expect(reset.body.templates.find((t: any) => t.purpose === 'password_reset')).toMatchObject({ version: 2, custom: false });
    await request(app).put('/api/mail-templates/password_reset').send({ ...builtInTemplates.password_reset, version: 2 }).expect(200);
    await request(app).put('/api/mail-templates/password_reset').send({ ...builtInTemplates.password_reset, version: 1 }).expect(409);
    const audits = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, owner.organizationId));
    expect(audits).toHaveLength(3); expect(JSON.stringify(audits)).not.toMatch(/<script|synthetic-preview|Choose a new/);
  });
  it('rejects unsafe/oversized source and invalid purposes without persistence', async () => {
    current = owner;
    await request(app).put('/api/mail-templates/other').send({ ...builtInTemplates.password_reset, version: 0 }).expect(400);
    await request(app).put('/api/mail-templates/password_reset').send({ ...builtInTemplates.password_reset, subject: 'bad\nheader', version: 0 }).expect(400);
    await request(app).put('/api/mail-templates/password_reset').send({ ...builtInTemplates.password_reset, text: 'missing link', version: 0 }).expect(400);
  });
});
