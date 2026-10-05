import { Router } from 'express';
import { z } from 'zod';
import { QUOTA_MODES } from '@shared/tenant-quotas';
import { requireInstallationAdmin } from '../installation-admin';
import { auditActor } from '../audit';
import { listOrganizationQuotas, QuotaAdminError, reconcileQuotaArtifacts, updateOrganizationQuotas } from '../tenant-quota-admin';

const router = Router();
const root = '/api/admin/organization-quotas';
router.use(root, (req, res, next) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, requireInstallationAdmin);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const overridesSchema = z.object({ mode: z.enum(QUOTA_MODES).nullable().optional(),
  maxConcurrentRuns: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  maxQueuedRuns: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  maxTests: count.optional(), maxArtifactBytes: count.optional(), maxMonthlyExecutionMinutes: count.optional() }).strict();
const updateSchema = z.object({ revision: z.number().int().min(1).max(2_147_483_646), overrides: overridesSchema }).strict();
const querySchema = z.object({ search: z.string().max(100).default(''), limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) });
const idSchema = z.coerce.number().int().min(1).max(2_147_483_647);

router.get(root, async (req, res, next) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
  try { res.json(await listOrganizationQuotas(parsed.data.search, parsed.data.limit, parsed.data.offset)); }
  catch (error) { next(error); }
});
router.patch(`${root}/:id`, async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id); const body = updateSchema.safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: 'Invalid quota values' });
  try { res.json(await updateOrganizationQuotas(id.data, body.data.revision, body.data.overrides, auditActor(req))); }
  catch (error) {
    if (error instanceof QuotaAdminError) return res.status(error.status).json({ error: error.message, code: error.code });
    next(error);
  }
});
router.post(`${root}/:id/reconcile-artifacts`, async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid organization ID' });
  try { res.json(await reconcileQuotaArtifacts(id.data, auditActor(req))); }
  catch (error) {
    if (error instanceof QuotaAdminError) return res.status(error.status).json({ error: error.message, code: error.code });
    next(error);
  }
});
export default router;
