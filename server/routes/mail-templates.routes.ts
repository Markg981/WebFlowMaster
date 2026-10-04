import { Router } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { mailTemplates, TEMPLATE_PURPOSES, TEMPLATE_VARIABLES, type TemplatePurpose } from '@shared/mail-templates';
import { AUDIT_ACTIONS } from '@shared/schema';
import { requireRole } from '../middleware/require-role';
import { getTenantOrgId, withTenantTransaction } from '../middleware/tenancy';
import { auditActor, recordAudit } from '../audit';
import { builtInTemplates, previewMailTemplate, validateMailTemplate } from '../mail-templates';

const router = Router();
const purposeSchema = z.enum(TEMPLATE_PURPOSES);
const revision = z.object({ version: z.number().int().min(0) }).strict();
const edit = revision.extend({ subject: z.string().min(1).max(254), html: z.string().min(1).max(50000), text: z.string().min(1).max(20000) }).strict();
const entry = (purpose: TemplatePurpose, row?: typeof mailTemplates.$inferSelect) => ({ purpose, subject: row?.custom ? row.subject : builtInTemplates[purpose].subject, html: row?.custom ? row.html : builtInTemplates[purpose].html, text: row?.custom ? row.text : builtInTemplates[purpose].text, version: row?.version ?? 0, custom: row?.custom ?? false, variables: TEMPLATE_VARIABLES[purpose] });
router.get('/api/mail-templates', requireRole('owner'), async (_req, res) => {
  try {
    const rows = await withTenantTransaction(tx => tx.select().from(mailTemplates).where(eq(mailTemplates.organizationId, getTenantOrgId()!)));
    res.json({ templates: TEMPLATE_PURPOSES.map(purpose => entry(purpose, rows.find(row => row.purpose === purpose))) });
  } catch { res.status(500).json({ error: 'Could not load mail templates' }); }
});
router.post('/api/mail-templates/:purpose/preview', requireRole('owner'), async (req, res) => {
  const purpose = purposeSchema.safeParse(req.params.purpose); const body = edit.safeParse(req.body);
  if (!purpose.success || !body.success) return res.status(400).json({ error: 'Invalid mail template' });
  try { res.json(previewMailTemplate(purpose.data, body.data)); }
  catch { res.status(400).json({ error: 'Invalid mail template or required action link' }); }
});
router.put('/api/mail-templates/:purpose', requireRole('owner'), async (req, res) => {
  const purpose = purposeSchema.safeParse(req.params.purpose); const body = edit.safeParse(req.body);
  if (!purpose.success || !body.success) return res.status(400).json({ error: 'Invalid mail template' });
  let content; try { content = validateMailTemplate(purpose.data, { subject: body.data.subject, html: body.data.html, text: body.data.text }); }
  catch { return res.status(400).json({ error: 'Invalid mail template or required action link' }); }
  try {
    const org = getTenantOrgId()!;
    const result = await withTenantTransaction(async tx => {
      const [row] = body.data.version === 0 ? await tx.insert(mailTemplates).values({ organizationId: org, purpose: purpose.data, ...content }).onConflictDoNothing().returning() :
        await tx.update(mailTemplates).set({ ...content, custom: true, version: sql`${mailTemplates.version} + 1`, updatedAt: new Date() }).where(and(eq(mailTemplates.organizationId, org), eq(mailTemplates.purpose, purpose.data), eq(mailTemplates.version, body.data.version))).returning();
      if (!row) return null;
      await recordAudit(tx, { action: AUDIT_ACTIONS.MAIL_TEMPLATE_CHANGED, actor: auditActor(req), targetType: 'organization', targetId: org, metadata: { purpose: purpose.data, action: 'save', fields: ['subject', 'html', 'text'], version: row.version } });
      return entry(purpose.data, row);
    });
    if (!result) return res.status(409).json({ error: 'Mail template changed; reload before saving' });
    res.json(result);
  } catch { res.status(500).json({ error: 'Could not save mail template' }); }
});
router.delete('/api/mail-templates/:purpose', requireRole('owner'), async (req, res) => {
  const purpose = purposeSchema.safeParse(req.params.purpose); const body = revision.safeParse(req.body);
  if (!purpose.success || !body.success) return res.status(400).json({ error: 'Invalid mail template revision' });
  try {
    const org = getTenantOrgId()!;
    const result = await withTenantTransaction(async tx => {
      const [row] = body.data.version === 0 ? await tx.insert(mailTemplates).values({ organizationId: org, purpose: purpose.data, ...builtInTemplates[purpose.data], custom: false }).onConflictDoNothing().returning() :
        await tx.update(mailTemplates).set({ ...builtInTemplates[purpose.data], custom: false, version: sql`${mailTemplates.version} + 1`, updatedAt: new Date() }).where(and(eq(mailTemplates.organizationId, org), eq(mailTemplates.purpose, purpose.data), eq(mailTemplates.version, body.data.version))).returning();
      if (!row) return null;
      await recordAudit(tx, { action: AUDIT_ACTIONS.MAIL_TEMPLATE_CHANGED, actor: auditActor(req), targetType: 'organization', targetId: org, metadata: { purpose: purpose.data, action: 'reset', fields: ['subject', 'html', 'text'], version: row.version } });
      return entry(purpose.data, row);
    });
    if (!result) return res.status(409).json({ error: 'Mail template changed; reload before resetting' });
    res.json(result);
  } catch { res.status(500).json({ error: 'Could not reset mail template' }); }
});
export default router;
