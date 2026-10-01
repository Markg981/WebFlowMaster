import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { mobileTests, tags, testSuites, testTags, tests } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Tags on mobile app tests (migration 0056): put on and taken off like a web test's, counted on
 * the tag, listed with the test, matched by a dynamic suite — through RLS, whose project policies
 * on test_tags now see a mobile test's row at all.
 */

type User = { id: number; username: string; organizationId: number; role: string };
let app: express.Express;
let organizationId: number;
let editor: User;
let viewer: User;
let otherOrg: User;
let currentUser: User;
let mobileTest: number;
let webTest: number;
let smoke: string;
let android: string;

const { runWithTenant, withTenantTransaction } = await import('./middleware/tenancy');
const { testIdsWithTags } = await import('./test-tags');
const { testsOfSuite } = await import('./test-suites');

beforeAll(async () => {
  organizationId = await createTestOrganization('Mobile Tags Org');
  editor = { id: await createTestUser(organizationId, 'mtags-editor'), username: 'mtags-editor', organizationId, role: 'editor' };
  viewer = { id: await createTestUser(organizationId, 'mtags-viewer'), username: 'mtags-viewer', organizationId, role: 'viewer' };
  const other = await createTestOrganization('Other Mobile Tags Org');
  otherOrg = { id: await createTestUser(other, 'mtags-other'), username: 'mtags-other', organizationId: other, role: 'owner' };

  mobileTest = (await privilegedDb.insert(mobileTests).values({ organizationId, name: 'Checkout on Android', platform: 'android', app: 'bs://a', deviceName: 'Google Pixel 8', steps: [] } as any).returning())[0].id;
  webTest = (await privilegedDb.insert(tests).values({ organizationId, userId: editor.id, name: 'Checkout on the web', url: 'https://shop.test', sequence: [], elements: [] } as any).returning())[0].id;
  [{ id: smoke }] = await privilegedDb.insert(tags).values({ id: uuidv4(), organizationId, name: 'smoke' } as any).returning();
  [{ id: android }] = await privilegedDb.insert(tags).values({ id: uuidv4(), organizationId, name: 'android' } as any).returning();

  const { default: tagRoutes } = await import('./routes/tags.routes');
  const { default: mobileRoutes } = await import('./routes/mobile-tests.routes');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
  });
  app.use(tagRoutes, mobileRoutes);
});

beforeEach(async () => {
  currentUser = editor;
  await privilegedDb.delete(testTags).where(eq(testTags.organizationId, organizationId));
});

const put = (id: number, tagIds: string[]) => request(app).put(`/api/mobile-tests/${id}/tags`).send({ tagIds });

describe('tags on a mobile test', () => {
  it('are set as a whole, listed with the test and counted on the tag', async () => {
    const set = await put(mobileTest, [smoke, android]);
    expect(set.status).toBe(200);
    expect(set.body.tags.map((t: any) => t.name)).toEqual(['android', 'smoke']);

    const listed = (await request(app).get('/api/mobile-tests')).body.find((t: any) => t.id === mobileTest);
    expect(listed.tags.map((t: any) => t.name)).toEqual(['android', 'smoke']);
    const counted = (await request(app).get('/api/tags')).body.find((t: any) => t.id === smoke);
    expect(counted).toMatchObject({ uiCount: 0, apiCount: 0, mobileCount: 1 });

    expect((await put(mobileTest, [smoke])).body.tags.map((t: any) => t.name)).toEqual(['smoke']);
    const rows = await privilegedDb.select().from(testTags).where(eq(testTags.mobileTestId, mobileTest));
    expect(rows).toEqual([expect.objectContaining({ testType: 'mobile', tagId: smoke, testId: null, apiTestId: null })]);
  });

  it('refuses an unknown tag, a viewer, and another organization', async () => {
    const unknown = await put(mobileTest, [uuidv4()]);
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('Some of those tags do not exist.');
    currentUser = viewer;
    expect((await put(mobileTest, [smoke])).status).toBe(403);
    currentUser = otherOrg;
    expect((await put(mobileTest, [smoke])).status).toBe(404);
  });

  it('is matched by the tags a dynamic suite asks for, beside the web tests carrying them', async () => {
    await put(mobileTest, [smoke, android]);
    await request(app).put(`/api/tests/${webTest}/tags`).send({ tagIds: [smoke] });

    const ids = await runWithTenant(organizationId, () => withTenantTransaction((tx) => testIdsWithTags(tx, { tagIds: [smoke, android], testType: 'mobile' })), { userId: editor.id, role: 'editor' });
    expect(ids).toEqual([mobileTest]);

    const [suite] = await privilegedDb
      .insert(testSuites)
      .values({ organizationId, name: `Smoke ${uuidv4().slice(0, 6)}`, kind: 'dynamic', tagIds: [smoke] } as any)
      .returning();
    const resolved = await runWithTenant(organizationId, () => withTenantTransaction((tx) => testsOfSuite(tx, suite)), { userId: editor.id, role: 'editor' });
    expect(resolved).toEqual([
      { testType: 'ui', testId: webTest, apiTestId: null },
      { testType: 'mobile', testId: null, apiTestId: null, mobileTestId: mobileTest },
    ]);
  });

  it('is kept to one of the three kinds by the database', async () => {
    await expect(
      privilegedDb.insert(testTags).values({ organizationId, tagId: smoke, testId: webTest, mobileTestId: mobileTest, testType: 'mobile' }),
    ).rejects.toThrow();
  });
});
