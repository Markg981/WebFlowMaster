import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_DASHBOARD_LAYOUT, dashboardLayoutSchema, userDashboardLayouts } from '@shared/dashboard-layout';
import { getTenantOrgId, withTenantTransaction } from '../middleware/tenancy';
import { requireRole } from '../middleware/require-role';

const router = Router();
router.use('/api/dashboard/layout', requireRole('viewer'));

router.get('/api/dashboard/layout', async (req, res) => {
  try {
    const [row] = await withTenantTransaction(tx => tx.select().from(userDashboardLayouts)
      .where(and(eq(userDashboardLayouts.organizationId, getTenantOrgId()!), eq(userDashboardLayouts.userId, req.user!.id))));
    res.json(row ? { widgets: row.widgets } : DEFAULT_DASHBOARD_LAYOUT);
  } catch {
    res.status(500).json({ error: 'Failed to load dashboard layout' });
  }
});
router.put('/api/dashboard/layout', async (req, res) => {
  const parsed = dashboardLayoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid dashboard layout', details: parsed.error.flatten() });
  try {
    await withTenantTransaction(async tx => {
      await tx.insert(userDashboardLayouts).values({
        organizationId: getTenantOrgId()!, userId: req.user!.id, widgets: parsed.data.widgets,
      }).onConflictDoUpdate({
        target: [userDashboardLayouts.organizationId, userDashboardLayouts.userId],
        set: { widgets: parsed.data.widgets, updatedAt: new Date() },
      });
    });
    res.json(parsed.data);
  } catch {
    res.status(500).json({ error: 'Failed to save dashboard layout' });
  }
});
router.delete('/api/dashboard/layout', async (req, res) => {
  try {
    await withTenantTransaction(tx => tx.delete(userDashboardLayouts)
      .where(and(eq(userDashboardLayouts.organizationId, getTenantOrgId()!), eq(userDashboardLayouts.userId, req.user!.id))));
    res.json(DEFAULT_DASHBOARD_LAYOUT);
  } catch {
    res.status(500).json({ error: 'Failed to reset dashboard layout' });
  }
});
export default router;
