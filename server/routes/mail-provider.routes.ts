import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { getProviderMailConfiguration, registerMailgunRequest } from '../mail-settings';
import { receiveDeliveryEvent } from '../mail-delivery';
import { normalizeProviderRequest, ProviderProtocolError } from '../mail-providers';

const providerPath = /^\/api\/mail-deliveries\/providers\/[^/]+\/?$/;
const rawParser = express.raw({ type: ['application/json', 'text/plain'], limit: '256kb' });
/** Mount before global JSON parsing, without consuming unrelated API bodies. */
export const mailProviderBodyParser: RequestHandler = (req, res, next) => {
  if (req.method === 'POST' && providerPath.test(req.path)) return rawParser(req, res, next);
  next();
};
export const mailProviderWebhookRouter = Router();
mailProviderWebhookRouter.post('/api/mail-deliveries/providers/:callbackId', async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.callbackId).success) return res.status(404).json({ error: 'Provider callback not found' });
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Invalid provider body' });
  try {
    const config = await getProviderMailConfiguration(req.params.callbackId);
    if (!config || config.provider === 'none') return res.status(404).json({ error: 'Provider callback not found' });
    const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, typeof value === 'string' ? value : undefined]));
    // Normalize the complete batch before persisting any entry. Invalid supported events
    // therefore cannot silently produce a successful partial ingestion.
    const { events } = await normalizeProviderRequest(config, req.body, headers);
    // Mailgun authenticates timestamp+token rather than event-data. Bind each native token
    // to its authenticated raw body in shared storage so replicas reject altered replays.
    if (config.provider === 'mailgun' && !await registerMailgunRequest(config, req.body)) {
      throw new ProviderProtocolError(401, 'Invalid provider signature');
    }
    let recorded = 0, duplicates = 0;
    for (const { event, recipient } of events) {
      const result = await receiveDeliveryEvent(event, config.organizationId, recipient);
      if (result) { recorded++; if (result.duplicate) duplicates++; }
    }
    return res.json({ received: true, recorded, duplicates });
  } catch (error) {
    if (error instanceof ProviderProtocolError) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'Could not record provider event' });
  }
});
