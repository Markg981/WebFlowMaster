import { createHash, createHmac, createPublicKey, timingSafeEqual, verify, X509Certificate } from 'node:crypto';
import { z } from 'zod';
import type { ProviderMailConfig } from '@shared/mail-settings';
import { deliveryEventSchema, verifyDeliverySignature, type DeliveryEvent } from './mail-delivery';

export class ProviderProtocolError extends Error {
  constructor(public readonly status: 400 | 401 | 503, message: string) { super(message); }
}
export interface ProviderDependencies {
  fetchCertificate(url: string): Promise<string>;
  confirmSubscription(url: string): Promise<void>;
}
export interface NormalizedProviderEvent { event: DeliveryEvent; recipient?: string }
type Headers = Record<string, string | undefined>;
const MAX_EVENTS = 100;
const MAX_CERT_BYTES = 16 * 1024;
const certificateCache = new Map<string, { pem: string; expires: number }>();

/** Inputs are always fixed regional SNS URLs, validated before reaching these dependencies. */
async function boundedSnsRequest(url: string, maxBytes: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('SNS request failed');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > maxBytes) { await reader.cancel(); throw new Error('SNS response too large'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(timeout); }
}
export const mailProviderDeps: ProviderDependencies = {
  async fetchCertificate(url) {
    const cached = certificateCache.get(url);
    if (cached && cached.expires > Date.now()) return cached.pem;
    const pem = await boundedSnsRequest(url, MAX_CERT_BYTES);
    const cert = new X509Certificate(pem);
    if (Date.now() < Date.parse(cert.validFrom) || Date.now() > Date.parse(cert.validTo) || cert.publicKey.asymmetricKeyType !== 'rsa') throw new Error('Invalid SNS certificate');
    if (certificateCache.size >= 50) certificateCache.delete(certificateCache.keys().next().value!);
    certificateCache.set(url, { pem, expires: Math.min(Date.now() + 3600000, Date.parse(cert.validTo)) });
    return pem;
  },
  async confirmSubscription(url) { await boundedSnsRequest(url, MAX_CERT_BYTES); },
};

export function providerHeaders(config: Pick<ProviderMailConfig, 'provider'>, deliveryId: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Wfm-Delivery-Id': deliveryId };
  if (config.provider === 'sendgrid') headers['X-SMTPAPI'] = JSON.stringify({ unique_args: { wfm_delivery_id: deliveryId } });
  if (config.provider === 'mailgun') headers['X-Mailgun-Variables'] = JSON.stringify({ wfm_delivery_id: deliveryId });
  return headers;
}
function invalid(status: 400 | 401 | 503 = 400): never { throw new ProviderProtocolError(status, status === 401 ? 'Invalid provider signature' : 'Invalid provider event'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value.length || value.length > max) invalid();
  return value;
}
function fresh(timestamp: unknown): timestamp is string {
  return typeof timestamp === 'string' && /^\d{10}$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
}
function correlated(provider: string, nativeId: unknown, messageId: unknown, status: DeliveryEvent['status'], recipient: unknown): NormalizedProviderEvent {
  const recipientText = text(recipient, 254);
  if (!z.string().email().safeParse(recipientText).success) invalid();
  if (!z.string().uuid().safeParse(messageId).success) invalid();
  const eventId = `${provider}:${createHash('sha256').update(text(nativeId, 2000)).digest('hex')}`;
  return { event: { eventId, messageId: messageId as string, status }, recipient: recipientText };
}
function safeJson(raw: Buffer): unknown {
  if (!Buffer.isBuffer(raw) || raw.length > 256 * 1024) invalid();
  try { return JSON.parse(raw.toString('utf8')); } catch { return invalid(); }
}

/** SNS signs these exact ordered fields, each name and value followed by a newline. */
export function snsSigningString(payload: Record<string, string>): string {
  const fields = payload.Type === 'Notification' ? ['Message', 'MessageId', ...(payload.Subject !== undefined ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields.map(name => `${name}\n${text(payload[name], name === 'Message' ? 256 * 1024 : 4000)}\n`).join('');
}
function snsOrigin(topicArn: string | undefined): string {
  const parsed = /^arn:(aws|aws-cn|aws-us-gov):sns:([a-z]{2}(?:-gov)?-[a-z]+-\d):\d{12}:[A-Za-z0-9_-]{1,256}$/.exec(topicArn || '');
  if (!parsed) invalid(401);
  if (parsed[1] === 'aws-cn' && !parsed[2].startsWith('cn-')) invalid(401);
  if (parsed[1] !== 'aws-cn' && parsed[2].startsWith('cn-')) invalid(401);
  return `https://sns.${parsed[2]}.amazonaws.com${parsed[1] === 'aws-cn' ? '.cn' : ''}`;
}
async function normalizeSns(config: ProviderMailConfig, value: unknown, deps: ProviderDependencies): Promise<NormalizedProviderEvent[]> {
  const payload = object(value);
  if (payload.TopicArn !== config.sesTopicArn || !['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'].includes(String(payload.Type))) invalid(401);
  const origin = snsOrigin(config.sesTopicArn);
  let certUrl: URL;
  try { certUrl = new URL(text(payload.SigningCertURL, 2000)); } catch { return invalid(401); }
  if (certUrl.origin !== origin || certUrl.username || certUrl.password || certUrl.search || certUrl.hash || !/^\/SimpleNotificationService-[a-fA-F0-9]{32,64}\.pem$/.test(certUrl.pathname)) invalid(401);
  const timestamp = Date.parse(text(payload.Timestamp, 100));
  // SNS's HTTP retry policy has a one-hour maximum. Allow five minutes of clock skew;
  // persistent event IDs keep identical signed retries idempotent.
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300000 || timestamp < Date.now() - 65 * 60000) invalid(401);
  if (payload.SignatureVersion !== '1' && payload.SignatureVersion !== '2') invalid(401);
  const signing = snsSigningString(payload as Record<string, string>);
  const signature = text(payload.Signature, 4000);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) invalid(401);
  let pem: string;
  try { pem = await deps.fetchCertificate(certUrl.href); } catch { throw new ProviderProtocolError(503, 'Could not retrieve SNS certificate'); }
  try {
    const cert = new X509Certificate(pem);
    if (Date.now() < Date.parse(cert.validFrom) || Date.now() > Date.parse(cert.validTo) || cert.publicKey.asymmetricKeyType !== 'rsa'
      || !verify(payload.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256', Buffer.from(signing), cert.publicKey, Buffer.from(signature, 'base64'))) invalid(401);
  } catch { return invalid(401); }
  if (payload.Type === 'SubscriptionConfirmation') {
    const url = new URL('/', origin);
    url.search = new URLSearchParams({ Action: 'ConfirmSubscription', TopicArn: config.sesTopicArn!, Token: text(payload.Token, 4000), Version: '2010-03-31' }).toString();
    try { await deps.confirmSubscription(url.href); } catch { throw new ProviderProtocolError(503, 'Could not confirm SNS subscription'); }
    return [];
  }
  if (payload.Type === 'UnsubscribeConfirmation') return [];
  const message = object(safeJson(Buffer.from(text(payload.Message, 256 * 1024))));
  if (!['Delivery', 'Bounce'].includes(String(message.notificationType))) return [];
  const mail = object(message.mail);
  if (!Array.isArray(mail.headers) || mail.headers.length > 1000) invalid();
  const matches = mail.headers.map(object).filter(header => typeof header.name === 'string' && header.name.toLowerCase() === 'x-wfm-delivery-id');
  if (!matches.length) return []; // notifications for messages sent by other applications
  if (matches.length !== 1) invalid();
  const messageId = matches[0].value;
  let status: DeliveryEvent['status'], recipients: unknown[];
  if (message.notificationType === 'Delivery') {
    status = 'delivered';
    const delivery = object(message.delivery);
    if (!Array.isArray(delivery.recipients)) invalid();
    recipients = delivery.recipients;
  } else {
    const bounce = object(message.bounce);
    if (bounce.bounceType !== 'Permanent' && bounce.bounceType !== 'Transient') return [];
    status = bounce.bounceType === 'Permanent' ? 'hard_bounce' : 'soft_bounce';
    if (!Array.isArray(bounce.bouncedRecipients)) invalid();
    recipients = bounce.bouncedRecipients.map(recipient => object(recipient).emailAddress);
  }
  if (!recipients.length || recipients.length > MAX_EVENTS) invalid();
  return recipients.map(recipient => correlated('ses', `${text(payload.MessageId)}:${text(recipient, 254).toLowerCase()}`, messageId, status, recipient));
}

export async function normalizeProviderRequest(config: ProviderMailConfig, raw: Buffer, headers: Headers, deps: ProviderDependencies = mailProviderDeps): Promise<{ events: NormalizedProviderEvent[] }> {
  if (config.provider === 'none') throw new ProviderProtocolError(503, 'Provider tracking is disabled');
  if (config.provider === 'sendgrid') {
    const timestamp = headers['x-twilio-email-event-webhook-timestamp'];
    const signature = headers['x-twilio-email-event-webhook-signature'];
    if (!fresh(timestamp) || !signature || signature.length > 1000 || !config.sendgridPublicKey) invalid(401);
    try {
      const key = config.sendgridPublicKey.includes('BEGIN PUBLIC KEY') ? createPublicKey(config.sendgridPublicKey)
        : createPublicKey({ key: Buffer.from(config.sendgridPublicKey, 'base64'), format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ec' || !verify('sha256', Buffer.concat([Buffer.from(timestamp), raw]), key, Buffer.from(signature, 'base64'))) invalid(401);
    } catch { return invalid(401); }
    const payload = safeJson(raw);
    if (!Array.isArray(payload) || payload.length > MAX_EVENTS) invalid();
    const events: NormalizedProviderEvent[] = [];
    for (const input of payload) {
      const event = object(input);
      if (!['delivered', 'deferred', 'bounce'].includes(String(event.event))) continue;
      if (event.wfm_delivery_id === undefined) continue;
      const status = event.event === 'delivered' ? 'delivered' : event.event === 'deferred' || event.type === 'blocked' ? 'soft_bounce' : 'hard_bounce';
      events.push(correlated('sendgrid', event.sg_event_id, event.wfm_delivery_id, status, event.email));
    }
    return { events };
  }
  const payload = safeJson(raw);
  if (config.provider === 'generic') {
    const parsed = deliveryEventSchema.safeParse(payload);
    if (!parsed.success) invalid();
    if (!verifyDeliverySignature(headers['x-wfm-mail-timestamp'], headers['x-wfm-mail-signature'], parsed.data, { MAIL_DELIVERY_WEBHOOK_SECRET: config.signingSecret })) invalid(401);
    return { events: [{ event: parsed.data }] };
  }
  if (config.provider === 'mailgun') {
    const data = object(payload), signature = object(data.signature);
    const timestamp = signature.timestamp;
    if (!fresh(timestamp) || typeof signature.token !== 'string' || signature.token.length > 200 || !signature.token.length || !config.signingSecret
      || typeof signature.signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature.signature)) invalid(401);
    const expected = createHmac('sha256', config.signingSecret).update(timestamp + signature.token).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.signature, 'hex'))) invalid(401);
    const event = object(data['event-data']);
    if (!['delivered', 'failed'].includes(String(event.event))) return { events: [] };
    const variables = event['user-variables'] === undefined ? {} : object(event['user-variables']);
    if (variables.wfm_delivery_id === undefined) return { events: [] };
    if (event.event === 'failed' && event.severity !== 'temporary' && event.severity !== 'permanent') invalid();
    const status = event.event === 'delivered' ? 'delivered' : event.severity === 'temporary' ? 'soft_bounce' : 'hard_bounce';
    return { events: [correlated('mailgun', event.id, variables.wfm_delivery_id, status, event.recipient)] };
  }
  return { events: await normalizeSns(config, payload, deps) };
}
