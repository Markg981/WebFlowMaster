import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mobileStepGroups } from '@shared/schema';
import { mobileGroupSchema } from '@shared/mobile-groups';
import { getTenantOrgId, withTenantTransaction, type TenantTx } from '../middleware/tenancy';
import { requireRole } from '../middleware/require-role';
import { lockOrganizationRuns } from '../tenant-quotas';
import loggerPromise from '../logger';

const router = Router();
const logger = await loggerPromise;
class GroupError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function editableProject(tx: TenantTx, projectId: number | null) {
  const result = await tx.execute(sql`SELECT app_project_editable(${projectId}::int) AS ok`);
  if (!(result.rows[0] as { ok: boolean }).ok)
    throw new GroupError(403, 'The group project cannot be edited.');
}
async function editableGroup(tx: TenantTx, id: string) {
  const [group] = await tx.select().from(mobileStepGroups).where(eq(mobileStepGroups.id, id));
  if (!group) throw new GroupError(404, 'Mobile group not found.');
  await editableProject(tx, group.projectId);
  return group;
}
function fail(res: import('express').Response, error: unknown) {
  if (error instanceof GroupError) return res.status(error.status).json({ error: error.message });
  const message = (error as Error).message;
  if (/unique|duplicate/i.test(message))
    return res
      .status(409)
      .json({ error: 'A mobile group with this name and platform already exists.' });
  if (/foreign key|row-level security/i.test(message))
    return res.status(400).json({ error: 'Invalid group project.' });
  logger.error({ message: 'Mobile group operation failed', error: message });
  return res.status(500).json({ error: 'Mobile group operation failed.' });
}
router.get('/api/mobile-step-groups', requireRole('viewer'), async (_req, res) => {
  try {
    res.json(
      await withTenantTransaction((tx) =>
        tx.select().from(mobileStepGroups).orderBy(mobileStepGroups.name),
      ),
    );
  } catch (error) {
    fail(res, error);
  }
});
router.post('/api/mobile-step-groups', requireRole('editor'), async (req, res) => {
  const parsed = mobileGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const group = await withTenantTransaction(async (tx) => {
      await lockOrganizationRuns(tx, getTenantOrgId()!);
      await editableProject(tx, parsed.data.projectId ?? null);
      const [row] = await tx
        .insert(mobileStepGroups)
        .values({
          ...parsed.data,
          id: randomUUID(),
          organizationId: getTenantOrgId()!,
          createdBy: req.user!.id,
        })
        .returning();
      return row;
    });
    res.status(201).json(group);
  } catch (error) {
    fail(res, error);
  }
});
router.put('/api/mobile-step-groups/:id', requireRole('editor'), async (req, res) => {
  const parsed = mobileGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const group = await withTenantTransaction(async (tx) => {
      await lockOrganizationRuns(tx, getTenantOrgId()!);
      const current = await editableGroup(tx, req.params.id);
      if (current.platform !== parsed.data.platform) {
        const used = await tx.execute(sql`SELECT app_mobile_group_used(${current.id}) AS used`);
        if ((used.rows[0] as { used: boolean }).used)
          throw new GroupError(409, 'A referenced group cannot change platform.');
      }
      await editableProject(tx, parsed.data.projectId ?? null);
      const [row] = await tx
        .update(mobileStepGroups)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(mobileStepGroups.id, current.id))
        .returning();
      return row;
    });
    res.json(group);
  } catch (error) {
    fail(res, error);
  }
});
router.delete('/api/mobile-step-groups/:id', requireRole('editor'), async (req, res) => {
  try {
    await withTenantTransaction(async (tx) => {
      await lockOrganizationRuns(tx, getTenantOrgId()!);
      const current = await editableGroup(tx, req.params.id);
      const result = await tx.execute(sql`SELECT app_mobile_group_used(${current.id}) AS used`);
      if ((result.rows[0] as { used: boolean }).used)
        throw new GroupError(409, 'The group is referenced by a mobile test.');
      await tx.delete(mobileStepGroups).where(eq(mobileStepGroups.id, current.id));
    });
    res.status(204).end();
  } catch (error) {
    fail(res, error);
  }
});
export default router;
