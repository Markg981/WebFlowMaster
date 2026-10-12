import { asyncRouter } from '../middleware/async-router';
import { and, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { apiTests, mobileTests, tests } from '@shared/schema';
import { asyncHandler } from '../middleware/async-handler';
import { requireRole } from '../middleware/require-role';
import { withTenantTransaction } from '../middleware/tenancy';
import { tagsOfTests, testIdsWithTags } from '../test-tags';

/**
 * The picker a test plan is assembled from: UI, API and mobile app tests in one list.
 *
 * Every test of the organization the requester can see, not only their own: a plan is the
 * organization's, and one built by a colleague has to be able to include anybody's tests.
 */

const router = asyncRouter();

router.get(
  '/api/selectable-tests',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search as string | undefined;

    // Which tags a test must carry to be offered. Every one of them, not any: "smoke and
    // checkout" means the tests that are both, which is what narrowing a list down means.
    const tagIds = String(req.query.tags ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');

    const uiConditions: SQL[] = [];
    const apiConditions: SQL[] = [];
    const mobileConditions: SQL[] = [];

    if (searchTerm) {
      const searchPattern = `%${searchTerm}%`;
      uiConditions.push(ilike(tests.name, searchPattern));
      apiConditions.push(ilike(apiTests.name, searchPattern));
      mobileConditions.push(ilike(mobileTests.name, searchPattern));
    }

    // One tenant transaction for all of them: RLS bounds them to the caller's organization
    // and hides the restricted projects they are not on.
    const { uiTestResults, apiTestResults, mobileTestResults, tagsByTest } =
      await withTenantTransaction(async (tx) => {
        if (tagIds.length > 0) {
          // A tag filter that matches nothing must offer nothing. inArray on an empty list is
          // not a predicate, so the empty case is answered here rather than by a query that
          // would quietly return everything.
          const [uiIds, apiIds, mobileIds] = await Promise.all([
            testIdsWithTags(tx, { tagIds, testType: 'ui' }),
            testIdsWithTags(tx, { tagIds, testType: 'api' }),
            testIdsWithTags(tx, { tagIds, testType: 'mobile' }),
          ]);
          if (mobileIds.length === 0) mobileConditions.push(sql`false`);
          else mobileConditions.push(inArray(mobileTests.id, mobileIds));
          if (uiIds.length === 0) uiConditions.push(sql`false`);
          else uiConditions.push(inArray(tests.id, uiIds));
          if (apiIds.length === 0) apiConditions.push(sql`false`);
          else apiConditions.push(inArray(apiTests.id, apiIds));
        }

        const uiTestResults = await tx
          .select({
            id: tests.id,
            name: tests.name,
            description: sql<string>`null`.as('description'),
            type: sql<string>`'ui'`.as('type'),
            updatedAt: tests.updatedAt,
          })
          .from(tests)
          .where(and(...uiConditions));
        const apiTestResults = await tx
          .select({
            id: apiTests.id,
            name: apiTests.name,
            description: sql<string>`null`.as('description'),
            type: sql<string>`'api'`.as('type'),
            updatedAt: apiTests.updatedAt,
          })
          .from(apiTests)
          .where(and(...apiConditions));
        // Mobile app tests (migrations 0053, 0056), narrowed by name and tags like the others.
        const mobileTestResults = await tx
          .select({
            id: mobileTests.id,
            name: mobileTests.name,
            description: sql<string>`null`.as('description'),
            type: sql<string>`'mobile'`.as('type'),
            updatedAt: mobileTests.updatedAt,
          })
          .from(mobileTests)
          .where(and(...mobileConditions));

        return {
          uiTestResults,
          apiTestResults,
          mobileTestResults,
          // Shown beside each name, so somebody picking tests can see what they are picking
          // rather than recognising it from the name alone.
          tagsByTest: await tagsOfTests(tx, {
            testIds: uiTestResults.map((row) => row.id),
            apiTestIds: apiTestResults.map((row) => row.id),
            mobileTestIds: mobileTestResults.map((row) => row.id),
          }),
        };
      });

    const combinedResults = [
      ...uiTestResults.map((row) => ({ ...row, tags: tagsByTest.ui.get(row.id) ?? [] })),
      ...apiTestResults.map((row) => ({ ...row, tags: tagsByTest.api.get(row.id) ?? [] })),
      ...mobileTestResults.map((row) => ({ ...row, tags: tagsByTest.mobile.get(row.id) ?? [] })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    const totalItems = combinedResults.length;
    res.json({
      items: combinedResults.slice(offset, offset + limit),
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
      itemsPerPage: limit,
    });
  }),
);

export default router;
