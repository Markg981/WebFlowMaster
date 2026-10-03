import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { runWithTenant, withTenantTransaction } from '../middleware/tenancy';
import { apiTests, mobileTests, testVersions, testPublications, testReviews } from '@shared/schema';
import { createTestOrganization, createTestUser } from './factories';

async function fixture(kind: 'api' | 'mobile') {
  const organizationId = await createTestOrganization('Typed history isolation');
  const otherOrg = await createTestOrganization('Other history tenant');
  const userId = await createTestUser(organizationId);
  const otherUser = await createTestUser(otherOrg);
  const create = async (org: number, user: number) =>
    kind === 'api'
      ? (
          await privilegedDb
            .insert(apiTests)
            .values({
              organizationId: org,
              userId: user,
              name: 'Request',
              method: 'GET',
              url: 'https://example.test',
            })
            .returning()
        )[0]
      : (
          await privilegedDb
            .insert(mobileTests)
            .values({
              organizationId: org,
              createdBy: user,
              name: 'App',
              platform: 'android',
              app: 'bs://app',
              deviceName: 'Pixel',
              steps: [],
            })
            .returning()
        )[0];
  const own = await create(organizationId, userId);
  const foreign = await create(otherOrg, otherUser);
  const target = (id: number) => (kind === 'api' ? { apiTestId: id } : { mobileTestId: id });
  return { organizationId, otherOrg, own, foreign, target };
}

for (const kind of ['api', 'mobile'] as const)
  describe(`${kind} immutable history constraints`, () => {
    it('rejects a target from a different tenant even for a privileged writer', async () => {
      const f = await fixture(kind);
      for (const table of [testVersions, testPublications, testReviews]) {
        const values =
          table === testVersions
            ? {
                version: 1,
                name: 'Wrong tenant',
                url: '',
                sequence: [],
                elements: [],
                snapshot: {},
              }
            : table === testPublications
              ? { version: 1, kind: 'publish' as const }
              : { version: 1 };
        await expect(
          privilegedDb
            .insert(table)
            .values({
              ...values,
              organizationId: f.organizationId,
              ...f.target(f.foreign.id),
            } as never),
        ).rejects.toThrow();
      }
    });
    it('rejects missing or ambiguous targets', async () => {
      const f = await fixture(kind);
      await expect(
        privilegedDb
          .insert(testVersions)
          .values({
            organizationId: f.organizationId,
            version: 1,
            name: 'Missing',
            url: '',
            sequence: [],
            elements: [],
            snapshot: {},
          }),
      ).rejects.toThrow();
      const api = (
        await privilegedDb
          .insert(apiTests)
          .values({
            organizationId: f.organizationId,
            userId:
              kind === 'api'
                ? (f.own as typeof apiTests.$inferSelect).userId
                : (f.own as typeof mobileTests.$inferSelect).createdBy!,
            name: 'Other target',
            method: 'GET',
            url: 'https://example.test',
          })
          .returning()
      )[0];
      const mobile =
        kind === 'mobile'
          ? f.own
          : (
              await privilegedDb
                .insert(mobileTests)
                .values({
                  organizationId: f.organizationId,
                  createdBy: (f.own as typeof apiTests.$inferSelect).userId,
                  name: 'App',
                  platform: 'android',
                  app: 'bs://app',
                  deviceName: 'Pixel',
                  steps: [],
                })
                .returning()
            )[0];
      await expect(
        privilegedDb
          .insert(testVersions)
          .values({
            organizationId: f.organizationId,
            apiTestId: api.id,
            mobileTestId: mobile.id,
            version: 1,
            name: 'Ambiguous',
            url: '',
            sequence: [],
            elements: [],
            snapshot: {},
          }),
      ).rejects.toThrow();
    });
    it.runIf(/^postgres(?:ql)?:/.test(process.env.DATABASE_URL ?? ''))(
      'keeps typed history tenant-scoped and append-only as app_user',
      async () => {
        const f = await fixture(kind);
        const rows = await privilegedDb
          .insert(testVersions)
          .values([
            {
              organizationId: f.organizationId,
              ...f.target(f.own.id),
              version: 1,
              name: 'Own',
              url: '',
              sequence: [],
              elements: [],
              snapshot: {},
            },
            {
              organizationId: f.otherOrg,
              ...f.target(f.foreign.id),
              version: 1,
              name: 'Foreign',
              url: '',
              sequence: [],
              elements: [],
              snapshot: {},
            },
          ])
          .returning();
        const visible = await runWithTenant(f.organizationId, () =>
          withTenantTransaction((tx) => tx.select().from(testVersions)),
        );
        expect(visible.map((row) => row.id)).toContain(rows[0].id);
        expect(visible.map((row) => row.id)).not.toContain(rows[1].id);
        await expect(
          runWithTenant(f.organizationId, () =>
            withTenantTransaction((tx) =>
              tx
                .update(testVersions)
                .set({ name: 'Rewritten' })
                .where(eq(testVersions.id, rows[0].id)),
            ),
          ),
        ).rejects.toThrow();
        await expect(
          runWithTenant(f.organizationId, () =>
            withTenantTransaction((tx) =>
              tx.delete(testVersions).where(eq(testVersions.id, rows[0].id)),
            ),
          ),
        ).rejects.toThrow();
      },
    );
  });
