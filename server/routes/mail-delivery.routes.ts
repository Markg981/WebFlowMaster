import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/require-role';
import { organizationMailConfigured } from '../mailer';
import { getTenantOrgId } from '../middleware/tenancy';
import { getOrganizationTrackingStatus } from '../mail-settings';
import { deliveryEventSchema, listMailDeliveries, receiveDeliveryEvent, trackingConfigured, verifyDeliverySignature } from '../mail-delivery';

/** The public router is mounted before session authorization. Its credential is the HMAC,
 * checked before lookup; no browser session authorizes a delivery event. */
export const mailDeliveryWebhookRouter = Router();
mailDeliveryWebhookRouter.post('/api/mail-deliveries/events', async (req, res) => {
  if (!trackingConfigured()) return res.status(503).json({ error: 'Delivery tracking is not configured' });
  const parsed = deliveryEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid delivery event' });
  if (!verifyDeliverySignature(req.get('X-Wfm-Mail-Timestamp'), req.get('X-Wfm-Mail-Signature'), parsed.data)) return res.status(401).json({ error: 'Invalid delivery event signature' });
  try {
    const result = await receiveDeliveryEvent(parsed.data);
    if (!result) return res.status(404).json({ error: 'Message not found' });
    res.json(result);
  } catch { res.status(500).json({ error: 'Could not record delivery event' }); }
});
const router = Router();
router.get('/api/mail-deliveries', requireRole('owner'), async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).safeParse(req.query.limit ?? 50);
  if (!limit.success) return res.status(400).json({ error: 'Invalid delivery limit' });
  let before: { date: Date; id: string } | undefined;
  if (req.query.before !== undefined) {
    if (typeof req.query.before !== 'string') return res.status(400).json({ error: 'Invalid delivery cursor' });
    const [date, id] = req.query.before.split('|');
    if (!z.string().datetime().safeParse(date).success || !z.string().uuid().safeParse(id).success) return res.status(400).json({ error: 'Invalid delivery cursor' });
    before = { date: new Date(date), id };
  }
  try {
    const rows = await listMailDeliveries(limit.data, before);
    const deliveries = rows.slice(0, limit.data);
    const last = deliveries.at(-1);
    res.json({ configured: await organizationMailConfigured(getTenantOrgId()), trackingConfigured: await getOrganizationTrackingStatus(getTenantOrgId()!), deliveries,
      nextBefore: rows.length > limit.data && last ? `${last.createdAt.toISOString()}|${last.id}` : null });
  } catch { res.status(500).json({ error: 'Could not load mail deliveries' }); }
});
export default router;
