import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { mailSettings, mailSettingsInputSchema } from '@shared/mail-settings';
import { AUDIT_ACTIONS } from '@shared/schema';
import { requireRole } from '../middleware/require-role';
import { getTenantOrgId, withTenantTransaction } from '../middleware/tenancy';
import { auditActor, recordAudit } from '../audit';
import { buildMailSettings, MailSettingsError, publicMailSettings } from '../mail-settings';

const router = Router();
router.get('/api/mail-settings', requireRole('owner'), async (_req, res) => {
  try {
    const row = await withTenantTransaction(async tx => (await tx.select().from(mailSettings).where(eq(mailSettings.organizationId, getTenantOrgId()!)).limit(1))[0]);
    res.json(publicMailSettings(row));
  } catch { res.status(500).json({ error: 'Could not load email configuration.' }); }
});
router.put('/api/mail-settings', requireRole('owner'), async (req, res) => {
  const parsed = mailSettingsInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email configuration.' });
  try {
    const result = await withTenantTransaction(async tx => {
      const organizationId = getTenantOrgId()!;
      const [current] = await tx.select().from(mailSettings).where(eq(mailSettings.organizationId, organizationId)).for('update').limit(1);
      if ((current?.version ?? 0) !== parsed.data.version) throw new MailSettingsError(409, 'Email configuration changed. Reload before saving.');
      const values = buildMailSettings(parsed.data, organizationId, current);
      const [saved] = current ? await tx.update(mailSettings).set(values).where(eq(mailSettings.organizationId, organizationId)).returning() : await tx.insert(mailSettings).values(values).returning();
      await recordAudit(tx, { action: AUDIT_ACTIONS.MAIL_SETTINGS_CHANGED, actor: auditActor(req), targetType: 'organization', targetId: organizationId,
        metadata: { fields: Object.keys(parsed.data).filter(key => key !== 'version').sort(), version: saved.version } });
      return publicMailSettings(saved);
    });
    res.json(result);
  } catch (error) {
    if (error instanceof MailSettingsError) return res.status(error.status).json({ error: error.message });
    if ((error as { code?: string }).code === '23505' || (error as { cause?: { code?: string } }).cause?.code === '23505') return res.status(409).json({ error: 'Email configuration changed. Reload before saving.' });
    res.status(500).json({ error: 'Could not save email configuration.' });
  }
});
export default router;
