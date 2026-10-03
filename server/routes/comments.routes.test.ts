import { beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { privilegedDb } from '../db';
import { tests, projects, projectMembers, apiTests, mobileTests, testPlans, testPlanExecutions, reportTestCaseResults } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant, withTenantTransaction } from '../middleware/tenancy';

let app: express.Express;
let current: any;
let author: any;
let peer: any;
let foreign: any;
let target: number;
let secret: number;
let api: number;
let mobile: number;
const fixtureId = (name: string) => `${name}-${author.organizationId}`;
beforeAll(async () => {
  const org = await createTestOrganization();
  author = { id: await createTestUser(org), organizationId: org, role: 'viewer' };
  peer = { id: await createTestUser(org), organizationId: org, role: 'viewer' };
  const other = await createTestOrganization();
  foreign = { id: await createTestUser(other), organizationId: other, role: 'owner' };
  const [project] = await privilegedDb.insert(projects).values({ name: 'private', userId: author.id, organizationId: org, restricted: true }).returning();
  const base = { userId: author.id, organizationId: org, name: 'Discuss', url: 'https://example.com', sequence: [], elements: [] };
  [target, secret] = (await privilegedDb.insert(tests).values([base, { ...base, projectId: project.id }]).returning()).map(t => t.id);
  [api] = (await privilegedDb.insert(apiTests).values({ organizationId: org, userId: author.id, name: 'API', method: 'GET', url: 'https://example.com' }).returning()).map(t => t.id);
  [mobile] = (await privilegedDb.insert(mobileTests).values({ organizationId: org, createdBy: author.id, name: 'Mobile', platform: 'android', app: 'app.apk', deviceName: 'Pixel', steps: [] }).returning()).map(t => t.id);
  await privilegedDb.insert(testPlans).values({ id: fixtureId('comment-plan'), organizationId: org, userId: author.id, name: 'Plan' });
  await privilegedDb.insert(testPlanExecutions).values({ id: fixtureId('comment-run'), organizationId: org, testPlanId: fixtureId('comment-plan'), status: 'completed' });
  await privilegedDb.insert(reportTestCaseResults).values([
    { id: fixtureId('visible-result'), organizationId: org, testPlanExecutionId: fixtureId('comment-run'), testType: 'ui', uiTestId: target, testName: 'Public', status: 'Passed', startedAt: new Date() },
    { id: fixtureId('private-result'), organizationId: org, testPlanExecutionId: fixtureId('comment-run'), testType: 'ui', uiTestId: secret, testName: 'Private', status: 'Passed', startedAt: new Date() },
  ]);
  current = author;
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = current;
    req.isAuthenticated = (() => !!current) as any;
    if (!current) return next();
    runWithTenant(current.organizationId, () => next(), { userId: current.id, role: current.role });
  });
  app.use((await import('./comments.routes')).default);
});

describe('target discussions', () => {
  it('supports direct replies, eligible mentions, resolution and retained tombstones', async () => {
    current = author;
    const members = await request(app).get(`/api/comments/ui/${target}/members`);
    expect(members.status).toBe(200);
    expect(members.body.map((m: any) => m.id)).toContain(peer.id);
    expect(members.body.map((m: any) => m.id)).not.toContain(foreign.id);
    const root = await request(app).post(`/api/comments/ui/${target}`).send({ body: 'Discuss', mentionedUserIds: [peer.id] });
    expect(root.status).toBe(201);
    current = peer;
    const reply = await request(app).post(`/api/comments/ui/${target}`).send({ body: 'Reply', parentId: root.body.id });
    expect(reply.status).toBe(201);
    expect(reply.body.parentId).toBe(root.body.id);
    expect((await request(app).post(`/api/comments/ui/${target}`).send({ body: 'Nested', parentId: reply.body.id })).status).toBe(400);
    expect((await request(app).post(`/api/comments/api/${api}`).send({ body: 'Wrong target', parentId: root.body.id })).status).toBe(400);
    expect((await request(app).patch(`/api/comments/${root.body.id}/resolution`).send({ resolved: true })).status).toBe(403);
    current = author;
    expect((await request(app).patch(`/api/comments/${root.body.id}/resolution`).send({ resolved: true })).status).toBe(200);
    expect((await request(app).post(`/api/comments/ui/${target}`).send({ body: 'Closed', parentId: root.body.id })).status).toBe(409);
    expect((await request(app).get(`/api/comments/ui/${target}?filter=resolved`)).body.map((c: any) => c.id)).toEqual([root.body.id, reply.body.id]);
    current = peer;
    expect((await request(app).get(`/api/comments/ui/${target}?filter=mentions`)).body.map((c: any) => c.id)).toEqual([root.body.id, reply.body.id]);
    current = author;
    expect((await request(app).patch(`/api/comments/${root.body.id}/resolution`).send({ resolved: false })).status).toBe(200);
    expect((await request(app).delete(`/api/comments/${root.body.id}`)).status).toBe(204);
    const rows = (await request(app).get(`/api/comments/ui/${target}`)).body;
    expect(rows.find((c: any) => c.id === root.body.id)).toMatchObject({ body: '', mentionedUserIds: [] });
    expect(rows.find((c: any) => c.id === root.body.id).deletedAt).toBeTruthy();
    expect(rows.find((c: any) => c.id === reply.body.id).body).toBe('Reply');
  });
  it('rejects mentions of members without project access, including result targets', async () => {
    current = { ...author, role: 'owner' };
    for (const path of [`ui/${secret}`, `result/${fixtureId('private-result')}`]) {
      const members = await request(app).get(`/api/comments/${path}/members`);
      expect(members.status).toBe(200);
      expect(members.body.map((m: any) => m.id)).not.toContain(peer.id);
      expect((await request(app).post(`/api/comments/${path}`).send({ body: 'Hidden mention', mentionedUserIds: [peer.id] })).status).toBe(400);
      expect((await request(app).post(`/api/comments/${path}`).send({ body: 'Foreign mention', mentionedUserIds: [foreign.id] })).status).toBe(400);
    }
    current = author;
  });
  it('updates mentions atomically, selects full threads mentioning a reply recipient, and preserves departed recipients', async () => {
    current = author;
    const [mentionTarget] = await privilegedDb.insert(mobileTests).values({ organizationId: author.organizationId, createdBy: author.id, name: 'Mention flow', platform: 'android', app: 'app.apk', deviceName: 'Pixel', steps: [] }).returning();
    const mobile = mentionTarget.id;
    const root = await request(app).post(`/api/comments/mobile/${mobile}`).send({ body: 'Mention flow', mentionedUserIds: [peer.id] });
    expect(root.status).toBe(201);
    expect((await request(app).patch(`/api/comments/${root.body.id}`).send({ body: 'Should rollback', mentionedUserIds: [foreign.id] })).status).toBe(400);
    let rows = (await request(app).get(`/api/comments/mobile/${mobile}`)).body;
    expect(rows.find((c: any) => c.id === root.body.id)).toMatchObject({ body: 'Mention flow', mentionedUserIds: [peer.id] });
    expect((await request(app).patch(`/api/comments/${root.body.id}`).send({ body: 'No root mention', mentionedUserIds: [] })).status).toBe(200);
    const reply = await request(app).post(`/api/comments/mobile/${mobile}`).send({ body: 'Reply recipient', parentId: root.body.id, mentionedUserIds: [peer.id] });
    expect(reply.status).toBe(201);
    current = peer;
    rows = (await request(app).get(`/api/comments/mobile/${mobile}?filter=mentions`)).body;
    expect(rows.map((c: any) => c.id)).toEqual([root.body.id, reply.body.id]);
    current = foreign;
    expect((await request(app).post(`/api/comments/mobile/${mobile}`).send({ body: 'Cross org reply', parentId: root.body.id })).status).toBe(404);
    current = author;
    const departed = await createTestUser(author.organizationId);
    const created = await request(app).post(`/api/comments/mobile/${mobile}`).send({ body: 'Departing mention', mentionedUserIds: [departed] });
    const { users } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    await privilegedDb.delete(users).where(eq(users.id, departed));
    expect((await request(app).patch(`/api/comments/${created.body.id}`).send({ body: 'Retained mention' })).status).toBe(200);
    for (const mentionedUserIds of [[peer.id, peer.id], Array.from({ length: 21 }, (_, i) => i + 1), ['1']]) {
      expect((await request(app).post(`/api/comments/mobile/${mobile}`).send({ body: 'Bad mention', mentionedUserIds })).status).toBe(400);
    }
    expect((await request(app).get(`/api/comments/mobile/${mobile}?filter=unknown`)).status).toBe(400);
  });
  it('rejects every cross-organization target and author even for privileged database writes', async () => {
    const { comments } = await import('@shared/comments');
    for (const linkedTarget of [{ uiTestId: target }, { apiTestId: api }, { mobileTestId: mobile }, { resultId: fixtureId('visible-result') }]) {
      await expect(privilegedDb.insert(comments).values({ organizationId: foreign.organizationId, authorId: foreign.id, body: 'Cross-tenant target', ...linkedTarget }))
        .rejects.toMatchObject({ code: '23503' });
    }
    await expect(privilegedDb.insert(comments).values({ organizationId: author.organizationId, authorId: foreign.id, uiTestId: target, body: 'Cross-tenant author' }))
      .rejects.toMatchObject({ code: '23503' });
  });
  it('retains discussion text with a null author after account deletion', async () => {
    const { comments } = await import('@shared/comments');
    const { users } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const departed = await createTestUser(author.organizationId);
    const [comment] = await privilegedDb.insert(comments).values({ organizationId: author.organizationId, authorId: departed, uiTestId: target, body: 'Retained discussion' }).returning();
    await privilegedDb.delete(users).where(eq(users.id, departed));
    const [retained] = await privilegedDb.select().from(comments).where(eq(comments.id, comment.id));
    expect(retained).toMatchObject({ body: 'Retained discussion', authorId: null });
  });
  it('lets viewers discuss; assigns author and enforces ownership with owner moderation', async () => {
    current = author;
    const created = await request(app).post(`/api/comments/ui/${target}`).send({ body: '  Investigating  ', authorId: peer.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ body: 'Investigating', authorId: author.id });
    const id = created.body.id;
    current = peer;
    expect((await request(app).patch(`/api/comments/${id}`).send({ body: 'Hijacked' })).status).toBe(403);
    expect((await request(app).delete(`/api/comments/${id}`)).status).toBe(403);
    current = author;
    expect((await request(app).patch(`/api/comments/${id}`).send({ body: 'Fixed' })).body.body).toBe('Fixed');
    current = { ...peer, role: 'owner' };
    expect((await request(app).delete(`/api/comments/${id}`)).status).toBe(204);
  });
  it('supports API, mobile and result records', async () => {
    current = author;
    for (const [kind, id] of [['api', api], ['mobile', mobile], ['result', fixtureId('visible-result')]]) {
      expect((await request(app).post(`/api/comments/${kind}/${id}`).send({ body: 'Review' })).status).toBe(201);
      expect((await request(app).get(`/api/comments/${kind}/${id}`)).body).toHaveLength(1);
    }
  });
  it('hides restricted tests and their result discussions and isolates organizations', async () => {
    current = { ...author, role: 'owner' };
    const hidden = await request(app).post(`/api/comments/ui/${secret}`).send({ body: 'Private discussion' });
    expect(hidden.status).toBe(201);
    current = author;
    for (const path of [`ui/${secret}`, `result/${fixtureId('private-result')}`]) {
      expect((await request(app).get(`/api/comments/${path}`)).status).toBe(404);
      expect((await request(app).post(`/api/comments/${path}`).send({ body: 'Hidden' })).status).toBe(404);
    }
    expect((await request(app).patch(`/api/comments/${hidden.body.id}`).send({ body: 'Changed' })).status).toBe(404);
    expect((await request(app).delete(`/api/comments/${hidden.body.id}`)).status).toBe(404);
    current = foreign;
    expect((await request(app).get(`/api/comments/ui/${target}`)).status).toBe(404);
    expect((await request(app).delete(`/api/comments/${hidden.body.id}`)).status).toBe(404);
    current = author;
  });
  it('cascades comments when the target is deleted', async () => {
    current = author;
    const [row] = await privilegedDb.insert(tests).values({ userId: author.id, organizationId: author.organizationId, name: 'Temporary', url: '', sequence: [], elements: [] }).returning();
    const comment = await request(app).post(`/api/comments/ui/${row.id}`).send({ body: 'Temporary comment' });
    expect(comment.status).toBe(201);
    const { eq } = await import('drizzle-orm');
    const { comments } = await import('@shared/comments');
    await privilegedDb.delete(tests).where(eq(tests.id, row.id));
    expect(await privilegedDb.select().from(comments).where(eq(comments.id, comment.body.id))).toHaveLength(0);
  });
  it('removes result discussions before deleting their private originating test, retaining the historical result', async () => {
    const { eq, sql } = await import('drizzle-orm');
    const { comments } = await import('@shared/comments');
    const org = author.organizationId;
    const [project] = await privilegedDb.insert(projects).values({ name: 'Private historical discussion', userId: author.id, organizationId: org, restricted: true }).returning();
    await privilegedDb.insert(projectMembers).values({ organizationId: org, projectId: project.id, userId: author.id, role: 'editor' });
    const [foreignTest] = await privilegedDb.insert(tests).values({ userId: foreign.id, organizationId: foreign.organizationId, name: 'Other tenant test', url: '', sequence: [], elements: [] }).returning();
    const [foreignComment] = await privilegedDb.insert(comments).values({ organizationId: foreign.organizationId, authorId: foreign.id, uiTestId: foreignTest.id, body: 'Other tenant discussion' }).returning();
    const [ui] = await privilegedDb.insert(tests).values({ userId: author.id, organizationId: org, projectId: project.id, name: 'Private UI', url: '', sequence: [], elements: [] }).returning();
    const [apiTest] = await privilegedDb.insert(apiTests).values({ userId: author.id, organizationId: org, projectId: project.id, name: 'Private API', method: 'GET', url: '' }).returning();
    const [mobileTest] = await privilegedDb.insert(mobileTests).values({ organizationId: org, projectId: project.id, name: 'Private mobile', platform: 'android', app: 'app.apk', deviceName: 'Pixel' }).returning();
    for (const [kind, id] of [['ui', ui.id], ['api', apiTest.id], ['mobile', mobileTest.id]] as const) {
      const resultId = fixtureId(`deleted-private-${kind}`);
      await privilegedDb.insert(reportTestCaseResults).values({ id: resultId, organizationId: org, testPlanExecutionId: fixtureId('comment-run'), testType: kind, testName: 'Private', status: 'Passed', startedAt: new Date(),
        uiTestId: kind === 'ui' ? id : null, apiTestId: kind === 'api' ? id : null, mobileTestId: kind === 'mobile' ? id : null });
      current = { ...author, role: 'owner' };
      expect((await request(app).post(`/api/comments/result/${resultId}`).send({ body: 'Private historical notes' })).status).toBe(201);
      current = peer;
      expect((await request(app).get(`/api/comments/result/${resultId}`)).status).toBe(404);
      // Production app_user + project editor: the SECURITY INVOKER trigger must clean up
      // before source FKs become NULL, even without privileged RLS bypass.
      const table = kind === 'ui' ? tests : kind === 'api' ? apiTests : mobileTests;
      await runWithTenant(org, () => withTenantTransaction(async tx => {
        const principal = await tx.execute(sql`SELECT current_user AS role`);
        expect(principal.rows[0]).toMatchObject({ role: 'app_user' });
        expect(await tx.delete(table).where(eq(table.id, id)).returning({ id: table.id })).toHaveLength(1);
      }), { userId: author.id, role: 'editor' });
      expect(await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.id, resultId))).toHaveLength(1);
      expect(await privilegedDb.select().from(comments).where(eq(comments.resultId, resultId))).toHaveLength(0);
      expect(await privilegedDb.select().from(comments).where(eq(comments.id, foreignComment.id))).toHaveLength(1);
      const response = await request(app).get(`/api/comments/result/${resultId}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    }
    current = author;
  });
  it('rejects empty, oversized and malformed input; requires authentication', async () => {
    current = author;
    for (const body of [' ', 'x'.repeat(5001)]) expect((await request(app).post(`/api/comments/ui/${target}`).send({ body })).status).toBe(400);
    expect((await request(app).get('/api/comments/ui/1oops')).status).toBe(400);
    expect((await request(app).get('/api/comments/unknown/1')).status).toBe(400);
    current = null;
    expect((await request(app).get(`/api/comments/ui/${target}`)).status).toBe(401);
    current = author;
  });
});
