import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { apiTests, mobileTests, projects, projectMembers, users } from '@shared/schema';
import { privilegedDb } from './db';
import { tenancyMiddleware, runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { createTestOrganization } from './tests/factories';
import { recordTypedTestVersion, currentContentOf, currentVersionsOf } from './test-version-store';
import { publishedContentOf } from './test-publishing';
vi.mock('./logger', () => ({
  default: Promise.resolve({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));
const { default: versionsRoutes } = await import('./routes/test-versions.routes');
const { default: publishingRoutes } = await import('./routes/test-publishing.routes');
let current: typeof users.$inferSelect;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = current;
  req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
  next();
});
app.use(tenancyMiddleware);
app.use(versionsRoutes);
app.use(publishingRoutes);
let org: number;
let author: typeof users.$inferSelect;
let reviewer: typeof users.$inferSelect;
beforeAll(async () => {
  org = await createTestOrganization('Typed lifecycle');
  [author, reviewer] = await privilegedDb
    .insert(users)
    .values([
      { organizationId: org, username: 'typed-author', password: 'x', role: 'editor' },
      { organizationId: org, username: 'typed-reviewer', password: 'x', role: 'editor' },
    ])
    .returning();
});
const tenant = <T>(work: (tx: Parameters<typeof recordTypedTestVersion>[0]) => Promise<T>) =>
  runWithTenant(org, () => withTenantTransaction(work));
for (const kind of ['api', 'mobile'] as const)
  describe(`${kind} version and publication lifecycle`, () => {
    const route = kind === 'api' ? 'api-tests' : 'mobile-tests';
    let serial = 0;
    async function seed() {
      const [test] =
        kind === 'api'
          ? await privilegedDb
              .insert(apiTests)
              .values({
                organizationId: org,
                userId: author.id,
                name: 'API',
                url: 'https://first.test',
                method: 'GET',
                authParams: { token: 'initial' },
                protoDefinition: 'syntax = "proto3";',
              })
              .returning()
          : await privilegedDb
              .insert(mobileTests)
              .values({
                organizationId: org,
                createdBy: author.id,
                name: `Mobile ${++serial}`,
                platform: 'android',
                app: 'bs://original',
                deviceName: 'Pixel',
                gridId: null,
                steps: [],
              })
              .returning();
      await tenant((tx) =>
        recordTypedTestVersion(tx, {
          testType: kind,
          testId: test.id,
          organizationId: org,
          userId: author.id,
          test,
        }),
      );
      return test;
    }
    it('records full executable content, ignores noop save, publishes an immutable old version and restores a new revision', async () => {
      const test = await seed();
      expect(
        await tenant((tx) =>
          recordTypedTestVersion(tx, {
            testType: kind,
            testId: test.id,
            organizationId: org,
            userId: author.id,
            test: { ...test, projectId: 900, publishedVersion: 8 },
          }),
        ),
      ).toBeNull();
      const edited = {
        ...test,
        name: 'Edited',
        ...(kind === 'api'
          ? { url: 'https://second.test', authParams: { token: 'new' } }
          : { app: 'bs://new' }),
      };
      await tenant((tx) =>
        recordTypedTestVersion(tx, {
          testType: kind,
          testId: test.id,
          organizationId: org,
          userId: author.id,
          test: edited,
        }),
      );
      current = author;
      await request(app).post(`/api/${route}/${test.id}/publish`).send({ version: 1 }).expect(200);
      const content = await tenant((tx) => publishedContentOf(tx, [test.id], kind));
      expect(content.get(test.id)?.snapshot?.name).toBe(test.name);
      const latest = await tenant((tx) => currentContentOf(tx, [test.id], kind));
      expect(latest.get(test.id)?.version).toBe(2);
      expect(latest.get(test.id)?.snapshot.name).toBe('Edited');
      const restored = await request(app)
        .post(`/api/${route}/${test.id}/versions/1/restore`)
        .expect(200);
      expect(restored.body.newVersion).toBe(3);
      expect(restored.body.test.publishedVersion).toBe(1);
      const version = await request(app).get(`/api/${route}/${test.id}/versions/3`).expect(200);
      expect(version.body.snapshot).not.toHaveProperty('organizationId');
      expect(version.body.snapshot).not.toHaveProperty('publishedVersion');
      expect((await tenant((tx) => currentVersionsOf(tx, [test.id], kind))).get(test.id)).toBe(3);
    });
    it('lists typed reviews with canonical IDs and rejects approval by the snapshot author', async () => {
      const test = await seed();
      current = author;
      const review = await request(app)
        .post(`/api/${route}/${test.id}/reviews`)
        .send({ note: 'Ready' })
        .expect(201);
      await request(app).post(`/api/test-reviews/${review.body.id}/approve`).send({}).expect(403);
      const queue = await request(app).get('/api/test-reviews').expect(200);
      const row = queue.body.find((r: { id: number }) => r.id === review.body.id);
      expect(row.testType).toBe(kind);
      expect(row.testId).toBe(test.id);
      current = reviewer;
      await request(app).post(`/api/test-reviews/${review.body.id}/approve`).send({}).expect(200);
      const state = await request(app).get(`/api/${route}/${test.id}/publishing`).expect(200);
      expect(state.body.publishedVersion).toBe(1);
    });
    it('refuses publication, review requests and restores to a project viewer', async () => {
      const test = await seed();
      const [project] = await privilegedDb
        .insert(projects)
        .values({ name: 'Restricted', organizationId: org, userId: author.id, restricted: true })
        .returning();
      await privilegedDb
        .insert(projectMembers)
        .values({ organizationId: org, projectId: project.id, userId: author.id, role: 'viewer' });
      const table = kind === 'api' ? apiTests : mobileTests;
      await privilegedDb.update(table).set({ projectId: project.id }).where(eq(table.id, test.id));
      current = author;
      await request(app).get(`/api/${route}/${test.id}/versions`).expect(200);
      await request(app).post(`/api/${route}/${test.id}/publish`).send({}).expect(403);
      await request(app).post(`/api/${route}/${test.id}/reviews`).send({}).expect(403);
      await request(app).post(`/api/${route}/${test.id}/versions/1/restore`).expect(403);
    });
  });
