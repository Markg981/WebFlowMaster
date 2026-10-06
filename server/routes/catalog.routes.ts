import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { tests } from '@shared/schema';
import { catalogQuerySchema } from '@shared/catalog';
import { catalogPage, type CatalogType } from '../catalog';
import { requireRole } from '../middleware/require-role';
import { withTenantTransaction } from '../middleware/tenancy';
import { tagsOfTests } from '../test-tags';
import loggerPromise from '../logger';

const router = Router();

for (const type of ['tests', 'api-tests', 'mobile-tests', 'test-data'] as CatalogType[]) {
  router.get(`/api/catalog/${type}`, requireRole('viewer'), async (req, res) => {
    const parsed = catalogQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid catalog query', details: parsed.error.flatten() });
    const query = parsed.data;
    if ((query.status !== undefined && type !== 'tests') ||
        (type === 'test-data' && (query.projectId !== undefined || query.tagIds.length))) {
      return res.status(400).json({ error: 'This filter is not supported by this catalog' });
    }
    try {
      res.json(await withTenantTransaction(tx => catalogPage(tx, type, query)));
    } catch (error) {
      (await loggerPromise).error({ message: 'Could not load catalog', catalog: type, error: (error as Error).message });
      res.status(500).json({ error: 'Could not load catalog' });
    }
  });
}

// Register this router AFTER tests.routes so the static /api/tests/export route wins.
router.get('/api/tests/:id', requireRole('viewer'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return res.status(400).json({ error: 'Invalid test id' });
  try {
    const result = await withTenantTransaction(async tx => {
      const [test] = await tx.select().from(tests).where(eq(tests.id, id)).limit(1);
      if (!test) return null;
      const tagged = await tagsOfTests(tx, { testIds: [id] });
      return { ...test, tags: tagged.ui.get(id) ?? [] };
    });
    if (!result) return res.status(404).json({ error: 'Test not found' });
    res.json(result);
  } catch (error) {
    (await loggerPromise).error({ message: 'Could not load test', error: (error as Error).message });
    res.status(500).json({ error: 'Could not load test' });
  }
});

export default router;
