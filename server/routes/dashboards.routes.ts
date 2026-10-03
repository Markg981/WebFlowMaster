import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { dashboards, userDashboardPreferences, userDashboardLayouts, DEFAULT_DASHBOARD_WIDGETS, dashboardDocumentSchema, dashboardUpdateSchema, type Dashboard, type DashboardWidget } from '@shared/dashboard-layout';
import { projects } from '@shared/schema';
import { getTenantOrgId, withTenantTransaction, type TenantTx } from '../middleware/tenancy';
import { requireRole } from '../middleware/require-role';

const router = Router();
router.use('/api/dashboards', requireRole('viewer'));
const idSchema = z.string().uuid();
const manage = (row: Dashboard, user: { id: number; role: string }) => row.creatorId === user.id || row.visibility === 'organization' && user.role === 'owner';
async function validateProjects(tx: TenantTx, widgets: DashboardWidget[]) {
  for (const id of new Set(widgets.flatMap(w => w.config.projectId ? [w.config.projectId] : []))) {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, id));
    if (!project) return false;
  }
  return true;
}
async function initialPreference(tx: TenantTx, userId: number) {
  const organizationId = getTenantOrgId()!;
  await tx.insert(userDashboardPreferences).values({ organizationId, userId }).onConflictDoNothing();
  const [pref] = await tx.select().from(userDashboardPreferences).where(and(eq(userDashboardPreferences.organizationId, organizationId), eq(userDashboardPreferences.userId, userId))).for('update');
  if (pref.selectedDashboardId || pref.defaultDashboardId) return pref;
  const [existing] = await tx.select().from(dashboards).where(and(eq(dashboards.creatorId, userId), eq(dashboards.visibility, 'private'))).limit(1);
  const [legacy] = await tx.select().from(userDashboardLayouts).where(and(eq(userDashboardLayouts.organizationId, organizationId), eq(userDashboardLayouts.userId, userId)));
  const widgets = legacy ? legacy.widgets.map(w => ({ ...DEFAULT_DASHBOARD_WIDGETS.find(d => d.type === w.id)!, visible: w.visible })) : DEFAULT_DASHBOARD_WIDGETS;
  const row = existing ?? (await tx.insert(dashboards).values({ organizationId, creatorId: userId, name: 'My dashboard', widgets }).returning())[0];
  return (await tx.update(userDashboardPreferences).set({ selectedDashboardId: row.id, defaultDashboardId: row.id, updatedAt: new Date() }).where(and(eq(userDashboardPreferences.organizationId, organizationId), eq(userDashboardPreferences.userId, userId))).returning())[0];
}
router.get('/api/dashboards', async (req, res) => {
  try {
    const result = await withTenantTransaction(async tx => {
      const preferences = await initialPreference(tx, req.user!.id);
      const rows = await tx.select().from(dashboards).orderBy(dashboards.createdAt);
      return { dashboards: rows.map(row => ({ ...row, canManage: manage(row, req.user!) })), preferences };
    });
    res.json(result);
  } catch { res.status(500).json({ error: 'Failed to load dashboards' }); }
});
router.post('/api/dashboards', requireRole('viewer'), async (req, res) => {
  const parsed = dashboardDocumentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid dashboard', details: parsed.error.flatten() });
  try {
    await withTenantTransaction(async tx => {
      if (!await validateProjects(tx, parsed.data.widgets)) return res.status(400).json({ error: 'Project unavailable' });
      const [row] = await tx.insert(dashboards).values({ ...parsed.data, organizationId: getTenantOrgId()!, creatorId: req.user!.id }).returning();
      res.status(201).json({ ...row, canManage: true });
    });
  } catch { res.status(500).json({ error: 'Failed to create dashboard' }); }
});
router.put('/api/dashboards/preferences', requireRole('viewer'), async (req, res) => {
  const parsed = z.object({ selectedDashboardId: idSchema.nullable().optional(), defaultDashboardId: idSchema.nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid preferences' });
  try {
    await withTenantTransaction(async tx => {
      for (const id of Object.values(parsed.data)) if (id && !(await tx.select({ id: dashboards.id }).from(dashboards).where(eq(dashboards.id, id)))[0]) return res.status(404).json({ error: 'Dashboard not found' });
      await tx.insert(userDashboardPreferences).values({ organizationId: getTenantOrgId()!, userId: req.user!.id }).onConflictDoNothing();
      const [row] = await tx.update(userDashboardPreferences).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(userDashboardPreferences.organizationId, getTenantOrgId()!), eq(userDashboardPreferences.userId, req.user!.id))).returning();
      res.json(row);
    });
  } catch { res.status(500).json({ error: 'Failed to save preferences' }); }
});
router.use('/api/dashboards/:id', (req, res, next) => idSchema.safeParse(req.params.id).success ? next() : res.status(400).json({ error: 'Invalid dashboard ID' }));
router.get('/api/dashboards/:id', async (req, res) => {
  try {
    const [row] = await withTenantTransaction(tx => tx.select().from(dashboards).where(eq(dashboards.id, req.params.id)));
    if (!row) return res.status(404).json({ error: 'Dashboard not found' });
    res.json({ ...row, canManage: manage(row, req.user!) });
  } catch { res.status(500).json({ error: 'Failed to load dashboard' }); }
});
router.put('/api/dashboards/:id', requireRole('viewer'), async (req, res) => {
  const parsed = dashboardUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid dashboard', details: parsed.error.flatten() });
  try {
    await withTenantTransaction(async tx => {
      const [old] = await tx.select().from(dashboards).where(eq(dashboards.id, req.params.id));
      if (!old) return res.status(404).json({ error: 'Dashboard not found' });
      if (!manage(old, req.user!) || parsed.data.visibility === 'private' && old.creatorId !== req.user!.id) return res.status(403).json({ error: 'Only the creator can make a dashboard private' });
      if (old.version !== parsed.data.version) return res.status(409).json({ error: 'Dashboard changed. Reload before saving.' });
      if (!await validateProjects(tx, parsed.data.widgets)) return res.status(400).json({ error: 'Project unavailable' });
      const [row] = await tx.update(dashboards).set({ ...parsed.data, version: sql`${dashboards.version} + 1`, updatedAt: new Date() }).where(and(eq(dashboards.id, req.params.id), eq(dashboards.version, parsed.data.version))).returning();
      if (!row) return res.status(409).json({ error: 'Dashboard changed. Reload before saving.' });
      res.json({ ...row, canManage: true });
    });
  } catch { res.status(500).json({ error: 'Failed to save dashboard' }); }
});
router.post('/api/dashboards/:id/duplicate', requireRole('viewer'), async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(100) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid name' });
  try {
    await withTenantTransaction(async tx => {
      const [old] = await tx.select().from(dashboards).where(eq(dashboards.id, req.params.id));
      if (!old) return res.status(404).json({ error: 'Dashboard not found' });
      // Preserve unavailable filters; copying never grants access to the underlying project.
      const [row] = await tx.insert(dashboards).values({ name: parsed.data.name, widgets: old.widgets, visibility: 'private', creatorId: req.user!.id, organizationId: getTenantOrgId()! }).returning();
      res.status(201).json({ ...row, canManage: true });
    });
  } catch { res.status(500).json({ error: 'Failed to duplicate dashboard' }); }
});
router.delete('/api/dashboards/:id', requireRole('viewer'), async (req, res) => {
  try {
    await withTenantTransaction(async tx => {
      const [row] = await tx.select().from(dashboards).where(eq(dashboards.id, req.params.id));
      if (!row) return res.status(404).json({ error: 'Dashboard not found' });
      if (!manage(row, req.user!)) return res.status(403).json({ error: 'Forbidden' });
      await tx.delete(dashboards).where(eq(dashboards.id, row.id));
      res.sendStatus(204);
    });
  } catch { res.status(500).json({ error: 'Failed to delete dashboard' }); }
});
export default router;
